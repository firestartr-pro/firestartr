import { Command, Flags } from '@oclif/core';
import { join } from 'path';

import { assertCreatePath } from '../../claims/deterministicPath.js';
import { runClaimCreation } from '../../mutations/creation.js';
import { MUTATION_CONTROL_FLAGS } from '../../mutations/support.js';
import { createClaimValidator } from '../../utils/ajvValidation.js';
import { buildClaimFromFlags } from '../../utils/buildClaim.js';
import { runtimeFlags } from '../../utils/runtimeFlags.js';
import type { FlagSpec } from '../../utils/deriveFlags.js';

export default class CreateArgoDeploy extends Command {
  static FLAG_SPECS = [
    {
      path: 'name',
      type: 'string',
      required: true,
      multiple: false,
    },
    {
      path: 'description',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'type',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'lifecycle',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'version',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'system',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'project',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.argocd.name',
      type: 'string',
      required: true,
      multiple: false,
    },
    {
      path: 'providers.argocd.project',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.argocd.chart.name',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description: 'The name of the chart',
      multiple: false,
    },
    {
      path: 'providers.argocd.chart.version',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description: 'Version to use of the chart',
      multiple: false,
    },
    {
      path: 'providers.argocd.chart.oci',
      type: 'boolean',
      required: false,
      description: 'Whether the chart is an oci chart',
      defaultValue: false,
      conditionalDefault: true,
      multiple: false,
    },
    {
      path: 'providers.argocd.chart.source',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description: 'RepoURL or registry for the chart',
      multiple: false,
    },
    {
      path: 'providers.argocd.values.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.argocd.values (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.argocd.destination.namespace',
      type: 'string',
      required: false,
      description: 'namespace to deploy',
      multiple: false,
    },
    {
      path: 'providers.argocd.destination.server',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.argocd.destination.name',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'profile.displayName',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'profile.email',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'profile.picture',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'annotations.json',
      type: 'string',
      required: false,
      description: 'Raw JSON object for annotations',
      multiple: false,
    },
  ] as unknown as FlagSpec[];

  static summary = 'Deploy an application to Argo CD from a claim.';

  static description = 'Create a new ArgoDeployClaim.';

  static flags = {
    ...runtimeFlags(CreateArgoDeploy.FLAG_SPECS),

    org: MUTATION_CONTROL_FLAGS.org,
    commit: MUTATION_CONTROL_FLAGS.commit,
    'wait-for-checks': MUTATION_CONTROL_FLAGS['wait-for-checks'],
    'state-repos': MUTATION_CONTROL_FLAGS['state-repos'],
    path: Flags.string({
      description: 'Destination path for TFWorkspaceClaim or SecretsClaim',
    }),
  };

  static examples = [
    '<%= config.bin %> <%= command.id %> --name example --providers.argocd.name example',
  ];

  async run(): Promise<void> {
    const { flags } = await this.parse(CreateArgoDeploy);

    assertCreatePath('ArgoDeployClaim', flags.commit, flags.path);

    const claim = {
      kind: 'ArgoDeployClaim',
      ...buildClaimFromFlags(
        flags as Record<string, unknown>,
        CreateArgoDeploy.FLAG_SPECS,
        [],
      ),
    };
    const validator = createClaimValidator({
      schemasDir: join(this.config.root, 'schemas'),
    });
    const result = await validator.validate(claim, 'ArgoDeployClaim');
    if (!result.valid) {
      this.error(result.errors.join('\n'));
    }
    await runClaimCreation({
      org: flags.org,
      kind: 'ArgoDeployClaim',
      name: flags.name,
      claim,
      commit: flags.commit,
      waitForChecks: flags['wait-for-checks'],
      stateRepos: flags['state-repos'],
      path: flags.path,
      writeOutput: (output) => this.log(output),
      writeDiagnostic: (output) => process.stderr.write(output),
    });
  }
}
