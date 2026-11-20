import { SCHEMA } from '../schema';

export default {
  $schema: SCHEMA,
  $id: 'OrgRulesetClaim',
  definitions: {
    OrgRulesetClaim: {
      $id: 'firestartr.dev://common/OrgRulesetClaim',
      type: 'object',
      description: 'An Organization Ruleset claim',
      unevaluatedProperties: false,
      allOf: [
        { $ref: 'firestartr.dev://common/ClaimEnvelope' },
        {
          type: 'object',
          properties: {
            system: {
              $ref: 'firestartr.dev://common/FirestartrSystemRef',
            },
            owner: {
              $ref: 'firestartr.dev://common/FirestartrOwnerRef',
            },
            providers: {
              type: 'object',
              properties: {
                github: {
                  $ref: 'firestartr.dev://github/GithubOrgRulesetClaim',
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
