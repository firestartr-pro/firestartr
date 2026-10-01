import { Command, Flags } from '@oclif/core';
import { join } from 'path';

import { assertCreatePath } from '../../claims/deterministicPath.js';
import { runClaimCreation } from '../../mutations/creation.js';
import { MUTATION_CONTROL_FLAGS } from '../../mutations/support.js';
import { setSchemasDir, validateClaim } from '../../utils/ajvValidation.js';
import { buildClaimFromFlags } from '../../utils/buildClaim.js';
import { runtimeFlags } from '../../utils/runtimeFlags.js';
import type { FlagSpec } from '../../utils/deriveFlags.js';

export default class CreateSystem extends Command {
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
      path: 'domain',
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
      path: 'providers.catalog.json',
      type: 'string',
      required: false,
      description: 'Raw JSON object for providers.catalog',
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

  static summary = 'Describe a system made up of related components.';

  static description = 'Create a new SystemClaim.';

  static flags = {
    ...runtimeFlags(CreateSystem.FLAG_SPECS),

    org: MUTATION_CONTROL_FLAGS.org,
    commit: MUTATION_CONTROL_FLAGS.commit,
    'wait-for-checks': MUTATION_CONTROL_FLAGS['wait-for-checks'],
    'state-repos': MUTATION_CONTROL_FLAGS['state-repos'],
    path: Flags.string({
      description: 'Destination path for TFWorkspaceClaim or SecretsClaim',
    }),
  };

  static examples = ['<%= config.bin %> <%= command.id %> --name example'];

  async run(): Promise<void> {
    const { flags } = await this.parse(CreateSystem);

    assertCreatePath('SystemClaim', flags.commit, flags.path);

    const claim = {
      kind: 'SystemClaim',
      ...buildClaimFromFlags(
        flags as Record<string, unknown>,
        CreateSystem.FLAG_SPECS,
        ['providers'],
      ),
    };
    setSchemasDir(join(this.config.root, 'schemas'));
    const result = await validateClaim(claim, 'SystemClaim');
    if (!result.valid) {
      this.error(result.errors.join('\n'));
    }
    await runClaimCreation({
      org: flags.org,
      kind: 'SystemClaim',
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
