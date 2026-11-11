import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { parse } from 'yaml';
import { schemas } from '../src/schemas/dot-firestartr';

type Directory = keyof typeof schemas;
type Config = Record<string, unknown>;
type InvalidCase = [string, string, unknown, string];
const ajv = new Ajv({ allErrors: true });
const fixtures = Object.fromEntries(
  Object.keys(schemas).map((name) => [
    name,
    parse(
      readFileSync(
        join(__dirname, 'fixtures', 'dot-firestartr', `${name}.yaml`),
        'utf8',
      ),
    ),
  ]),
) as Record<Directory, Config>;

// Each case edits a fresh fixture, never another case's input.
function edit(config: Config, path: string, value: unknown): void {
  const parts = path.split('/');
  let parent = config;
  for (const part of parts.slice(0, -1)) parent = parent[part] as Config;
  const key = parts[parts.length - 1];
  if (value === undefined) delete parent[key];
  else parent[key] = value;
}

const required: Record<Directory, string[]> = {
  apps: [
    'name',
    'state_repo',
    'services',
    'services/0/repo',
    'services/0/service_names',
  ],
  platforms: ['type', 'name', 'tenants', 'envs'],
  docker_registries: [
    'name',
    'registry',
    'image_types',
    'default',
    'auth_strategy',
    'base_paths',
    'base_paths/services',
  ],
  helm_repositories: ['name', 'url'],
};
const strings: Record<Directory, string[]> = {
  apps: [
    'name',
    'state_repo',
    'platforms/0',
    'services/0/repo',
    'services/0/platforms/0',
    'services/0/service_names/0',
  ],
  platforms: [
    'type',
    'name',
    'tenants/0',
    'envs/0',
    'allowedClaims/0/resourceTypes/0',
    'allowedClaims/0/providers/0',
    'allowedClaims/0/backend',
  ],
  docker_registries: [
    'name',
    'registry',
    'image_types/0',
    'base_paths/services',
    'base_paths/charts',
  ],
  helm_repositories: ['name', 'url'],
};
const arrays: Record<Directory, string[]> = {
  apps: [
    'platforms',
    'services',
    'services/0/platforms',
    'services/0/service_names',
  ],
  platforms: [
    'tenants',
    'envs',
    'allowedClaims',
    'allowedClaims/0/resourceTypes',
    'allowedClaims/0/providers',
  ],
  docker_registries: ['image_types'],
  helm_repositories: [],
};
const nonempty: Record<Directory, string[]> = {
  apps: ['services/0/service_names'],
  platforms: [
    'tenants',
    'envs',
    'allowedClaims/0/resourceTypes',
    'allowedClaims/0/providers',
  ],
  docker_registries: ['image_types'],
  helm_repositories: [],
};
const special: Record<Directory, InvalidCase[]> = {
  apps: [
    [
      'unknown service field',
      'services/0/unknown',
      true,
      'additionalProperties',
    ],
    ['service item type', 'services/0', '', 'type'],
  ],
  platforms: [
    [
      'unknown claim field',
      'allowedClaims/0/unknown',
      true,
      'additionalProperties',
    ],
    ['claim item type', 'allowedClaims/0', '', 'type'],
  ],
  docker_registries: [
    ['default type', 'default', '', 'type'],
    ['base paths type', 'base_paths', '', 'type'],
    ['unknown base path', 'base_paths/unknown', '', 'additionalProperties'],
    ['unknown authentication strategy', 'auth_strategy', 'typo', 'enum'],
    ['empty registry', 'registry', '', 'pattern'],
    ['registry port', 'registry', 'registry.example.com:5000', 'pattern'],
    ['registry scheme', 'registry', 'https://registry.example.com', 'pattern'],
  ],
  helm_repositories: [
    ['empty name', 'name', '', 'minLength'],
    ['missing scheme', 'url', 'charts.example.com', 'pattern'],
    ['unsupported scheme', 'url', 'ftp://charts.example.com', 'pattern'],
    [
      'unanchored scheme',
      'url',
      'prefix-https://charts.example.com',
      'pattern',
    ],
  ],
};

describe.each(Object.keys(schemas) as Directory[])(
  '%s contract',
  (directory) => {
    const validate = ajv.compile(schemas[directory]);
    test('accepts its representative YAML fixture', () => {
      expect(validate(fixtures[directory])).toBe(true);
      expect(validate.errors).toBeNull();
    });
    const cases: InvalidCase[] = [
      ...required[directory].map(
        (path) =>
          [`missing ${path}`, path, undefined, 'required'] as InvalidCase,
      ),
      ...strings[directory].map(
        (path) => [`string type ${path}`, path, 42, 'type'] as InvalidCase,
      ),
      ...arrays[directory].map(
        (path) => [`array type ${path}`, path, '', 'type'] as InvalidCase,
      ),
      ...nonempty[directory].map(
        (path) => [`empty ${path}`, path, [], 'minItems'] as InvalidCase,
      ),
      ['unknown field', 'unknown', true, 'additionalProperties'],
      ...special[directory],
    ];
    test.each(cases)('rejects %s', (_name, path, value, keyword) => {
      const config = structuredClone(fixtures[directory]);
      edit(config, path, value);
      expect(validate(config)).toBe(false);
      expect(validate.errors).toHaveLength(1);
      const parent = path.split('/').slice(0, -1).join('/');
      const instancePath =
        keyword === 'required' || keyword === 'additionalProperties'
          ? parent
            ? `/${parent}`
            : ''
          : `/${path}`;
      expect(validate.errors?.[0]).toMatchObject({ keyword, instancePath });
      if (keyword === 'required')
        expect(validate.errors?.[0].params).toEqual({
          missingProperty: path.split('/').pop(),
        });
      if (keyword === 'additionalProperties')
        expect(validate.errors?.[0].params).toEqual({
          additionalProperty: path.split('/').pop(),
        });
    });
    test('rejects a non-object root', () => {
      expect(validate([])).toBe(false);
      expect(validate.errors).toHaveLength(1);
      expect(validate.errors?.[0]).toMatchObject({
        keyword: 'type',
        instancePath: '',
        params: { type: 'object' },
      });
    });
  },
);

test.each(['aws_oidc', 'azure_oidc', 'generic', 'ghcr', 'dockerhub', 'none'])(
  'accepts authentication strategy %s',
  (strategy) => {
    expect(
      ajv.compile(schemas.docker_registries)({
        ...fixtures.docker_registries,
        auth_strategy: strategy,
      }),
    ).toBe(true);
  },
);
test.each(['http://', 'https://', 'oci://'])(
  'accepts Helm URL prefix %s, including prefix-only URLs',
  (prefix) => {
    const validate = ajv.compile(schemas.helm_repositories);
    expect(
      validate({
        ...fixtures.helm_repositories,
        url: `${prefix}charts.example.com`,
      }),
    ).toBe(true);
    expect(validate({ ...fixtures.helm_repositories, url: prefix })).toBe(true);
  },
);

test('preserves permissive optional and empty-string configurations', () => {
  const app = structuredClone(fixtures.apps);
  app.name = '';
  app.state_repo = '';
  delete app.platforms;
  app.services = [{ repo: '', platforms: [], service_names: [''] }];
  expect(ajv.compile(schemas.apps)(app)).toBe(true);
  app.platforms = [];
  expect(ajv.compile(schemas.apps)(app)).toBe(true);
  app.services = [];
  expect(ajv.compile(schemas.apps)(app)).toBe(true);
  const platform = structuredClone(fixtures.platforms);
  Object.assign(platform, {
    name: '',
    type: '',
    tenants: [''],
    envs: [''],
    allowedClaims: [{}, { backend: '' }],
  });
  const validate = ajv.compile(schemas.platforms);
  expect(validate(platform)).toBe(true);
  platform.allowedClaims = [];
  expect(validate(platform)).toBe(true);
  delete platform.allowedClaims;
  expect(validate(platform)).toBe(true);
  const registry = structuredClone(fixtures.docker_registries);
  registry.default = false;
  delete (registry.base_paths as Config).charts;
  expect(ajv.compile(schemas.docker_registries)(registry)).toBe(true);
});

test('application and service platform references resolve', () => {
  const app = fixtures.apps as {
    platforms: string[];
    services: Array<{ platforms?: string[] }>;
  };
  const references = [
    ...app.platforms,
    ...app.services.flatMap((service) => service.platforms ?? []),
  ];
  expect(references.length).toBeGreaterThan(0);
  for (const reference of references)
    expect(reference).toBe(fixtures.platforms.name);
});
