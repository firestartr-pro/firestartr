import { SCHEMA } from '../base/schema';
import { RULESET_RULE_TYPES } from './rulesetRuleTypes';

// Only the rule type is checked here. Parameters, target compatibility and
// limits are validated by the Terraform module.
export default {
  $schema: SCHEMA,
  $id: 'GithubOrgRulesetClaim',
  definitions: {
    GithubOrgRulesetClaim: {
      $id: 'firestartr.dev://github/GithubOrgRulesetClaim',
      type: 'object',
      description: 'A Github Organization Ruleset claim',
      allOf: [
        { $ref: 'firestartr.dev://common/ClaimProviderEnvelope' },
        {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              maxLength: 186,
              // The display name reaches Terraform workspace paths through
              // the firestartr.dev/external-name annotation. A path
              // separator in it could escape /tmp/gh-workspaces and make
              // the workspace builder delete and write outside it.
              pattern: '^[^/]+$',
            },
            tfStateKey: {
              $ref: 'firestartr.dev://common/TerraformStateKey',
            },
            org: {
              $ref: 'firestartr.dev://common/ClaimName',
            },
            target: {
              type: 'string',
              enum: ['branch', 'tag', 'push'],
            },
            enforcement: {
              type: 'string',
              enum: ['active', 'evaluate', 'disabled'],
            },
            conditions: {
              type: 'object',
              properties: {
                ref_name: { type: 'object' },
                repository_name: { type: 'object' },
                repository_property: { type: 'object' },
              },
              additionalProperties: false,
            },
            rules: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: RULESET_RULE_TYPES },
                  parameters: { type: 'object' },
                },
                required: ['type'],
                additionalProperties: false,
              },
            },
            bypass_actors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  actor_type: {
                    type: 'string',
                    enum: [
                      'Integration',
                      'OrganizationAdmin',
                      'Team',
                      'RepositoryRole',
                      'DeployKey',
                    ],
                  },
                  // Team actors point at a GroupClaim. The renderer resolves
                  // the claim to its FirestartrGithubGroup CR and the
                  // provisioner turns that ref into the numeric team id, so
                  // the claim never carries an org-specific slug or id.
                  group: {
                    $ref: 'firestartr.dev://common/FirestartrGroupRef',
                  },
                  actor_id: { type: 'integer' },
                  actor_slug: { type: 'string' },
                  actor_role: {
                    type: 'string',
                    enum: ['maintain', 'write', 'admin'],
                  },
                  bypass_mode: {
                    type: 'string',
                    enum: ['always', 'pull_request'],
                  },
                },
                required: ['actor_type', 'bypass_mode'],
                additionalProperties: false,
                allOf: [
                  {
                    if: { properties: { actor_type: { const: 'Team' } } },
                    then: {
                      required: ['group'],
                      not: {
                        anyOf: [
                          { required: ['actor_id'] },
                          { required: ['actor_slug'] },
                          { required: ['actor_role'] },
                        ],
                      },
                    },
                    else: { not: { required: ['group'] } },
                  },
                  {
                    if: {
                      properties: { actor_type: { const: 'Integration' } },
                    },
                    then: {
                      anyOf: [
                        { required: ['actor_id'] },
                        { required: ['actor_slug'] },
                      ],
                      not: { required: ['actor_role'] },
                    },
                    else: { not: { required: ['actor_slug'] } },
                  },
                  {
                    if: {
                      properties: { actor_type: { const: 'RepositoryRole' } },
                    },
                    then: {
                      anyOf: [
                        { required: ['actor_id'] },
                        { required: ['actor_role'] },
                      ],
                    },
                    else: { not: { required: ['actor_role'] } },
                  },
                ],
              },
            },
          },
          additionalProperties: false,
          required: ['org', 'target', 'enforcement', 'conditions'],
          // Push rulesets have no refs to match
          if: { properties: { target: { enum: ['branch', 'tag'] } } },
          then: {
            properties: { conditions: { required: ['ref_name'] } },
          },
        },
      ],
    },
  },
};
