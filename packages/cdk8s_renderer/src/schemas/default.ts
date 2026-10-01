import { SCHEMA } from '../claims/base/schema';

export default {
  $schema: SCHEMA,
  type: 'object',
  properties: {
    org: {
      type: 'string',
    },
    firestartr: {
      type: 'object',
      properties: {
        technology: {
          type: 'object',
          properties: {
            stack: {
              type: 'string',
            },
            version: {
              type: 'string',
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    repo: {
      type: 'object',
      properties: {
        allowMergeCommit: {
          type: 'boolean',
        },
        allowSquashMerge: {
          type: 'boolean',
        },
        allowRebaseMerge: {
          type: 'boolean',
        },
        allowAutoMerge: {
          type: 'boolean',
        },
        deleteBranchOnMerge: {
          type: 'boolean',
        },
        autoInit: {
          type: 'boolean',
        },
        archiveOnDestroy: {
          type: 'boolean',
        },
        allowUpdateBranch: {
          type: 'boolean',
        },
        hasIssues: {
          type: 'boolean',
        },
        visibility: {
          type: 'string',
        },
        defaultBranch: {
          type: 'string',
        },
        codeowners: {
          type: 'string',
        },
      },
      additionalProperties: false,
    },
    actions: {
      type: 'object',
      properties: {
        oidc: {
          type: 'object',
          properties: {
            useDefault: {
              type: 'boolean',
            },
            includeClaimKeys: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};
