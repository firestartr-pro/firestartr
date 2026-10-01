import { SCHEMA } from '../schema';

export default {
  $schema: SCHEMA,

  $id: '',

  definitions: {
    ArgoDeployClaim: {
      $id: 'firestartr.dev://common/ArgoDeployClaim',

      type: 'object',

      description: 'An ArgoCD Deploy claim',

      unevaluatedProperties: false,

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimEnvelope' },

        {
          type: 'object',

          properties: {
            system: { $ref: 'firestartr.dev://common/FirestartrSystemRef' },

            project: {
              type: 'string',
            },

            providers: {
              type: 'object',

              properties: {
                argocd: {
                  $ref: 'firestartr.dev://argocd/ArgoCDProvider',
                },
              },

              additionalProperties: false,

              required: ['argocd'],
            },
          },
        },
      ],
    },
  },
};
