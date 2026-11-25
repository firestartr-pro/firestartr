import Ajv from 'ajv/dist/2020';
import {
  schemas,
  config,
  buildImages,
  buildImagesResults,
} from '../src/schemas/actions';
import { schemas as dotFirestartr } from '../src/schemas/dot-firestartr';
import {
  REGISTRY_HOST_PATTERN,
  REGISTRY_HOST_DESCRIPTION,
} from '../src/schemas/registry-host';

const ajv = new Ajv({ allErrors: true });
const validateConfig = ajv.compile(config);
const validateBuild = ajv.compile(buildImagesResults);
const validateBuildImages = ajv.compile(buildImages);
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
  '$branch_release+hotfix',
  '$highest_semver_release_v1',
  '$highest_semver_release_1',
  '$highest_semver_release_v1.2',
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
  '$highest_semver_release_foo',
  '$highest_semver_prerelease_foo',
  '$highest_semver_release_',
  '$highest_semver_prerelease_',
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
  expect(schemas['build-images']).toBe(buildImages);
  expect('$id' in buildImages).toBe(false);
  for (const registry of [
    buildImagesResults.items.properties.registry,
    dotFirestartr.docker_registries.properties.registry,
  ]) {
    expect(registry.pattern).toBe(REGISTRY_HOST_PATTERN);
    expect(registry.description).toBe(REGISTRY_HOST_DESCRIPTION);
  }
});

// Upstream valid fixture: prefapp/firestarter-workflows v4.0.1
// firestarter/tests/fixtures/build_images.yaml
const upstreamBuildImagesValid = {
  snapshots: {
    flavor1: {
      dockerfile: 'firestarter/tests/fixtures/Dockerfile',
      auto: false,
      build_args: { ARG1: 'value1', ARG2: 'value2' },
      secrets: { SECRET1: 'secret_value1', SECRET2: 'secret_value2' },
      registry: {
        name: 'xxxx.azurecr.io',
        repository: 'xxx/yyy',
        auth_strategy: 'azure_oidc',
      },
      extra_registries: [
        {
          name: 'registry1',
          repository: 'repo1',
          auth_strategy: 'azure_oidc',
        },
      ],
      extra_tags: ['flavor1-custom-tag'],
      platforms: ['linux/amd64'],
    },
    flavor3: {
      dockerfile: 'firestarter/tests/fixtures/Dockerfile',
      auto: true,
      registry: {
        name: 'test-registry',
        repository: 'repository3',
      },
      build_args: { ARG4: 'value4', ARG5: 'value5' },
      secrets: { SECRET4: 'secret_value4', SECRET5: 'secret_value5' },
      extra_registries: [
        {
          name: 'registry3',
          repository: 'repo3',
          auth_strategy: 'azure_oidc',
        },
      ],
      extra_tags: ['flavor3-custom-tag'],
      platforms: ['linux/amd64', 'linux/arm64'],
    },
  },
  releases: {
    flavor2: {
      dockerfile: 'firestarter/tests/fixtures/Dockerfile',
      auto: false,
      build_args: { ARG3: 'value3' },
      secrets: { SECRET3: 'secret_value3' },
      registry: {
        name: 'xxxx.azurecr.io',
        repository: 'xxx/yyy',
        auth_strategy: 'azure_oidc',
      },
      extra_registries: [
        {
          name: 'registry2',
          repository: 'repo2',
          auth_strategy: 'aws_oidc',
        },
      ],
      extra_tags: ['flavor2-custom-tag'],
      platforms: ['linux/arm64'],
    },
  },
};

test('build-images accepts upstream fixture and minimal snapshots/releases', () => {
  expect(validateBuildImages(upstreamBuildImagesValid)).toBe(true);
  expect(
    validateBuildImages({
      snapshots: {
        default: {
          dockerfile: 'Dockerfile',
          build_always: true,
          platforms: ['amd64', 'arm64'],
        },
      },
    }),
  ).toBe(true);
  expect(
    validateBuildImages({
      releases: {
        default: {
          dockerfile: 'Dockerfile',
          registry: { auth_strategy: 'ghcr' },
        },
      },
    }),
  ).toBe(true);
});

test.each(['azure_oidc', 'aws_oidc', 'generic', 'ghcr', 'dockerhub'])(
  'build-images accepts auth_strategy %s in registry and extra_registries',
  (auth_strategy) => {
    for (const section of ['snapshots', 'releases'] as const) {
      expect(
        validateBuildImages({
          [section]: {
            default: {
              dockerfile: 'Dockerfile',
              registry: { name: 'reg', repository: 'repo', auth_strategy },
              extra_registries: [
                { name: 'reg', repository: 'repo', auth_strategy },
              ],
            },
          },
        }),
      ).toBe(true);
    }
  },
);

test('build-images rejects upstream invalid fixture and constraint violations', () => {
  // Upstream invalid fixture: firestarter/tests/fixtures/build_images_ko.yaml
  expect(
    validateBuildImages({
      snapshots: {
        invalid_snapshot: {
          dockerfile: 'docker/Dockerfile',
          auto: true,
          extra_property: 'no permitida',
        },
      },
      releases: {
        invalid_release: {
          dockerfile: 'docker/Dockerfile',
          auto: true,
          build_args: { API_URL: 'api.test.com' },
        },
      },
    }),
  ).toBe(false);

  // Root constraints
  expect(validateBuildImages({})).toBe(false);
  expect(
    validateBuildImages({
      snapshots: { default: { dockerfile: 'Dockerfile' } },
      extra: {},
    }),
  ).toBe(false);
  expect(validateBuildImages({ snapshots: {} })).toBe(false);
  expect(validateBuildImages({ releases: {} })).toBe(false);

  // Flavor constraints
  expect(validateBuildImages({ snapshots: { default: {} } })).toBe(false);
  expect(
    validateBuildImages({ snapshots: { default: { dockerfile: '' } } }),
  ).toBe(false);
  expect(
    validateBuildImages({
      snapshots: { default: { dockerfile: 'Dockerfile', auto: 'yes' } },
    }),
  ).toBe(false);
  expect(
    validateBuildImages({
      snapshots: { default: { dockerfile: 'Dockerfile', build_always: 'yes' } },
    }),
  ).toBe(false);

  // Registry constraints
  expect(
    validateBuildImages({
      snapshots: { default: { dockerfile: 'Dockerfile', registry: {} } },
    }),
  ).toBe(false);
  expect(
    validateBuildImages({
      snapshots: {
        default: { dockerfile: 'Dockerfile', registry: { name: '' } },
      },
    }),
  ).toBe(false);
  expect(
    validateBuildImages({
      snapshots: {
        default: {
          dockerfile: 'Dockerfile',
          registry: { auth_strategy: 'unknown' },
        },
      },
    }),
  ).toBe(false);
  expect(
    validateBuildImages({
      snapshots: {
        default: {
          dockerfile: 'Dockerfile',
          registry: { auth_strategy: 'none' },
        },
      },
    }),
  ).toBe(false);
  expect(
    validateBuildImages({
      snapshots: {
        default: {
          dockerfile: 'Dockerfile',
          registry: { name: 'reg', extra: true },
        },
      },
    }),
  ).toBe(false);

  // extra_registries constraints
  expect(
    validateBuildImages({
      releases: {
        default: {
          dockerfile: 'Dockerfile',
          extra_registries: [{ name: 'reg', repository: 'repo' }],
        },
      },
    }),
  ).toBe(false);
  expect(
    validateBuildImages({
      releases: {
        default: {
          dockerfile: 'Dockerfile',
          extra_registries: [
            { name: 'reg', repository: 'repo', auth_strategy: 'unknown' },
          ],
        },
      },
    }),
  ).toBe(false);

  // extra_tags constraints
  expect(
    validateBuildImages({
      snapshots: {
        default: { dockerfile: 'Dockerfile', extra_tags: ['-bad'] },
      },
    }),
  ).toBe(false);
  expect(
    validateBuildImages({
      snapshots: {
        default: { dockerfile: 'Dockerfile', extra_tags: ['x'.repeat(129)] },
      },
    }),
  ).toBe(false);

  // platforms constraints
  expect(
    validateBuildImages({
      snapshots: { default: { dockerfile: 'Dockerfile', platforms: [] } },
    }),
  ).toBe(false);
  expect(
    validateBuildImages({
      snapshots: {
        default: {
          dockerfile: 'Dockerfile',
          platforms: ['linux/amd64', 'linux/amd64'],
        },
      },
    }),
  ).toBe(false);
  expect(
    validateBuildImages({
      snapshots: {
        default: { dockerfile: 'Dockerfile', platforms: ['windows/amd64'] },
      },
    }),
  ).toBe(false);
});
