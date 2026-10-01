import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,
  $id: 'GithubOrgWebhookClaim',
  definitions: {
    GithubOrgWebhookClaim: {
      $id: 'firestartr.dev://github/GithubOrgWebhookClaim',
      type: 'object',
      description: 'A Github Organization Webhook claim',
      allOf: [
        { $ref: 'firestartr.dev://common/ClaimProviderEnvelope' },
        {
          type: 'object',
          properties: {
            name: {
              type: 'string',
            },
            tfStateKey: {
              $ref: 'firestartr.dev://common/TerraformStateKey',
            },
            orgName: {
              $ref: 'firestartr.dev://common/ClaimName',
            },
            webhook: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'Webhook endpoint URL',
                },
                contentType: {
                  type: 'string',
                  description: 'Payload content type (json or form)',
                  enum: ['json', 'form'],
                },
                active: {
                  type: 'boolean',
                  description: 'If the webhook is active',
                },
                secretRef: {
                  $ref: 'firestartr.dev://github/GithubComponentClaimSecretRef',
                },
                events: {
                  type: 'array',
                  description:
                    'List of events that trigger the webhook (e.g., push, pull_request, issues)',
                  items: {
                    type: 'string',
                  },
                },
              },
              additionalProperties: false,
              required: ['url', 'contentType', 'events', 'secretRef'],
            },
          },
          additionalProperties: false,
          required: ['orgName', 'webhook'],
        },
      ],
    },
  },
};
