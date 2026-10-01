import { SCHEMA } from '../schema';

export default {
  $schema: SCHEMA,

  $id: 'SecretsClaim',

  definitions: {
    ArgoDeployClaim: {
      $id: 'firestartr.dev://common/SecretsClaim',

      type: 'object',

      description: '',

      unevaluatedProperties: false,

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimEnvelope' },

        {
          type: 'object',

          properties: {
            system: { $ref: 'firestartr.dev://common/FirestartrSystemRef' },

            owner: {
              $ref: 'firestartr.dev://common/FirestartrOwnerRef',
            },

            providers: {
              type: 'object',

              properties: {
                external_secrets: {
                  $ref: 'firestartr.dev://secrets/ExternalSecretsProvider',
                },
              },

              additionalProperties: false,
              required: ['external_secrets'],
            },
          },

          required: ['owner'],
        },
      ],
    },
  },
};
