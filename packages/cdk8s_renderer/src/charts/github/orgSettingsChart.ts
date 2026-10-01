import {
  FirestartrGithubOrganizationSettings,
  FirestartrGithubOrganizationSettingsProps,
  FirestartrGithubOrganizationSettingsSpecDefaultRepositoryPermission,
} from '../../../imports/firestartr.dev';
import { IUnitializedStateKey } from '../../claims/base';
import { IGithubOrgSettingsClaim } from '../../claims/github/orgSettings';
import { BaseGithubChart } from './base';

export class GithubOrgSettingsChart extends BaseGithubChart {
  public template():
    | FirestartrGithubOrganizationSettingsProps
    | IUnitializedStateKey {
    const claim: IGithubOrgSettingsClaim = this.get('claim');
    const firestartrId: string | null = this.get('firestartrId');
    const githubProvider = claim.providers.github;

    const template = {
      metadata: {
        name: githubProvider.name,
      },

      spec: {
        org: githubProvider.org,
        billingEmail: githubProvider.billing_email,
        company: githubProvider.company,
        blog: githubProvider.blog,
        email: githubProvider.email,
        twitterUsername: githubProvider.twitter_username,
        location: githubProvider.location,
        description: githubProvider.description,
        hasOrganizationProjects: githubProvider.has_organization_projects,
        hasRepositoryProjects: githubProvider.has_repository_projects,
        defaultRepositoryPermission:
          githubProvider.default_repository_permission as
            | FirestartrGithubOrganizationSettingsSpecDefaultRepositoryPermission
            | undefined,
        membersCanCreateRepositories:
          githubProvider.members_can_create_repositories,
        membersCanCreatePublicRepositories:
          githubProvider.members_can_create_public_repositories,
        membersCanCreatePrivateRepositories:
          githubProvider.members_can_create_private_repositories,
        membersCanCreateInternalRepositories:
          githubProvider.members_can_create_internal_repositories,
        membersCanCreatePages: githubProvider.members_can_create_pages,
        membersCanCreatePublicPages:
          githubProvider.members_can_create_public_pages,
        membersCanCreatePrivatePages:
          githubProvider.members_can_create_private_pages,
        membersCanForkPrivateRepositories:
          githubProvider.members_can_fork_private_repositories,
        webCommitSignoffRequired: githubProvider.web_commit_signoff_required,
        advancedSecurityEnabledForNewRepositories:
          githubProvider.advanced_security_enabled_for_new_repositories,
        dependabotAlertsEnabledForNewRepositories:
          githubProvider.dependabot_alerts_enabled_for_new_repositories,
        dependabotSecurityUpdatesEnabledForNewRepositories:
          githubProvider.dependabot_security_updates_enabled_for_new_repositories,
        dependencyGraphEnabledForNewRepositories:
          githubProvider.dependency_graph_enabled_for_new_repositories,
        secretScanningEnabledForNewRepositories:
          githubProvider.secret_scanning_enabled_for_new_repositories,
        secretScanningPushProtectionEnabledForNewRepositories:
          githubProvider.secret_scanning_push_protection_enabled_for_new_repositories,
        firestartr: {
          tfStateKey: firestartrId,
        },
        writeConnectionSecretToRef: {
          name: `firestartrgithuborganizationsettings-${githubProvider.name}-outputs`.toLowerCase(),
          outputs: [],
        },
      },
    };

    return JSON.parse(JSON.stringify(template));
  }

  gvk() {
    return FirestartrGithubOrganizationSettings.GVK;
  }

  instanceApiObject(template: any): FirestartrGithubOrganizationSettings {
    return new FirestartrGithubOrganizationSettings(
      this,
      template.metadata.name,
      template,
    );
  }
}
