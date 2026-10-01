import { SCHEMA } from '../schema';

export default {
  $schema: SCHEMA,

  $id: 'GroupClaim',

  definitions: {
    GroupClaim: {
      $id: 'firestartr.dev://common/GroupClaim',

      type: 'object',

      description: 'A group claim',

      unevaluatedProperties: false,

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimEnvelope' },

        {
          type: 'object',

          properties: {
            children: {
              type: 'array',
              items: { $ref: 'firestartr.dev://common/FirestartrGroupRef' },
            },

            parent: { $ref: 'firestartr.dev://common/FirestartrGroupRef' },

            members: {
              type: 'array',

              items: { $ref: 'firestartr.dev://common/FirestartrUserRef' },
            },

            providers: {
              type: 'object',

              properties: {
                github: {
                  $ref: 'firestartr.dev://github/GithubTeamClaim',
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
