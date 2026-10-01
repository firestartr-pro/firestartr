import { IOrgSettingsClaim } from '../base/orgSettings';

export interface IGithubOrgSettingsClaim extends IOrgSettingsClaim {
  providers: {
    github: {
      name: string;
      org: string;
      billing_email: string;
      twitter_username?: string;
      company?: string;
      blog?: string;
      email?: string;
      location?: string;
      description?: string;
      has_organization_projects?: boolean;
      has_repository_projects?: boolean;
      default_repository_permission?: 'read' | 'write' | 'admin' | 'none';
      members_can_create_repositories?: boolean;
      members_can_create_public_repositories?: boolean;
      members_can_create_private_repositories?: boolean;
      members_can_create_internal_repositories?: boolean;
      members_can_create_pages?: boolean;
      members_can_create_public_pages?: boolean;
      members_can_create_private_pages?: boolean;
      members_can_fork_private_repositories?: boolean;
      web_commit_signoff_required?: boolean;
      advanced_security_enabled_for_new_repositories?: boolean;
      dependabot_alerts_enabled_for_new_repositories?: boolean;
      dependabot_security_updates_enabled_for_new_repositories?: boolean;
      dependency_graph_enabled_for_new_repositories?: boolean;
      secret_scanning_enabled_for_new_repositories?: boolean;
      secret_scanning_push_protection_enabled_for_new_repositories?: boolean;
      actions_variables?: {
        name: string;
        value: string;
        visibility: 'all' | 'private' | 'selected';
        selected_repositories?: string[];
      }[];
    };
  };
}
