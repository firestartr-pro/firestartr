import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,
  $id: 'ExternalSecretsProvider',
  definitions: {
    SecretStore: {
      $id: 'firestartr.dev://secrets/SecretStore',
      type: 'object',
      properties: {
        name: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['SecretStore', 'ClusterSecretStore'],
        },
      },
      additionalProperties: false,
      required: ['name'],
    },

    ExternalSecretsSection: {
      $id: 'firestartr.dev://secrets/ExternalSecretsSection',
      type: 'object',
      properties: {
        refreshInterval: { type: 'string' },
        secrets: {
          type: 'array',
          items: {
            additionalProperties: false,
            type: 'object',
            properties: {
              secretName: {
                type: 'string',
                description:
                  'Validation for Kubernetes Secret keys, allowing only alphanumeric characters, hyphens, underscores, and dots.',
                pattern: '^([a-zA-Z0-9._-]+)$',
              },
              remoteRef: { type: 'string' },
            },
            required: ['secretName'],
          },
        },
      },
    },
    PushSecretsSection: {
      $id: 'firestartr.dev://secrets/PushSecretsSection',
      type: 'array',
      items: {
        type: 'object',
        properties: {
          data: { type: 'object' },
          template: { type: 'object' },
          secretName: { type: 'string' },
          refreshInterval: { type: 'string' },
          updatePolicy: { type: 'string' },
          deletionPolicy: { type: 'string' },
          conversionStrategy: { type: 'string' },
          generator: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              kind: {
                type: 'string',
                enum: [
                  'ACRAccessToken',
                  'ClusterGenerator',
                  'ECRAuthorizationToken',
                  'Fake',
                  'GCRAccessToken',
                  'GithubAccessToken',
                  'QuayAccessToken',
                  'Password',
                  'STSSessionToken',
                  'UUID',
                  'VaultDynamicSecret',
                  'Webhook',
                  'Grafana',
                ],
              },
              apiVersion: { type: 'string' },
              conversionStrategy: { type: 'string' },
              outputKey: { type: 'string' },
            },
            additionalProperties: false,
            required: ['name'],
          },
        },
        additionalProperties: false,
        required: ['secretName', 'generator'],
      },
    },
    ExternalSecretsProvider: {
      $id: 'firestartr.dev://secrets/ExternalSecretsProvider',
      type: 'object',
      description: 'A external secrets claim provider',
      allOf: [
        { $ref: 'firestartr.dev://common/ClaimProviderEnvelope' },
        {
          type: 'object',
          properties: {
            externalSecrets: {
              $ref: 'firestartr.dev://secrets/ExternalSecretsSection',
            },
            secretStore: {
              $ref: 'firestartr.dev://secrets/SecretStore',
            },
            pushSecrets: {
              $ref: 'firestartr.dev://secrets/PushSecretsSection',
            },
          },
          // 1. MANDATORY RULE (ALWAYS): secretStore
          required: ['secretStore'],
          // 2. CONDITIONAL RULE (AT LEAST ONE): externalSecrets OR pushSecrets
          anyOf: [
            { required: ['externalSecrets'] },
            { required: ['pushSecrets'] },
          ],
        },
      ],
    },
  },
};
