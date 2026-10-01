import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,

  $id: 'GithubComponentClaim',

  definitions: {
    GithubComponentClaim: {
      $id: 'firestartr.dev://github/GithubComponentClaim',

      type: 'object',

      description: 'A component github claim',

      unevaluatedProperties: false,

      allOf: [
        { $ref: 'firestartr.dev://common/ClaimProviderEnvelope' },

        {
          type: 'object',

          properties: {
            org: {
              $ref: 'firestartr.dev://common/ClaimName',
            },

            name: {
              type: 'string',

              description: 'The github repo name',
            },

            tfStateKey: {
              $ref: 'firestartr.dev://common/TerraformStateKey',
            },

            orgPermissions: {
              type: 'string',
              description: 'The level of org Permission',
            },

            sync: {
              $ref: 'firestartr.dev://common/FirestartrGithubSync',
            },

            technology: {
              type: 'object',
              properties: {
                stack: { type: 'string' },
                version: { type: 'string' },
              },
              additionalProperties: false,
              required: ['stack', 'version'],
            },

            defaultBranch: {
              type: 'string',
            },

            branchStrategy: {
              type: 'object',
              description: 'A branch strategy for a claim',
              properties: {
                name: {
                  type: 'string',
                },
                defaultBranch: {
                  type: 'string',
                },
              },
              additionalProperties: false,
              required: ['name'],
            },

            additionalBranches: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  orphan: { type: 'boolean' },
                },
                additionalProperties: false,
                required: ['name', 'orphan'],
              },
            },

            actions: {
              type: 'object',
              description: 'Actions configuration',
              properties: {
                oidc: {
                  type: 'object',
                  properties: {
                    useDefault: { type: 'boolean' },
                    includeClaimKeys: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
              required: ['oidc'],
            },

            archiveOnDestroy: {
              type: 'boolean',
              description:
                'whether this repo should be archived when the claim is deleted',
            },
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
            allowUpdateBranch: {
              type: 'boolean',
            },
            hasIssues: {
              type: 'boolean',
            },
            hasWiki: {
              type: 'boolean',
            },
            hasDiscussions: {
              type: 'boolean',
            },
            pages: {
              $ref: 'firestartr.dev://github/GithubPages',
            },

            additionalRules: {
              type: 'array',
              items: {
                $ref: 'firestartr.dev://common/FirestartrGithubRules',
              },
            },

            visibility: {
              type: 'string',

              enum: ['private', 'public', 'internal'],
            },
            description: {
              type: 'string',
              description: 'The purpose of this repo',
            },
            features: {
              type: 'array',

              items: {
                $ref: 'firestartr.dev://github/GithubComponentFeatureClaim',
              },
            },

            vars: {
              $ref: 'firestartr.dev://github/GithubComponentClaimVars',
            },

            secrets: {
              $ref: 'firestartr.dev://github/GithubComponentClaimSecrets',
            },

            topics: {
              type: 'array',
              items: {
                type: 'string',
                maxLength: 50,
                pattern: '^[a-z0-9][a-z0-9-]*$',
              },
            },

            labels: {
              type: 'array',
              items: {
                $ref: 'firestartr.dev://github/GithubComponentClaimLabel',
              },
            },

            overrides: {
              type: 'object',
              properties: {},
              additionalProperties: true,
            },
          },

          additionalProperties: false,
          required: ['visibility', 'org', 'branchStrategy'],
        },
      ],
    },
  },
};
