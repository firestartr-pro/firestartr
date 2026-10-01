import { SCHEMA } from '../claims/base/schema';

export default {
  $schema: SCHEMA,
  type: 'object',
  properties: {
    strategies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
          },
          values: {
            type: 'object',
            properties: {
              defaultBranch: {
                type: 'string',
              },
              branchProtections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    branch: {
                      type: 'string',
                    },
                    statusChecks: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                    requiredReviewersCount: {
                      type: 'integer',
                    },
                    requiredCodeownersReviewers: {
                      type: 'boolean',
                    },
                    enforceAdmins: {
                      type: 'boolean',
                    },
                    requireSignedCommits: {
                      type: 'boolean',
                    },
                    requireConversationResolution: {
                      type: 'boolean',
                    },
                  },
                  required: [
                    'branch',
                    'statusChecks',
                    'requiredReviewersCount',
                    'requiredCodeownersReviewers',
                    'enforceAdmins',
                    'requireSignedCommits',
                    'requireConversationResolution',
                  ],
                },
              },
            },
          },
        },
        required: ['name', 'values'],
      },
    },
  },
};
