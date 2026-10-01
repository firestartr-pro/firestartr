import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,

  $id: 'GithubPages',

  definitions: {
    GithubPages: {
      $id: 'firestartr.dev://github/GithubPages',

      type: 'object',

      description:
        'GitHub Pages configuration shared across component and repository claims',

      properties: {
        cname: { type: 'string' },
        public: { type: 'boolean' },
        https_enforced: { type: 'boolean' },
        buildType: { type: 'string', enum: ['workflow', 'legacy'] },
        source: {
          type: 'object',
          required: ['branch', 'path'],
          properties: {
            branch: { type: 'string' },
            path: { type: 'string', enum: ['/', '/docs'] },
          },
          additionalProperties: false,
        },
      },

      additionalProperties: false,

      if: {
        required: ['https_enforced'],
        properties: { https_enforced: { const: true } },
      },
      then: {
        required: ['cname'],
      },
    },
  },
};
