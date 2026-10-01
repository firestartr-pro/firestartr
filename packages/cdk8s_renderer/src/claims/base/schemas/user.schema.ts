import { SCHEMA } from '../schema';

export default {
  $schema: SCHEMA,

  $id: 'UserClaim',

  definitions: {
    UserClaim: {
      $id: 'firestartr.dev://common/UserClaim',

      type: 'object',

      description: 'A user claim',

      unevaluatedProperties: false,

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimEnvelope' },

        {
          type: 'object',

          properties: {
            providers: {
              type: 'object',

              properties: {
                github: {
                  $ref: 'firestartr.dev://github/GithubUserClaim',
                },
              },

              additionalProperties: false,
            },
          },
        },
      ],
    },
  },
};
