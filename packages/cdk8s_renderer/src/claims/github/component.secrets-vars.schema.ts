import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,

  $id: 'GithubComponentClaimVarsAndSecrets',

  definitions: {
    GithubComponentClaimVars: {
      $id: 'firestartr.dev://github/GithubComponentClaimVars',

      type: 'object',

      properties: {
        actions: {
          type: 'array',

          items: {
            $ref: 'firestartr.dev://github/GithubComponentClaimRepoVar',
          },
        },
      },

      additionalProperties: false,
    },

    GithubComponentClaimSecrets: {
      $id: 'firestartr.dev://github/GithubComponentClaimSecrets',

      type: 'object',

      properties: {
        actions: {
          type: 'array',

          items: {
            $ref: 'firestartr.dev://github/GithubComponentClaimRepoSecret',
          },
        },
        codespaces: {
          type: 'array',

          items: {
            $ref: 'firestartr.dev://github/GithubComponentClaimRepoSecret',
          },
        },
        dependabot: {
          type: 'array',

          items: {
            $ref: 'firestartr.dev://github/GithubComponentClaimRepoSecret',
          },
        },
      },

      additionalProperties: false,
    },

    GithubComponentClaimSecretRef: {
      $id: 'firestartr.dev://github/GithubComponentClaimSecretRef',

      type: 'string',

      description: 'the reference of the secret',

      pattern: '^ref:secretsclaim:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$',
    },

    GithubComponentClaimRepoSecret: {
      $id: 'firestartr.dev://github/GithubComponentClaimRepoSecret',

      type: 'object',

      description: 'A secret for a github repo',

      properties: {
        name: {
          type: 'string',

          description: 'the name of the secret',
        },

        value: {
          $ref: 'firestartr.dev://github/GithubComponentClaimSecretRef',
        },
      },

      required: ['name', 'value'],

      additionalProperties: false,
    },

    GithubComponentClaimRepoVar: {
      $id: 'firestartr.dev://github/GithubComponentClaimRepoVar',

      type: 'object',

      description: 'A var for a github repo',

      properties: {
        name: {
          type: 'string',

          description: 'the name of the var',
        },

        value: {
          type: 'string',

          description: 'the value of the var',
        },
      },

      required: ['name', 'value'],

      additionalProperties: false,
    },
  },
};
