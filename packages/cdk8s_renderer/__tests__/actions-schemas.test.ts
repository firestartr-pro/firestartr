import Ajv from 'ajv';
import { schemas, config, buildImagesResults } from '../src/schemas/actions';
import { schemas as dotFirestartr } from '../src/schemas/dot-firestartr';
import {
  REGISTRY_HOST_PATTERN,
  REGISTRY_HOST_DESCRIPTION,
} from '../src/schemas/registry-host';

const ajv = new Ajv({ allErrors: true });
const validateConfig = ajv.compile(config);
const validateBuild = ajv.compile(buildImagesResults);
const deployment = {
  tenant: 'tenant',
  platform: 'platform',
  env: 'pro',
  type: 'releases',
  flavor: 'default',
  version: 'v1.2.3',
  application: 'app',
};
const image = {
  registry: 'ghcr.io',
  repository: 'service/org/app',
  image_tag: 'abc123_default',
};

test.each([
  'version1',
  'version-releases1',
  'v1.2.3',
  '$latest_release',
  '$latest_prerelease',
  '$branch_feature/my-branch',
  '$highest_semver_release_v1',
  '$highest_semver_prerelease_v1.2+build',
])('accepts version %s', (version) => {
  expect(validateConfig({ deployments: [{ ...deployment, version }] })).toBe(
    true,
  );
});

test.each([
  '',
  '$latest_releaseXYZ',
  'prefix$latest_release',
  '$branch_',
  'prefix$branch_',
  '$highest_semver',
  '$highest_semverXYZ',
  '$latest_release_custom',
  '$latest_prerelease_custom',
  'Bad!',
])('rejects version %s', (version) => {
  expect(validateConfig({ deployments: [{ ...deployment, version }] })).toBe(
    false,
  );
});

test.each(config.properties.deployments.items.required)(
  'requires deployment %s',
  (key) => {
    const invalid: Record<string, unknown> = { ...deployment };
    delete invalid[key];
    expect(validateConfig({ deployments: [invalid] })).toBe(false);
  },
);

test('config rejects unknown fields and requires deployments', () => {
  expect(validateConfig({})).toBe(false);
  expect(validateConfig({ deployments: [], extra: true })).toBe(false);
  expect(
    validateConfig({ deployments: [{ ...deployment, extra: true }] }),
  ).toBe(false);
  expect(validateConfig({ deployments: [] })).toBe(true);
});

test('build summaries allow empty arrays and unconstrained metadata', () => {
  expect(validateBuild([])).toBe(true);
  expect(validateBuild([{ ...image, metadata: { arbitrary: true } }])).toBe(
    true,
  );
});

test.each(['registry', 'repository', 'image_tag'])(
  'requires image %s',
  (key) => {
    const invalid: Record<string, unknown> = { ...image };
    delete invalid[key];
    expect(validateBuild([invalid])).toBe(false);
  },
);

test.each([
  ['registry', 'host:5000'],
  ['registry', ''],
  ['repository', 'bad repository'],
  ['image_tag', '-bad'],
  ['image_tag', 'x'.repeat(129)],
])('rejects invalid %s: %s', (key, value) => {
  expect(validateBuild([{ ...image, [key]: value }])).toBe(false);
});

test('action views reuse canonical schemas and the registry rule', () => {
  expect(schemas['firestartr-apps']).toBe(dotFirestartr.apps);
  expect(schemas['firestartr-platforms']).toBe(dotFirestartr.platforms);
  expect(schemas['firestartr-registries']).toBe(
    dotFirestartr.docker_registries,
  );
  for (const registry of [
    buildImagesResults.items.properties.registry,
    dotFirestartr.docker_registries.properties.registry,
  ]) {
    expect(registry.pattern).toBe(REGISTRY_HOST_PATTERN);
    expect(registry.description).toBe(REGISTRY_HOST_DESCRIPTION);
  }
});
