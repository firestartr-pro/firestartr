export const VERSION_PATTERN =
  '^(?:\\$latest_release|\\$latest_prerelease|\\$branch_[A-Za-z0-9._/-]+|\\$highest_semver_(?:release|prerelease)_[A-Za-z0-9._/+-]*[0-9][A-Za-z0-9._/+-]*|[a-z0-9 _.-]+)$';

export default {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    deployments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dispatch_event_type: { type: 'string' },
          tenant: { type: 'string' },
          platform: { type: 'string' },
          claim: { type: 'string' },
          env: { type: 'string' },
          type: { type: 'string' },
          flavor: { type: 'string' },
          version: { type: 'string', pattern: VERSION_PATTERN },
          application: { type: 'string' },
          service_names: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
          image_keys: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
          registry: { type: 'string' },
          image_repository: { type: 'string' },
          state_repo: { type: 'string' },
          base_path: { type: 'string' },
        },
        required: [
          'tenant',
          'platform',
          'env',
          'type',
          'flavor',
          'version',
          'application',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['deployments'],
  additionalProperties: false,
};
