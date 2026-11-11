export default {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Firestartr application',
  description:
    "An application's state repository, services and target platforms.",
  type: 'object',
  properties: {
    name: {
      title: 'Application name',
      description: 'Name used to identify the application.',
      type: 'string',
    },
    state_repo: {
      title: 'State repository',
      description: "Repository containing the application's desired state.",
      type: 'string',
    },
    platforms: {
      title: 'Application platforms',
      description: 'Names of platforms targeted by the application.',
      type: 'array',
      items: {
        type: 'string',
        title: 'Platform name',
        description: 'Name of a platform in platforms/.',
      },
    },
    services: {
      title: 'Application services',
      description:
        'Source repositories and service names belonging to the application.',
      type: 'array',
      items: {
        title: 'Service configuration',
        description:
          "A source repository's services and optional platform targets.",
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            title: 'Service repository',
            description: 'Repository containing the service source.',
          },
          platforms: {
            title: 'Service platforms',
            description: 'Names of platforms targeted by these services.',
            type: 'array',
            items: {
              type: 'string',
              title: 'Platform name',
              description: 'Name of a platform in platforms/.',
            },
          },
          service_names: {
            title: 'Service names',
            description: 'Services built from this repository.',
            type: 'array',
            items: {
              type: 'string',
              title: 'Service name',
              description: 'Name identifying a service.',
            },
            minItems: 1,
          },
        },
        required: ['repo', 'service_names'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'state_repo', 'services'],
  additionalProperties: false,
};
