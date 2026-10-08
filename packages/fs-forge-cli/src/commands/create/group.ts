import { Command, Flags } from '@oclif/core';
import { join } from 'path';

import { assertCreatePath } from '../../claims/deterministicPath.js';
import { runClaimCreation } from '../../mutations/creation.js';
import { MUTATION_CONTROL_FLAGS } from '../../mutations/support.js';
import { createClaimValidator } from '../../utils/ajvValidation.js';
import { buildClaimFromFlags } from '../../utils/buildClaim.js';
import { runtimeFlags } from '../../utils/runtimeFlags.js';
import type { FlagSpec } from '../../utils/deriveFlags.js';

export default class CreateGroup extends Command {
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
      path: 'children',
      type: 'string',
      required: false,
      multiple: true,
    },
    {
      path: 'parent',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'members',
      type: 'string',
      required: false,
      multiple: true,
    },
    {
      path: 'providers.github.name',
      type: 'string',
      required: false,
      conditionalRequired: true,
      multiple: false,
    },
    {
      path: 'providers.github.privacy',
      type: 'string',
      required: false,
      conditionalRequired: true,
      enumValues: ['closed', 'secret'],
      multiple: false,
    },
    {
      path: 'providers.github.description',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.org',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description:
        'GitHub organization where the Team is created; different from --org, the claims-repo organization.',
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

  static summary = 'Manage a GitHub team and its membership.';

  static description = 'Create a new GroupClaim.';

  static flags = {
    ...runtimeFlags(CreateGroup.FLAG_SPECS),

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
    const { flags } = await this.parse(CreateGroup);

    assertCreatePath('GroupClaim', flags.commit, flags.path);

    const claim = {
      kind: 'GroupClaim',
      ...buildClaimFromFlags(
        flags as Record<string, unknown>,
        CreateGroup.FLAG_SPECS,
        ['providers'],
      ),
    };
    const validator = createClaimValidator({
      schemasDir: join(this.config.root, 'schemas'),
    });
    const result = await validator.validate(claim, 'GroupClaim');
    if (!result.valid) {
      this.error(result.errors.join('\n'));
    }
    await runClaimCreation({
      org: flags.org,
      kind: 'GroupClaim',
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
