import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,

  $id: 'GithubUserClaim',

  definitions: {
    GithubTeamClaim: {
      $id: 'firestartr.dev://github/GithubUserClaim',

      type: 'object',

      description: 'A membership github claim',

      allOf: [
        {
          $ref: 'firestartr.dev://common/ClaimProviderEnvelope',
        },

        {
          type: 'object',

          properties: {
            name: {
              type: 'string',
            },

            tfStateKey: {
              $ref: 'firestartr.dev://common/TerraformStateKey',
            },

            sync: {
              $ref: 'firestartr.dev://common/FirestartrGithubSync',
            },

            role: {
              type: 'string',

              enum: ['admin', 'member'],
            },

            org: {
              $ref: 'firestartr.dev://common/ClaimName',
            },
          },

          additionalProperties: false,
          required: ['org', 'role'],
        },
      ],
    },
  },
};
