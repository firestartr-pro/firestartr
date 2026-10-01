import { SCHEMA } from '../claims/base/schema';

export default {
  $schema: SCHEMA,
  type: 'object',
  properties: {
    stack: {
      type: 'string',
    },
    version: {
      type: 'string',
    },
  },
  additionalProperties: false,
};
