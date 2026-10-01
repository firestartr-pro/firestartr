import {describe, expect, it} from '@jest/globals';

import {validateFeatureArgs} from '../src/utils/featureSchema';

describe('validateFeatureArgs', () => {
  it('does not crash on a schema declaring an unregistered $schema draft', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {crontab: {type: 'string'}},
    };

    expect(() => validateFeatureArgs(schema, {crontab: '0 */6 * * *'})).not.toThrow();
    expect(validateFeatureArgs(schema, {crontab: '0 */6 * * *'})).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateFeatureArgs(schema, {crontab: 1}).valid).toBe(false);
  });
});
