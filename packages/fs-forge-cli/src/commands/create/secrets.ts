import { Command, Flags } from '@oclif/core';
import { join } from 'path';

import { assertCreatePath } from '../../claims/deterministicPath.js';
import { runClaimCreation } from '../../mutations/creation.js';
import { MUTATION_CONTROL_FLAGS } from '../../mutations/support.js';
import { setSchemasDir, validateClaim } from '../../utils/ajvValidation.js';
import { buildClaimFromFlags } from '../../utils/buildClaim.js';
import { runtimeFlags } from '../../utils/runtimeFlags.js';
import type { FlagSpec } from '../../utils/deriveFlags.js';

export default class CreateSecrets extends Command {
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
      path: 'owner',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.external_secrets.name',
      type: 'string',
      required: true,
      multiple: false,
    },
    {
      path: 'providers.external_secrets.externalSecrets.refreshInterval',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.external_secrets.externalSecrets.secrets.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.external_secrets.externalSecrets.secrets (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.external_secrets.secretStore.name',
      type: 'string',
      required: false,
      conditionalRequired: true,
      multiple: false,
    },
    {
      path: 'providers.external_secrets.secretStore.kind',
      type: 'string',
      required: false,
      enumValues: ['SecretStore', 'ClusterSecretStore'],
      multiple: false,
    },
    {
      path: 'providers.external_secrets.pushSecrets.json',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description:
        'Raw JSON value for providers.external_secrets.pushSecrets (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.external_secrets.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.external_secrets (escape hatch for union types)',
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

  static summary = 'Manage external secrets for a platform resource.';

  static description = 'Create a new SecretsClaim.';

  static flags = {
    ...runtimeFlags(CreateSecrets.FLAG_SPECS),

    org: MUTATION_CONTROL_FLAGS.org,
    commit: MUTATION_CONTROL_FLAGS.commit,
    'wait-for-checks': MUTATION_CONTROL_FLAGS['wait-for-checks'],
    'state-repos': MUTATION_CONTROL_FLAGS['state-repos'],
    path: Flags.string({
      description: 'Destination path for TFWorkspaceClaim or SecretsClaim',
    }),
  };

  static examples = [
    '<%= config.bin %> <%= command.id %> --name example --providers.external_secrets.name example --providers.external_secrets.json "{\\"name\\":\\"example\\",\\"secretStore\\":{\\"name\\":\\"example\\"},\\"externalSecrets\\":{}}"',
  ];

  async run(): Promise<void> {
    const { flags } = await this.parse(CreateSecrets);

    assertCreatePath('SecretsClaim', flags.commit, flags.path);

    const claim = {
      kind: 'SecretsClaim',
      ...buildClaimFromFlags(
        flags as Record<string, unknown>,
        CreateSecrets.FLAG_SPECS,
        [],
      ),
    };
    setSchemasDir(join(this.config.root, 'schemas'));
    const result = await validateClaim(claim, 'SecretsClaim');
    if (!result.valid) {
      this.error(result.errors.join('\n'));
    }
    await runClaimCreation({
      org: flags.org,
      kind: 'SecretsClaim',
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
