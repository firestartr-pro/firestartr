import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,

  $id: 'GithubComponentFeatureClaim',

  definitions: {
    GithubComponentFeatureClaim: {
      $id: 'firestartr.dev://github/GithubComponentFeatureClaim',

      description: 'A feature for a GithubComponentClaim',

      type: 'object',

      properties: {
        name: {
          type: 'string',

          description: 'The name of the feature',
        },

        version: {
          type: 'string',

          description: 'The semver of the feature',
        },

        ref: {
          type: 'string',

          pattern: '^[a-zA-Z0-9-._@/]+$',

          description: 'A github reference (commit, tag, branch)',
        },

        args: {
          type: 'object',

          properties: {},

          additionalProperties: true,
        },

        repo: {
          type: 'string',

          description:
            'A repo where the feature exists, format: owner/repository',

          pattern: '^[a-zA-Z0-9-._]+/[a-zA-Z0-9-._]+$',
        },
      },

      required: ['name'],

      oneOf: [
        { type: 'object', required: ['ref'], not: { required: ['version'] } },
        { type: 'object', required: ['version'], not: { required: ['ref'] } },
      ],

      additionalProperties: false,
    },
  },
};
