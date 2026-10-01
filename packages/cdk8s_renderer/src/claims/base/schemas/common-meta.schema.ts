export default {
  $id: 'Common-meta',

  definitions: {
    Envelope: {
      $id: 'firestartr.dev://common/ClaimEnvelope',

      type: 'object',

      description: 'An envelope for a any kind of claim',

      properties: {
        name: {
          $ref: 'firestartr.dev://common/ClaimName',
        },

        kind: {
          type: 'string',
        },

        description: {
          type: 'string',
        },

        type: {
          type: 'string',
        },

        lifecycle: {
          type: 'string',
        },

        version: {
          type: 'string',
        },

        providers: {
          type: 'object',

          description: 'A map of providers',
        },

        profile: {
          $ref: 'firestartr.dev://common/ClaimProfile',
        },

        annotations: {
          $ref: 'firestartr.dev://common/FirestartrAnnotations',
        },
      },

      required: ['name', 'kind', 'providers'],
    },

    Provider: {
      $id: 'firestartr.dev://common/ClaimProviderEnvelope',

      type: 'object',

      description: 'An envelope for a any kind of claim',

      properties: {
        name: {
          type: 'string',
        },
      },

      additionalProperties: true,

      required: ['name'],
    },

    Profile: {
      $id: 'firestartr.dev://common/ClaimProfile',

      type: 'object',

      description: 'A profile for a claim',

      properties: {
        displayName: {
          type: 'string',
        },

        email: {
          type: 'string',
        },

        picture: {
          type: 'string',
        },
      },

      additionalProperties: false,
    },

    ClaimName: {
      $id: 'firestartr.dev://common/ClaimName',
      type: 'string',
      pattern: '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$',
      maxLength: 63,
    },

    DomainReference: {
      $id: 'firestartr.dev://common/FirestartrDomainRef',

      type: 'string',

      pattern:
        '^domain:([a-z0-9]([a-z0-9._-]*[a-z0-9])?/)?[a-z0-9]([a-z0-9._-]*[a-z0-9])?$',
    },

    SystemReference: {
      $id: 'firestartr.dev://common/FirestartrSystemRef',

      type: 'string',

      pattern:
        '^system:([a-z0-9]([a-z0-9._-]*[a-z0-9])?/)?[a-z0-9]([a-z0-9._-]*[a-z0-9])?$',
    },

    ComponentReference: {
      $id: 'firestartr.dev://common/FirestartrComponentRef',

      type: 'string',

      pattern:
        '^component:([a-z0-9]([a-z0-9._-]*[a-z0-9])?/)?[a-z0-9]([a-z0-9._-]*[a-z0-9])?$',
    },

    UserReference: {
      $id: 'firestartr.dev://common/FirestartrUserRef',

      type: 'string',

      pattern:
        '^user:([a-z0-9]([a-z0-9._-]*[a-z0-9])?/)?[a-z0-9]([a-z0-9._-]*[a-z0-9])?$',
    },

    GroupReference: {
      $id: 'firestartr.dev://common/FirestartrGroupRef',

      type: 'string',

      pattern:
        '^group:([a-z0-9]([a-z0-9._-]*[a-z0-9])?/)?[a-z0-9]([a-z0-9._-]*[a-z0-9])?$',
    },

    OwnerReference: {
      $id: 'firestartr.dev://common/FirestartrOwnerRef',

      type: 'string',

      pattern:
        '^(user|group):([a-z0-9]([a-z0-9._-]*[a-z0-9])?/)?[a-z0-9]([a-z0-9._-]*[a-z0-9])?$',
    },

    MaintainerReference: {
      $id: 'firestartr.dev://common/FirestartrMaintainerRef',

      type: 'string',

      pattern:
        '^(user|group|collaborator):([a-z0-9]([a-z0-9._-]*[a-z0-9])?/)?[a-z0-9]([a-z0-9._-]*[a-z0-9])?$',
    },

    Annotations: {
      $id: 'firestartr.dev://common/FirestartrAnnotations',

      type: 'object',

      patternProperties: {
        '^[a-zA-Z0-9/.-]+$': { type: 'string' },
      },

      additionalProperties: false,
    },

    GithubRules: {
      $id: 'firestartr.dev://common/FirestartrGithubRules',

      type: 'object',

      properties: {
        path: { type: 'string' },
        owners: {
          type: 'array',
          items: {
            $ref: 'firestartr.dev://common/FirestartrOwnerRef',
          },
        },
      },

      required: ['path', 'owners'],
      additionalProperties: false,
    },

    GithubSync: {
      $id: 'firestartr.dev://common/FirestartrGithubSync',
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        period: {
          type: 'string',
          pattern: '^[0-9]+[smhd]$',
        },
        policy: { type: 'string' },
        schedule: { type: 'string' },
        schedule_timezone: { type: 'string' },
      },
      additionalProperties: false,
      required: ['enabled'],
    },

    TfStateKey: {
      $id: 'firestartr.dev://common/TerraformStateKey',
      type: 'string',
      pattern:
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12,}$',
    },
  },
};
