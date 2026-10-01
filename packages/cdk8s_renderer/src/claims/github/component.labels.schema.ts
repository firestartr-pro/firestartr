import { SCHEMA } from '../base/schema';

export default {
  $schema: SCHEMA,

  $id: 'GithubComponentClaimLabels',

  definitions: {
    GithubComponentClaimLabel: {
      $id: 'firestartr.dev://github/GithubComponentClaimLabel',
      type: 'object',
      required: ['name', 'color'],
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 50,
          pattern: '^[^"\\\\\\s]+(?: +[^"\\\\\\s]+)*$',
          description: 'Label name (1-50 chars, no " or \\ characters)',
        },
        color: {
          type: 'string',
          pattern: '^[0-9a-fA-F]{6}$',
          description: 'Color in hexadecimal without # (6 chars)',
        },
        description: {
          type: 'string',
          maxLength: 100,
          description: 'Optional label description (max 100 chars)',
        },
      },
      additionalProperties: false,
    },
  },
};
