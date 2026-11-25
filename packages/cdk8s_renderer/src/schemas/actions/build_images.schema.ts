import { SCHEMA } from '../../claims/base/schema';

const AUTH_STRATEGIES = [
  'azure_oidc',
  'aws_oidc',
  'generic',
  'ghcr',
  'dockerhub',
];

const buildFlavor = {
  type: 'object',
  properties: {
    dockerfile: {
      type: 'string',
      pattern: '.+',
    },
    auto: {
      type: 'boolean',
    },
    build_always: {
      type: 'boolean',
    },
    build_args: {
      type: 'object',
      additionalProperties: true,
    },
    secrets: {
      type: 'object',
      additionalProperties: true,
    },
    registry: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          pattern: '.+',
        },
        repository: {
          type: 'string',
          pattern: '.+',
        },
        auth_strategy: {
          type: 'string',
          enum: AUTH_STRATEGIES,
        },
      },
      additionalProperties: false,
      anyOf: [
        { required: ['name'] },
        { required: ['repository'] },
        { required: ['auth_strategy'] },
      ],
    },
    extra_registries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
          },
          repository: {
            type: 'string',
          },
          auth_strategy: {
            type: 'string',
            enum: AUTH_STRATEGIES,
          },
        },
        required: ['name', 'repository', 'auth_strategy'],
        additionalProperties: false,
      },
    },
    extra_tags: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$',
      },
    },
    platforms: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^(linux/)?(amd64|arm64)$',
      },
      minItems: 1,
      uniqueItems: true,
    },
  },
  required: ['dockerfile'],
  additionalProperties: false,
};

const flavorMap = {
  type: 'object',
  patternProperties: {
    '^[a-zA-Z0-9_-]+$': buildFlavor,
  },
  minProperties: 1,
};

export default {
  $schema: SCHEMA,
  type: 'object',
  properties: {
    snapshots: flavorMap,
    releases: flavorMap,
  },
  anyOf: [{ required: ['snapshots'] }, { required: ['releases'] }],
  additionalProperties: false,
};
