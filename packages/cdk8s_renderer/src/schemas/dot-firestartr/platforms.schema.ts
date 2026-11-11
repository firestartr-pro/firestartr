export default {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Firestartr platform',
  description: "A platform's type, tenants, environments and allowed claims.",
  type: 'object',
  properties: {
    type: {
      type: 'string',
      title: 'Platform type',
      description: 'Type identifying the platform.',
    },
    name: {
      type: 'string',
      title: 'Platform name',
      description: 'Name referenced by application configurations.',
    },
    tenants: {
      title: 'Tenants',
      description: 'Tenants available on the platform.',
      type: 'array',
      items: {
        type: 'string',
        title: 'Tenant name',
        description: 'Name identifying a tenant.',
      },
      minItems: 1,
    },
    envs: {
      title: 'Environments',
      description: 'Environments available on the platform.',
      type: 'array',
      items: {
        type: 'string',
        title: 'Environment name',
        description: 'Name identifying an environment.',
      },
      minItems: 1,
    },
    allowedClaims: {
      title: 'Allowed claims',
      description:
        'Claim resource types, providers and backends available on the platform.',
      type: 'array',
      items: {
        title: 'Allowed claim configuration',
        description:
          'An allowed combination of resource types, providers and backend.',
        type: 'object',
        properties: {
          resourceTypes: {
            title: 'Resource types',
            description: 'Allowed claim resource types.',
            type: 'array',
            items: {
              type: 'string',
              title: 'Resource type',
              description: 'Name of an allowed resource type.',
            },
            minItems: 1,
          },
          providers: {
            title: 'Providers',
            description: 'Allowed claim providers.',
            type: 'array',
            items: {
              type: 'string',
              title: 'Provider name',
              description: 'Name of an allowed provider.',
            },
            minItems: 1,
          },
          backend: {
            type: 'string',
            title: 'Backend',
            description: 'Backend used for the allowed claims.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  required: ['type', 'name', 'tenants', 'envs'],
  additionalProperties: false,
};
