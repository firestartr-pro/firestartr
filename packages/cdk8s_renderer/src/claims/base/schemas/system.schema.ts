import { SCHEMA } from '../schema';

export default {
  $schema: SCHEMA,

  $id: 'SystemClaim',

  definitions: {
    SystemClaim: {
      $id: 'firestartr.dev://common/SystemClaim',

      type: 'object',

      description: 'A System claim',

      unevaluatedProperties: false,

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimEnvelope' },

        {
          type: 'object',

          properties: {
            domain: { $ref: 'firestartr.dev://common/FirestartrDomainRef' },
            owner: { $ref: 'firestartr.dev://common/FirestartrOwnerRef' },
          },

          required: ['name'],
        },
      ],
    },
  },
};
