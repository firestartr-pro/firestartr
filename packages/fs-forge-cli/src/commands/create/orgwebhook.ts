import { Command, Flags } from '@oclif/core';
import { join } from 'path';

import { assertCreatePath } from '../../claims/deterministicPath.js';
import { runClaimCreation } from '../../mutations/creation.js';
import { MUTATION_CONTROL_FLAGS } from '../../mutations/support.js';
import { createClaimValidator } from '../../utils/ajvValidation.js';
import { buildClaimFromFlags } from '../../utils/buildClaim.js';
import { runtimeFlags } from '../../utils/runtimeFlags.js';
import type { FlagSpec } from '../../utils/deriveFlags.js';

export default class CreateOrgWebhook extends Command {
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
      path: 'providers.github.name',
      type: 'string',
      required: false,
      conditionalRequired: true,
      multiple: false,
    },
    {
      path: 'providers.github.orgName',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description: 'Organization name on GitHub',
      multiple: false,
    },
    {
      path: 'providers.github.webhook.url',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description: 'Webhook endpoint URL',
      multiple: false,
    },
    {
      path: 'providers.github.webhook.contentType',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description: 'Payload content type (json or form)',
      enumValues: ['json', 'form'],
      multiple: false,
    },
    {
      path: 'providers.github.webhook.active',
      type: 'boolean',
      required: false,
      description: 'If the webhook is active',
      multiple: false,
    },
    {
      path: 'providers.github.webhook.secretRef',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description: 'the reference of the secret',
      multiple: false,
    },
    {
      path: 'providers.github.webhook.events',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description:
        'List of events that trigger the webhook (e.g., push, pull_request, issues)',
      multiple: true,
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

  static summary = 'Configure a webhook for a GitHub organization.';

  static description = 'Create a new OrgWebhookClaim.';

  static flags = {
    ...runtimeFlags(CreateOrgWebhook.FLAG_SPECS),

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
    const { flags } = await this.parse(CreateOrgWebhook);

    assertCreatePath('OrgWebhookClaim', flags.commit, flags.path);

    const claim = {
      kind: 'OrgWebhookClaim',
      ...buildClaimFromFlags(
        flags as Record<string, unknown>,
        CreateOrgWebhook.FLAG_SPECS,
        ['providers'],
      ),
    };
    const validator = createClaimValidator({
      schemasDir: join(this.config.root, 'schemas'),
    });
    const result = await validator.validate(claim, 'OrgWebhookClaim');
    if (!result.valid) {
      this.error(result.errors.join('\n'));
    }
    await runClaimCreation({
      org: flags.org,
      kind: 'OrgWebhookClaim',
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
