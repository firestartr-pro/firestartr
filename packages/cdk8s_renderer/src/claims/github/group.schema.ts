import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,

  $id: 'GithubTeamClaim',

  definitions: {
    GithubTeamClaim: {
      $id: 'firestartr.dev://github/GithubTeamClaim',

      type: 'object',

      description: 'A team github claim',

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimProviderEnvelope' },

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

            privacy: {
              type: 'string',

              enum: ['closed', 'secret'],
            },

            description: {
              type: 'string',
            },

            org: {
              $ref: 'firestartr.dev://common/ClaimName',
            },
          },

          additionalProperties: false,
          required: ['org', 'privacy'],
        },
      ],
    },
  },
};
