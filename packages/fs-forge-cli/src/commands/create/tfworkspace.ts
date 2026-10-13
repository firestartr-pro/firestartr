import { Command, Flags } from '@oclif/core';
import { join } from 'path';

import { assertCreatePath } from '../../claims/deterministicPath.js';
import { runClaimCreation } from '../../mutations/creation.js';
import { MUTATION_CONTROL_FLAGS } from '../../mutations/support.js';
import { createClaimValidator } from '../../utils/ajvValidation.js';
import { buildClaimFromFlags } from '../../utils/buildClaim.js';
import { runtimeFlags } from '../../utils/runtimeFlags.js';
import type { FlagSpec } from '../../utils/deriveFlags.js';

export default class CreateTFWorkspace extends Command {
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
      path: 'resourceType',
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
      required: true,
      multiple: false,
    },
    {
      path: 'providers.terraform.name',
      type: 'string',
      required: true,
      multiple: false,
    },
    {
      path: 'providers.terraform.policy',
      type: 'string',
      required: false,
      enumValues: [
        'apply',
        'create-only',
        'create-update-only',
        'full-control',
        'observe',
        'observe-only',
      ],
      multiple: false,
    },
    {
      path: 'providers.terraform.source',
      type: 'string',
      required: true,
      enumValues: ['remote', 'inline', 'Remote', 'Inline'],
      multiple: false,
    },
    {
      path: 'providers.terraform.sync.enabled',
      type: 'boolean',
      required: false,
      conditionalRequired: true,
      multiple: false,
    },
    {
      path: 'providers.terraform.sync.period',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.terraform.sync.schedule',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.terraform.sync.schedule_timezone',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.terraform.sync.policy',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.terraform.valuesSchema',
      type: 'string',
      required: false,
      description: 'a locator for a json schema to validate values',
      multiple: false,
    },
    {
      path: 'providers.terraform.values.json',
      type: 'string',
      required: true,
      description: 'Raw JSON object for providers.terraform.values',
      multiple: false,
    },
    {
      path: 'providers.terraform.module',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.terraform.context.providers.json',
      type: 'string',
      required: true,
      description:
        'Raw JSON value for providers.terraform.context.providers (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.terraform.context.backend.name',
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

  static summary = 'Manage a Terraform workspace and its infrastructure state.';

  static description = 'Create a new TFWorkspaceClaim.';

  static flags = {
    ...runtimeFlags(CreateTFWorkspace.FLAG_SPECS),

    org: MUTATION_CONTROL_FLAGS.org,
    commit: MUTATION_CONTROL_FLAGS.commit,
    'wait-for-checks': MUTATION_CONTROL_FLAGS['wait-for-checks'],
    'state-repos': MUTATION_CONTROL_FLAGS['state-repos'],
    path: Flags.string({
      description: 'Destination path for TFWorkspaceClaim or SecretsClaim',
    }),
  };

  static examples = [
    '<%= config.bin %> <%= command.id %> --name example --owner group:platform --providers.terraform.name example --providers.terraform.source remote --providers.terraform.values.json "{}" --providers.terraform.context.providers.json "[]"',
  ];

  async run(): Promise<void> {
    const { flags } = await this.parse(CreateTFWorkspace);

    assertCreatePath('TFWorkspaceClaim', flags.commit, flags.path);

    const claim = {
      kind: 'TFWorkspaceClaim',
      ...buildClaimFromFlags(
        flags as Record<string, unknown>,
        CreateTFWorkspace.FLAG_SPECS,
        ['providers.terraform.values'],
      ),
    };
    const validator = createClaimValidator({
      schemasDir: join(this.config.root, 'schemas'),
    });
    const result = await validator.validate(claim, 'TFWorkspaceClaim');
    if (!result.valid) {
      this.error(result.errors.join('\n'));
    }
    await runClaimCreation({
      org: flags.org,
      kind: 'TFWorkspaceClaim',
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
