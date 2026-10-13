import { Command, Flags } from '@oclif/core';
import { join } from 'path';

import { assertCreatePath } from '../../claims/deterministicPath.js';
import { runClaimCreation } from '../../mutations/creation.js';
import { MUTATION_CONTROL_FLAGS } from '../../mutations/support.js';
import { createClaimValidator } from '../../utils/ajvValidation.js';
import { buildClaimFromFlags } from '../../utils/buildClaim.js';
import { runtimeFlags } from '../../utils/runtimeFlags.js';
import type { FlagSpec } from '../../utils/deriveFlags.js';

export default class CreateOrgSettings extends Command {
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
      path: 'providers.github.name',
      type: 'string',
      required: true,
      multiple: false,
    },
    {
      path: 'providers.github.org',
      type: 'string',
      required: true,
      description: 'GitHub organization name',
      multiple: false,
    },
    {
      path: 'providers.github.tfStateKey',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.billing_email',
      type: 'string',
      required: true,
      description: 'Billing email for the organization',
      multiple: false,
    },
    {
      path: 'providers.github.company',
      type: 'string',
      required: false,
      description: 'Company name',
      multiple: false,
    },
    {
      path: 'providers.github.blog',
      type: 'string',
      required: false,
      description: 'Blog URL',
      multiple: false,
    },
    {
      path: 'providers.github.email',
      type: 'string',
      required: false,
      description: 'Contact email',
      multiple: false,
    },
    {
      path: 'providers.github.twitter_username',
      type: 'string',
      required: false,
      description: 'Twitter username',
      multiple: false,
    },
    {
      path: 'providers.github.location',
      type: 'string',
      required: false,
      description: 'Organization location',
      multiple: false,
    },
    {
      path: 'providers.github.description',
      type: 'string',
      required: false,
      description: 'Organization description',
      multiple: false,
    },
    {
      path: 'providers.github.has_organization_projects',
      type: 'boolean',
      required: false,
      description: 'Whether organization projects are enabled',
      multiple: false,
    },
    {
      path: 'providers.github.has_repository_projects',
      type: 'boolean',
      required: false,
      description: 'Whether repository projects are enabled',
      multiple: false,
    },
    {
      path: 'providers.github.default_repository_permission',
      type: 'string',
      required: false,
      description: 'Default permission for new repositories',
      enumValues: ['read', 'write', 'admin', 'none'],
      multiple: false,
    },
    {
      path: 'providers.github.members_can_create_repositories',
      type: 'boolean',
      required: false,
      description: 'Whether members can create repositories',
      multiple: false,
    },
    {
      path: 'providers.github.members_can_create_public_repositories',
      type: 'boolean',
      required: false,
      description: 'Whether members can create public repositories',
      multiple: false,
    },
    {
      path: 'providers.github.members_can_create_private_repositories',
      type: 'boolean',
      required: false,
      description: 'Whether members can create private repositories',
      multiple: false,
    },
    {
      path: 'providers.github.members_can_create_internal_repositories',
      type: 'boolean',
      required: false,
      description: 'Whether members can create internal repositories',
      multiple: false,
    },
    {
      path: 'providers.github.members_can_create_pages',
      type: 'boolean',
      required: false,
      description: 'Whether members can create pages',
      multiple: false,
    },
    {
      path: 'providers.github.members_can_create_public_pages',
      type: 'boolean',
      required: false,
      description: 'Whether members can create public pages',
      multiple: false,
    },
    {
      path: 'providers.github.members_can_create_private_pages',
      type: 'boolean',
      required: false,
      description: 'Whether members can create private pages',
      multiple: false,
    },
    {
      path: 'providers.github.members_can_fork_private_repositories',
      type: 'boolean',
      required: false,
      description: 'Whether members can fork private repositories',
      multiple: false,
    },
    {
      path: 'providers.github.web_commit_signoff_required',
      type: 'boolean',
      required: false,
      description: 'Whether web commit signoff is required',
      multiple: false,
    },
    {
      path: 'providers.github.advanced_security_enabled_for_new_repositories',
      type: 'boolean',
      required: false,
      description: 'Whether advanced security is enabled for new repositories',
      multiple: false,
    },
    {
      path: 'providers.github.dependabot_alerts_enabled_for_new_repositories',
      type: 'boolean',
      required: false,
      description: 'Whether Dependabot alerts are enabled for new repositories',
      multiple: false,
    },
    {
      path: 'providers.github.dependabot_security_updates_enabled_for_new_repositories',
      type: 'boolean',
      required: false,
      description:
        'Whether Dependabot security updates are enabled for new repositories',
      multiple: false,
    },
    {
      path: 'providers.github.dependency_graph_enabled_for_new_repositories',
      type: 'boolean',
      required: false,
      description:
        'Whether the dependency graph is enabled for new repositories',
      multiple: false,
    },
    {
      path: 'providers.github.secret_scanning_enabled_for_new_repositories',
      type: 'boolean',
      required: false,
      description: 'Whether secret scanning is enabled for new repositories',
      multiple: false,
    },
    {
      path: 'providers.github.secret_scanning_push_protection_enabled_for_new_repositories',
      type: 'boolean',
      required: false,
      description:
        'Whether secret scanning push protection is enabled for new repositories',
      multiple: false,
    },
    {
      path: 'providers.github.actions_variables.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.github.actions_variables (escape hatch for complex arrays)',
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

  static summary = 'Configure GitHub organization settings and variables.';

  static description = 'Create a new OrgSettingsClaim.';

  static flags = {
    ...runtimeFlags(CreateOrgSettings.FLAG_SPECS),

    org: MUTATION_CONTROL_FLAGS.org,
    commit: MUTATION_CONTROL_FLAGS.commit,
    'wait-for-checks': MUTATION_CONTROL_FLAGS['wait-for-checks'],
    'state-repos': MUTATION_CONTROL_FLAGS['state-repos'],
    path: Flags.string({
      description: 'Destination path for TFWorkspaceClaim or SecretsClaim',
    }),
  };

  static examples = [
    '<%= config.bin %> <%= command.id %> --name example --providers.github.name example --providers.github.org example --providers.github.billing_email example',
  ];

  async run(): Promise<void> {
    const { flags } = await this.parse(CreateOrgSettings);

    assertCreatePath('OrgSettingsClaim', flags.commit, flags.path);

    const claim = {
      kind: 'OrgSettingsClaim',
      ...buildClaimFromFlags(
        flags as Record<string, unknown>,
        CreateOrgSettings.FLAG_SPECS,
        [],
      ),
    };
    const validator = createClaimValidator({
      schemasDir: join(this.config.root, 'schemas'),
    });
    const result = await validator.validate(claim, 'OrgSettingsClaim');
    if (!result.valid) {
      this.error(result.errors.join('\n'));
    }
    await runClaimCreation({
      org: flags.org,
      kind: 'OrgSettingsClaim',
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
