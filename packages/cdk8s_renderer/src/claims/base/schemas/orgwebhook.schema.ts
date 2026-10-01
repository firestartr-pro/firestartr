import { SCHEMA } from '../schema';

export default {
  $schema: SCHEMA,
  $id: 'OrgWebhookClaim',
  definitions: {
    OrgWebhookClaim: {
      $id: 'firestartr.dev://common/OrgWebhookClaim',
      type: 'object',
      description: 'A Organization Webhook claim',
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
                  $ref: 'firestartr.dev://github/GithubOrgWebhookClaim',
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
