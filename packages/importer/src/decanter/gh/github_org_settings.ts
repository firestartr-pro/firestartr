import { GithubDecanter } from './base';
import log from '../../logger';

const ORG_SETTINGS_OPTIONAL_FIELDS = [
  'twitter_username',
  'company',
  'blog',
  'email',
  'location',
  'description',
  'has_organization_projects',
  'has_repository_projects',
  'default_repository_permission',
  'members_can_create_repositories',
  'members_can_create_public_repositories',
  'members_can_create_private_repositories',
  'members_can_create_internal_repositories',
  'members_can_create_pages',
  'members_can_create_public_pages',
  'members_can_create_private_pages',
  'members_can_fork_private_repositories',
  'web_commit_signoff_required',
  'advanced_security_enabled_for_new_repositories',
  'dependabot_alerts_enabled_for_new_repositories',
  'dependabot_security_updates_enabled_for_new_repositories',
  'dependency_graph_enabled_for_new_repositories',
  'secret_scanning_enabled_for_new_repositories',
  'secret_scanning_push_protection_enabled_for_new_repositories',
];

export default class OrgSettingsGithubDecanter extends GithubDecanter {
  claimKind = 'OrgSettingsClaim';

  __decantStart() {
    this.claim = {
      kind: this.claimKind,

      version: this.VERSION(),

      name: this.orgSettingsName(),
    };
  }

  __decantProviders() {
    log.info(
      `Decanting GitHub organization settings providers for ${this.org}`,
    );

    this.__patchClaim({
      op: 'add',

      value: {
        github: this.data.providerPayload,
      },

      path: '/providers',
    });
  }

  async __gatherOrgSettings() {
    log.info(`Gathering GitHub organization settings for ${this.org}`);

    this.data.orgSettings = await this.github.org.getOrgInfo(this.org);
  }

  __gatherProviderPayload() {
    const billingEmail = this.data.orgSettings.billing_email;

    if (typeof billingEmail !== 'string' || billingEmail.trim() === '') {
      throw new Error(
        `GitHub organization ${this.org} did not return billing_email. ` +
          'billing_email is required for OrgSettingsClaim / FirestartrGithubOrganizationSettings. ' +
          'Run importer with credentials that can read billing email or create/manage the claim manually.',
      );
    }

    const providerPayload: { [key: string]: any } = {
      name: this.orgSettingsName(),
      org: this.org,
      billing_email: billingEmail,
    };

    for (const field of ORG_SETTINGS_OPTIONAL_FIELDS) {
      const value = this.data.orgSettings[field];

      if (value !== undefined && value !== null) {
        providerPayload[field] = value;
      }
    }

    this.data.providerPayload = providerPayload;

    log.info(
      `Prepared GitHub organization settings claim payload for ${this.org}`,
    );
  }

  async __adaptInitializerBase(_claim: any) {
    return await this.__loadInitializer('defaults_github_orgsettings.yaml');
  }

  private orgSettingsName() {
    return `${this.org.toLowerCase()}-org-settings`;
  }
}
