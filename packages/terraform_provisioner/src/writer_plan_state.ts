import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

import Writer from './writer';

export const PLAN_STATE_FILE = 'firestartr-plan.tfstate';

export const PLAN_BACKEND_OVERRIDE_FILE = 'firestartr-plan-backend_override.tf';

/**
 * Where a read-only plan reads a kubernetes backend's live state from. It only
 * ever reads: that backend is never initialized, so it can't take its Lease or
 * create an empty state.
 */
export type ReadOnlyStateSource = {
  readKubernetesSecret: (namespace: string, name: string) => Promise<any>;
};

/**
 * Only the kubernetes backend writes a Lease and an empty state on init, so
 * only it is planned against a snapshot. Every other backend the operator
 * supports is planned through the live backend with `-lock=false` (ADR 0013).
 */
export function plansAgainstLiveBackend(backend: any): boolean {
  return !!backend && !('kubernetes' in backend);
}

/**
 * Points the workspace at a local, owner-only snapshot of the live state
 * (none when the state does not exist yet) instead of its remote backend.
 */
export class WriterPlanState extends Writer {
  backend: any;
  tfStateAddress: string;
  source: ReadOnlyStateSource;
  snapshot: string | null = null;

  constructor(
    backend: any,
    tfStateAddress: string,
    source: ReadOnlyStateSource,
  ) {
    super();

    this.backend = backend;
    this.tfStateAddress = tfStateAddress;
    this.source = source;
  }

  async _render() {
    this.snapshot = await this.readSnapshot();

    this.output = `
terraform {
  backend "local" {
    path = "${PLAN_STATE_FILE}"
  }
}
`;
  }

  async readSnapshot(): Promise<string | null> {
    const type = this.backend ? Object.keys(this.backend)[0] : undefined;

    if (type !== 'kubernetes') {
      throw new Error(
        `[terraform-provisioner]: a read-only plan needs a kubernetes backend to snapshot the state, got '${type ?? 'none'}'`,
      );
    }

    // The same secret the kubernetes backend uses for the default workspace
    const namespace = this.backend.kubernetes.config.namespace;
    const secretName = `tfstate-default-${this.tfStateAddress.split('/').join('-')}`;

    const secret = await this.source.readKubernetesSecret(
      namespace,
      secretName,
    );

    const compressed = secret?.data?.tfstate;

    if (!compressed) return null;

    return zlib.gunzipSync(Buffer.from(compressed, 'base64')).toString('utf8');
  }

  writeToTerraformProject(projectPath: string) {
    if (typeof this.output !== 'string' || this.output === '') {
      throw new Error(
        'Writer output is not set. Did you forget to call render()?',
      );
    }

    // The snapshot, the plan file and the provider cache can hold sensitive
    // values: keep the whole workspace private to its owner
    fs.mkdirSync(projectPath, { recursive: true, mode: 0o700 });
    fs.chmodSync(projectPath, 0o700);

    fs.writeFileSync(
      path.join(projectPath, PLAN_BACKEND_OVERRIDE_FILE),
      this.output,
      { encoding: 'utf8' },
    );

    const statePath = path.join(projectPath, PLAN_STATE_FILE);

    fs.rmSync(statePath, { force: true });

    if (this.snapshot !== null) {
      fs.writeFileSync(statePath, this.snapshot, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
    }
  }
}
