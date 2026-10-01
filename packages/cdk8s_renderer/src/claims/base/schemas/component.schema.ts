import { SCHEMA } from '../schema';

export default {
  $schema: SCHEMA,

  $id: 'ComponentClaim',

  definitions: {
    ApiDefinition: {
      $id: 'firestartr.dev://common/ComponentClaimApiDefinition',
      type: 'object',
      properties: {
        name: { type: 'string' },
        definitionfile: { type: 'string' },
        type: { type: 'string' },
      },
      required: ['name', 'definitionfile', 'type'],
      additionalProperties: false,
    },

    ComponentClaim: {
      $id: 'firestartr.dev://common/ComponentClaim',

      type: 'object',

      description: 'A component claim',

      unevaluatedProperties: false,

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimEnvelope' },

        {
          type: 'object',

          properties: {
            system: { $ref: 'firestartr.dev://common/FirestartrSystemRef' },
            owner: { $ref: 'firestartr.dev://common/FirestartrOwnerRef' },
            maintainedBy: {
              type: 'array',
              items: {
                $ref: 'firestartr.dev://common/FirestartrMaintainerRef',
              },
            },
            platformOwner: {
              $ref: 'firestartr.dev://common/FirestartrOwnerRef',
            },
            subComponentOf: {
              $ref: 'firestartr.dev://common/FirestartrComponentRef',
            },
            providesApis: {
              anyOf: [
                {
                  type: 'array',
                  items: {
                    $ref: 'firestartr.dev://common/ComponentClaimApiDefinition',
                  },
                },
                {
                  type: 'object',
                  additionalProperties: {
                    $ref: 'firestartr.dev://common/ComponentClaimApiDefinition',
                  },
                },
              ],
            },
            consumesApis: {
              type: 'array',
              items: { type: 'string' },
            },
            providers: {
              type: 'object',
              properties: {
                github: {
                  $ref: 'firestartr.dev://github/GithubComponentClaim',
                },
              },
              additionalProperties: false,
            },
          },

          required: ['owner'],
        },
      ],
    },
  },
};
