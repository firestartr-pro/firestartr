import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,

  $id: 'ArgoCDProvider',

  definitions: {
    ArgoCDProvider: {
      $id: 'firestartr.dev://argocd/ArgoCDProvider',

      type: 'object',

      description: 'An argocd deploy',

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimProviderEnvelope' },

        {
          type: 'object',

          properties: {
            name: {
              type: 'string',
            },

            project: {
              type: 'string',
            },

            chart: {
              $ref: 'firestartr.dev://argocd/ArgoCDProviderChart',
            },

            values: {
              type: 'array',

              items: {
                $ref: 'firestartr.dev://argocd/ArgoCDProviderValues',
              },
            },

            destination: {
              type: 'object',

              properties: {
                namespace: {
                  type: 'string',

                  description: 'namespace to deploy',
                },

                server: {
                  type: 'string',
                },

                name: {
                  type: 'string',
                },
              },
            },
          },

          required: ['name'],
        },
      ],
    },

    ArgoCDProviderChart: {
      $id: 'firestartr.dev://argocd/ArgoCDProviderChart',

      type: 'object',

      description: 'An argocd deploy chart reference',

      properties: {
        name: {
          type: 'string',

          description: 'The name of the chart',
        },

        version: {
          type: 'string',

          description: 'Version to use of the chart',
        },

        oci: {
          type: 'boolean',

          description: 'Whether the chart is an oci chart',

          default: false,
        },

        source: {
          type: 'string',

          description: 'RepoURL or registry for the chart',
        },
      },

      required: ['name', 'version', 'source'],
    },

    ArgoCDProviderValues: {
      $id: 'firestartr.dev://argocd/ArgoCDProviderValues',

      type: 'object',

      description: 'An argocd deploy values',

      properties: {
        source: {
          type: 'string',

          description: 'RepoURL of the values',
        },

        paths: {
          type: 'array',

          items: {
            type: 'string',

            description: 'path to get values from',
          },
        },

        revision: {
          type: 'string',

          description: 'revision of the repo',
        },
      },

      required: ['source', 'paths', 'revision'],
    },
  },
};
