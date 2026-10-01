import { SCHEMA } from '../base/schema';

const organizationSettingsProperties = {
  name: {
    type: 'string',
  },
  tfStateKey: {
    $ref: 'firestartr.dev://common/TerraformStateKey',
  },
  org: {
    $ref: 'firestartr.dev://common/ClaimName',
  },
  billing_email: {
    type: 'string',
  },
  twitter_username: {
    type: 'string',
  },
  company: {
    type: 'string',
  },
  blog: {
    type: 'string',
  },
  email: {
    type: 'string',
  },
  location: {
    type: 'string',
  },
  description: {
    type: 'string',
  },
  has_organization_projects: {
    type: 'boolean',
  },
  has_repository_projects: {
    type: 'boolean',
  },
  default_repository_permission: {
    type: 'string',
    enum: ['read', 'write', 'admin', 'none'],
  },
  members_can_create_repositories: {
    type: 'boolean',
  },
  members_can_create_public_repositories: {
    type: 'boolean',
  },
  members_can_create_private_repositories: {
    type: 'boolean',
  },
  members_can_create_internal_repositories: {
    type: 'boolean',
  },
  members_can_create_pages: {
    type: 'boolean',
  },
  members_can_create_public_pages: {
    type: 'boolean',
  },
  members_can_create_private_pages: {
    type: 'boolean',
  },
  members_can_fork_private_repositories: {
    type: 'boolean',
  },
  web_commit_signoff_required: {
    type: 'boolean',
  },
  advanced_security_enabled_for_new_repositories: {
    type: 'boolean',
  },
  dependabot_alerts_enabled_for_new_repositories: {
    type: 'boolean',
  },
  dependabot_security_updates_enabled_for_new_repositories: {
    type: 'boolean',
  },
  dependency_graph_enabled_for_new_repositories: {
    type: 'boolean',
  },
  secret_scanning_enabled_for_new_repositories: {
    type: 'boolean',
  },
  secret_scanning_push_protection_enabled_for_new_repositories: {
    type: 'boolean',
  },
  actions_variables: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          pattern: '^[A-Za-z0-9_]+$',
        },
        value: {
          type: 'string',
        },
        visibility: {
          type: 'string',
          enum: ['all', 'private', 'selected'],
        },
        selected_repositories: {
          type: 'array',
          items: {
            $ref: 'firestartr.dev://common/FirestartrComponentRef',
          },
        },
      },
      required: ['name', 'value', 'visibility'],
      additionalProperties: false,
      allOf: [
        {
          if: {
            properties: {
              visibility: { const: 'selected' },
            },
            required: ['visibility'],
          },
          then: {},
          else: {
            properties: {
              selected_repositories: { type: 'array', maxItems: 0 },
            },
          },
        },
      ],
    },
  },
};

export default {
  $schema: SCHEMA,
  $id: 'GithubOrgSettingsClaim',
  definitions: {
    GithubOrgSettingsClaim: {
      $id: 'firestartr.dev://github/GithubOrgSettingsClaim',
      type: 'object',
      description: 'A Github Organization Settings claim',
      allOf: [
        { $ref: 'firestartr.dev://common/ClaimProviderEnvelope' },
        {
          type: 'object',
          properties: organizationSettingsProperties,
          additionalProperties: false,
          required: ['org', 'billing_email'],
        },
      ],
    },
  },
};
