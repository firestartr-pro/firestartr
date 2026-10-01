export default {
  $schema: 'http://json-schema.org/draft-07/schema#',

  $id: 'provisioner-tf-context',

  description: 'A context for a tf provisioner',

  type: 'object',

  required: ['values', 'secrets', 'requiredProviders'],

  properties: {
    reuseExistingProject: {
      type: 'boolean',
      description: 'If true, reuse workspace and skip rebuild/init.',
      default: false,
    },
    inline: {
      type: 'string',
    },

    source: {
      type: 'string',
    },

    module: {
      type: 'string',
    },

    values: {
      type: 'object',

      additionalProperties: true,
    },

    secrets: {
      type: 'array',

      items: {
        type: 'object',

        properties: {
          key: {
            type: 'string',
          },

          value: {
            type: 'string',
          },
        },
      },
    },

    requiredProviders: {
      type: 'array',

      items: {
        type: 'object',

        properties: {
          source: {
            type: 'string',
          },
          version: {
            type: 'string',
          },

          name: {
            type: 'string',
          },

          config: {
            type: 'object',

            additionalProperties: true,
          },
        },

        required: ['source', 'version', 'name', 'config'],
      },
    },
    tfStateKey: {
      type: 'string',
    },
    tfStatePath: {
      type: 'string',
    },
    projectPath: {
      type: 'string',
    },
    references: {
      type: 'object',

      additionalProperties: true,
    },
  },
};
