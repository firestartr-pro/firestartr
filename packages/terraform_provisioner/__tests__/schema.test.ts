import Ajv from 'ajv';
import schema from '../src/schema';

const ajv = new Ajv();
const validate = ajv.compile(schema);

function baseContext(requiredProviders: any[]) {
  return {
    values: {},
    secrets: [],
    requiredProviders,
  };
}

describe('provisioner context schema', () => {
  it('accepts a requiredProviders entry without source/version (backend use case)', () => {
    const valid = validate(
      baseContext([{ name: 'aws', config: { bucket: 'x' } }]),
    );

    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('still accepts a requiredProviders entry with source/version (retro-compatibility)', () => {
    const valid = validate(
      baseContext([
        {
          name: 'aws',
          source: 'hashicorp/aws',
          version: '5.0.0',
          config: { bucket: 'x' },
        },
      ]),
    );

    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it('still requires name and config on each requiredProviders entry', () => {
    const valid = validate(baseContext([{ source: 'hashicorp/aws' }]));

    expect(valid).toBe(false);
  });
});
