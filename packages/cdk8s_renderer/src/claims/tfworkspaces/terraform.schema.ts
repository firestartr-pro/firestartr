export default {
  $id: 'TerraformProvider',
  definitions: {
    TerraformProviderFiles: {
      $id: 'firestartr.dev://terraform/TerraformProviderFiles',
      description: 'A list of files included in the terraform project',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'path of the original file to include in the final CR',
          },
          destination: {
            type: 'string',
            description:
              'path where the file will be placed in the final terraform project',
          },
        },
        additionalProperties: false,
        required: ['source', 'destination'],
      },
    },
    TerraformProvider: {
      $id: 'firestartr.dev://terraform/TerraformProvider',

      type: 'object',

      description: 'A terraform workspace',

      allOf: [
        {
          $ref: 'firestartr.dev://common/ClaimProviderEnvelope',
        },

        {
          type: 'object',

          properties: {
            policy: {
              type: 'string',

              enum: [
                'apply',
                'create-only',
                'create-update-only',
                'full-control',
                'observe',
                'observe-only',
              ],
            },

            name: {
              type: 'string',
            },

            tfStateKey: {
              $ref: 'firestartr.dev://common/TerraformStateKey',
            },

            source: {
              type: 'string',

              enum: ['remote', 'inline', 'Remote', 'Inline'],
            },

            files: {
              $ref: 'firestartr.dev://terraform/TerraformProviderFiles',
            },

            sync: {
              type: 'object',
              properties: {
                enabled: {
                  type: 'boolean',
                },
                period: {
                  type: 'string',
                  pattern: '^[0-9]+[smhd]$',
                },
                schedule: {
                  type: 'string',
                },
                schedule_timezone: {
                  type: 'string',
                },
                policy: {
                  type: 'string',
                },
              },
              additionalProperties: false,
              required: ['enabled'],
              oneOf: [
                {
                  required: ['period'],
                },
                {
                  required: ['schedule'],
                },
                {
                  not: {
                    anyOf: [
                      {
                        required: ['period'],
                      },
                      {
                        required: ['schedule'],
                      },
                    ],
                  },
                },
              ],
            },

            valuesSchema: {
              type: 'string',

              description: 'a locator for a json schema to validate values',
            },

            values: {
              type: 'object',

              properties: {},

              additionalProperties: true,
            },

            module: {
              type: 'string',
            },

            variants: {
              type: 'array',
              items: {
                $ref: 'firestartr.dev://terraform/TerraformProviderVariant',
              },
              description:
                'variant clones of this workspace — stripped before parent claim validation',
            },

            context: {
              type: 'object',

              properties: {
                providers: {
                  type: 'array',

                  items: {
                    type: 'object',

                    properties: {
                      name: {
                        type: 'string',
                      },
                    },

                    additionalProperties: false,
                  },
                },

                backend: {
                  type: 'object',

                  properties: {
                    name: {
                      type: 'string',
                    },
                  },

                  additionalProperties: false,
                },
              },
              required: ['providers'],

              additionalProperties: false,
            },
          },

          additionalProperties: false,
          required: ['values', 'context', 'source', 'name'],
        },
      ],
    },

    TerraformProviderVariantOverride: {
      $id: 'firestartr.dev://terraform/TerraformProviderVariantOverride',

      description: 'Override fields for a variant of a TFWorkspaceClaim',

      type: 'object',

      properties: {
        values: {
          type: 'object',
          additionalProperties: true,
          description: 'override values',
        },

        context: {
          type: 'object',
          properties: {
            providers: {
              type: 'array',
              items: {
                type: 'object',
                properties: { name: { type: 'string' } },
                additionalProperties: false,
              },
            },
            backend: {
              type: 'object',
              properties: { name: { type: 'string' } },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
          description: 'override context',
        },

        files: {
          $ref: 'firestartr.dev://terraform/TerraformProviderFiles',
        },

        policy: {
          type: 'string',
          enum: [
            'apply',
            'create-only',
            'create-update-only',
            'full-control',
            'observe',
            'observe-only',
          ],
        },

        tfStateKey: {
          $ref: 'firestartr.dev://common/TerraformStateKey',
        },

        sync: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            period: { type: 'string', pattern: '^[0-9]+[smhd]$' },
            schedule: { type: 'string' },
            schedule_timezone: { type: 'string' },
            policy: { type: 'string' },
          },
          additionalProperties: false,
        },

        valuesSchema: {
          type: 'string',
        },
      },

      additionalProperties: false,
    },

    TerraformProviderVariant: {
      $id: 'firestartr.dev://terraform/TerraformProviderVariant',

      description: 'A single variant of a TFWorkspace',

      type: 'object',

      properties: {
        name: {
          type: 'string',
          maxLength: 10,
          description:
            'shorthand suffix — composed with main tf name to form the final CR name',
        },

        overrides: {
          $ref: 'firestartr.dev://terraform/TerraformProviderVariantOverride',
        },
      },

      additionalProperties: false,
      required: ['name', 'overrides'],
    },
  },
};
