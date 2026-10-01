export default {
  $id: 'TFWorkspaceClaim',

  definitions: {
    TFWorkspaceClaim: {
      $id: 'firestartr.dev://common/TFWorkspaceClaim',

      type: 'object',

      description: 'A TF Workspace claim',

      unevaluatedProperties: false,

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimEnvelope' },

        {
          type: 'object',

          properties: {
            resourceType: {
              type: 'string',
            },

            system: { $ref: 'firestartr.dev://common/FirestartrSystemRef' },
            owner: { $ref: 'firestartr.dev://common/FirestartrOwnerRef' },
            providers: {
              type: 'object',

              properties: {
                terraform: {
                  $ref: 'firestartr.dev://terraform/TerraformProvider',
                },
              },

              additionalProperties: false,
              required: ['terraform'],
            },
          },

          required: ['owner'],
        },
      ],
    },
  },
};
