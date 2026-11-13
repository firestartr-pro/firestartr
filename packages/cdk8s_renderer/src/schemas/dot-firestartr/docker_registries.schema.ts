import { SCHEMA } from '../../claims/base/schema';
import {
  REGISTRY_HOST_DESCRIPTION,
  REGISTRY_HOST_PATTERN,
} from '../registry-host';

export default {
  $schema: SCHEMA,
  title: 'Firestartr Docker registry',
  description:
    "A container registry's host, image types, authentication strategy and base paths.",
  type: 'object',
  properties: {
    name: {
      type: 'string',
      title: 'Registry name',
      description: 'Name used to identify the registry configuration.',
    },
    registry: {
      title: 'Registry host',
      description: REGISTRY_HOST_DESCRIPTION,
      type: 'string',
      pattern: REGISTRY_HOST_PATTERN,
    },
    image_types: {
      title: 'Image types',
      description: 'Image types stored in this registry.',
      type: 'array',
      items: {
        type: 'string',
        title: 'Image type',
        description: 'An image type supported by the registry.',
      },
      minItems: 1,
    },
    default: {
      type: 'boolean',
      title: 'Default registry',
      description:
        'Required for compatibility with the action contract; default-selection semantics are not defined here.',
    },
    auth_strategy: {
      title: 'Authentication strategy',
      description: 'Authentication mechanism used to access the registry.',
      type: 'string',
      enum: ['aws_oidc', 'azure_oidc', 'generic', 'ghcr', 'dockerhub', 'none'],
    },
    base_paths: {
      title: 'Registry base paths',
      description: 'Repository path prefixes for service images and charts.',
      type: 'object',
      properties: {
        services: {
          type: 'string',
          title: 'Services base path',
          description: 'Repository path prefix for service images.',
        },
        charts: {
          type: 'string',
          title: 'Charts base path',
          description: 'Repository path prefix for charts.',
        },
      },
      required: ['services'],
      additionalProperties: false,
    },
  },
  required: [
    'name',
    'registry',
    'image_types',
    'default',
    'auth_strategy',
    'base_paths',
  ],
  additionalProperties: false,
};
