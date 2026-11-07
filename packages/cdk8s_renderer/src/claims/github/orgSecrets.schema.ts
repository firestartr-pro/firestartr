import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,

  $id: 'GithubOrgClaimSecrets',

  definitions: {
    GithubOrgClaimSecrets: {
      $id: 'firestartr.dev://github/GithubOrgClaimSecrets',

      type: 'object',

      description: 'Organization-level GitHub Actions secrets',

      properties: {
        actions: {
          type: 'array',
          items: {
            $ref: 'firestartr.dev://github/GithubOrgClaimSecret',
          },
        },
        codespaces: {
          type: 'array',
          items: {
            $ref: 'firestartr.dev://github/GithubOrgClaimSecret',
          },
        },
        dependabot: {
          type: 'array',
          items: {
            $ref: 'firestartr.dev://github/GithubOrgClaimSecret',
          },
        },
      },

      additionalProperties: false,
    },

    GithubOrgClaimSecretRef: {
      $id: 'firestartr.dev://github/GithubOrgClaimSecretRef',

      type: 'string',

      description: 'the reference of the secret',

      pattern: '^ref:secretsclaim:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$',
    },

    GithubOrgClaimSecret: {
      $id: 'firestartr.dev://github/GithubOrgClaimSecret',

      type: 'object',

      description: 'An organization-level secret for GitHub Actions',

      properties: {
        name: {
          type: 'string',
          description: 'the name of the secret',
          pattern: '^[A-Za-z0-9_]+$',
        },
        value: {
          $ref: 'firestartr.dev://github/GithubOrgClaimSecretRef',
        },
        visibility: {
          type: 'string',
          enum: ['all', 'selected', 'private'],
          description: 'which repositories can access the secret',
        },
        selected_repositories: {
          type: 'array',
          items: {
            $ref: 'firestartr.dev://common/FirestartrComponentRef',
          },
          description: 'list of repository refs when visibility is selected',
        },
      },

      required: ['name', 'value'],

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
