import { SCHEMA } from '../schema';

export default {
  $schema: SCHEMA,

  $id: 'DomainClaim',

  definitions: {
    DomainClaim: {
      $id: 'firestartr.dev://common/DomainClaim',

      type: 'object',

      description: 'A domain claim',

      unevaluatedProperties: false,

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimEnvelope' },

        {
          type: 'object',

          properties: {
            description: {
              type: 'string',
            },
            owner: { $ref: 'firestartr.dev://common/FirestartrOwnerRef' },
          },

          required: ['description', 'owner'],
        },
      ],
    },
  },
};
