import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import Ajv from 'ajv';

const crdPath = path.join(
  __dirname,
  '../src/crds/crd-firestartr-github-organization-variable-section.yaml',
);

const crd = yaml.load(fs.readFileSync(crdPath, 'utf8')) as any;
const itemSchema =
  crd.spec.versions[0].schema.openAPIV3Schema.properties.spec.properties
    .actionsVariables.items;

const ajv = new Ajv({ strict: false });
const validate = ajv.compile(itemSchema);

const base = { name: 'DEPLOY_HOST', visibility: 'all' };

describe('FirestartrGithubOrganizationVariableSection actionsVariables CRD', () => {
  it('accepts a variable with a plain value', () => {
    expect(validate({ ...base, value: 'staging.example.com' })).toBe(true);
  });

  it('accepts a variable with a secret ref', () => {
    expect(
      validate({
        ...base,
        ref: { kind: 'Secret', name: 'deploy-vars', key: 'host' },
      }),
    ).toBe(true);
  });

  it('rejects a variable with both value and ref', () => {
    expect(
      validate({
        ...base,
        value: 'literal',
        ref: { kind: 'Secret', name: 'deploy-vars', key: 'host' },
      }),
    ).toBe(false);
  });

  it('rejects a variable with neither value nor ref', () => {
    expect(validate({ ...base })).toBe(false);
  });

  it('rejects a ref missing its key', () => {
    expect(
      validate({
        ...base,
        ref: { kind: 'Secret', name: 'deploy-vars' },
      }),
    ).toBe(false);
  });

  it('still requires the visibility field', () => {
    expect(validate({ name: 'X', value: 'y' })).toBe(false);
  });
});
