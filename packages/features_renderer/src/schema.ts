export default {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $ref: '#/definitions/root',
  definitions: {
    root: {
      type: 'object',
      additionalProperties: false,
      properties: {
        feature_name: {
          type: 'string',
        },
        args: {
          $ref: '#/definitions/Args',
        },
        files: {
          type: 'array',
          items: {
            $ref: '#/definitions/File',
          },
        },
        claimPatches: {
          type: 'array',

          items: {
            $ref: '#/definitions/Patch',
          },
        },
        // Legacy field kept for backward compatibility. Real feature packages
        // (prefapp/features) ship `patches` in the provider-keyed object
        // shape. The renderer ignores it for claim-level behaviour; claim-level
        // patches must come from `claimPatches`.
        patches: {
          type: 'object',

          patternProperties: {
            '^.+$': {
              type: 'array',

              items: {
                $ref: '#/definitions/Patch',
              },
            },
          },
        },
        filesTemplates: {
          type: 'array',
          description:
            'a list of references to a different file where files key is filled by an expanded template',
          items: {
            type: 'string',
            not: {
              pattern: '^/|(^|/)\\.\\.(/|$)',
            },
          },
        },
        enable_validation: {
          type: 'boolean',
          description:
            'when true, the user supplied featureArgs are validated against the feature schema.json during render. Absent or false skips that validation',
        },
        meta: {
          type: 'object',
          additionalProperties: false,
          properties: {
            allow_non_anchored_paths: {
              type: 'boolean',
            },
          },
        },
      },
      required: ['args', 'feature_name', 'files'],
      title: 'root',
    },
    Args: {
      type: 'object',
      additionalProperties: true,
      patternProperties: {
        '^.+$': {
          $ref: '#/definitions/Arg',
        },
      },
      title: 'Args',
    },
    Arg: {
      type: 'object',
      additionalProperties: false,
      properties: {
        $lit: {
          type: ['string', 'boolean'],
        },
        $ref: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        $arg: {
          type: 'string',
        },
        $format: {
          type: 'string',
        },
        $template: {
          type: 'string',
        },
        $default: {
          type: ['string', 'array', 'boolean'],
        },
      },
    },
    File: {
      type: 'object',
      additionalProperties: true,
      properties: {
        src: {
          type: 'string',
          not: {
            pattern: '^/|(^|/)\\.\\.(/|$)',
          },
        },
        dest: {
          type: 'string',
          not: {
            pattern: '^/|(^|/)\\.\\.(/|$)',
          },
        },
        upgradable: {
          type: 'boolean',
        },
        target_branch: {
          type: 'string',
        },
      },
      required: ['dest', 'src'],
      title: 'File',
    },
    Patch: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
        },
        op: {
          type: 'string',
        },
        path: {
          type: 'string',
        },
        value: {
          type: ['string', 'object', 'array', 'number', 'boolean', 'null'],
        },
      },
      required: ['op', 'path'],
      title: 'Patch',
    },
  },
};
