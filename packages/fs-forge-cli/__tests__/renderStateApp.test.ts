import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

import { renderStateAppTargets } from '../src/app/render/stateApp.js';
import {
  dotFirestartrSchemasDir,
  loadDotFirestartrValidator,
} from '../src/schema/dotFirestartrSchemas.js';

import type { DiscoveredRegistry } from '../src/app/dotFirestartr.js';
import type { AppInputs } from '../src/schema/appInputs.js';

const PACKAGE_ROOT = join(__dirname, '..');
const SCHEMAS_DIR = dotFirestartrSchemasDir(PACKAGE_ROOT);
const FIXTURES_DIR = join(
  PACKAGE_ROOT,
  '__tests__',
  'fixtures',
  'dot-firestartr',
);

function loadRegistryFixture(): DiscoveredRegistry {
  return YAML.parse(
    readFileSync(join(FIXTURES_DIR, 'docker_registries.yaml'), 'utf8'),
  ) as DiscoveredRegistry;
}

function baseInputs(overrides: Partial<AppInputs> = {}): AppInputs {
  return {
    org: 'acme',
    app: 'billing',
    service: {
      repo: 'billing-api',
      release_type: 'node',
    },
    targets: [
      {
        platform: 'example-dev',
        tenant: 'example-team',
        env: 'dev',
        cluster_url: 'https://eks-dev.example.com',
        track: 'snapshots',
      },
    ],
    chart: {
      name: 'web',
      version: '1.2.3',
      registry: 'example-aws',
    },
    ...overrides,
  };
}

describe('renderStateAppTargets', () => {
  const validate = loadDotFirestartrValidator('state_apps_env', SCHEMAS_DIR);
  const registries = [loadRegistryFixture()];

  it('creates <env>.yaml and empty values.yaml from scratch matching spec and schema', () => {
    const files = renderStateAppTargets({
      inputs: baseInputs(),
      registries,
      schemasDir: SCHEMAS_DIR,
    });

    expect(files).toHaveLength(2);
    const [envFile, valuesFile] = files;

    expect(envFile.path).toBe('kubernetes/example-dev/example-team/dev.yaml');
    expect(envFile.outcome).toEqual({ kind: 'create' });
    const parsed = YAML.parse(envFile.content ?? '');
    expect(validate(parsed)).toBe(true);
    expect(parsed).toEqual({
      version: '1.2.3',
      chart: 'example-aws/example/charts/web',
      releaseName: 'billing',
      hooks: [],
      extraPatches: [],
      remoteArtifacts: [],
      execs: [],
    });
    expect(parsed.namespace).toBeUndefined();

    expect(valuesFile.path).toBe(
      'kubernetes/example-dev/example-team/dev/values.yaml',
    );
    expect(valuesFile.outcome).toEqual({ kind: 'create' });
    expect(valuesFile.content).toBe('');
  });

  it('returns noop on identical existing <env>.yaml and never touches values.yaml', () => {
    const envPath = 'kubernetes/example-dev/example-team/dev.yaml';
    const valuesPath = 'kubernetes/example-dev/example-team/dev/values.yaml';
    const existingEnv = [
      '# Custom comment',
      'version: 1.2.3',
      'chart: example-aws/example/charts/web',
      'releaseName: billing',
      'namespace: example-team-billing-dev',
      'hooks: []',
      '',
    ].join('\n');
    const existingValues = 'replicaCount: 3\n';

    const files = renderStateAppTargets({
      inputs: baseInputs(),
      registries,
      schemasDir: SCHEMAS_DIR,
      existingFiles: {
        [envPath]: existingEnv,
        [valuesPath]: existingValues,
      },
    });

    expect(files[0].outcome).toEqual({ kind: 'noop' });
    expect(files[0].content).toBe(existingEnv);
    expect(files[1].outcome).toEqual({ kind: 'noop' });
    expect(files[1].content).toBe(existingValues);
  });

  it('returns conflict when the existing env file is schema-invalid although chart and version match', () => {
    const envPath = 'kubernetes/example-dev/example-team/dev.yaml';
    const existingEnv = [
      'version: 1.2.3',
      'chart: example-aws/example/charts/web',
      'hooks: not-an-array',
      '',
    ].join('\n');

    const files = renderStateAppTargets({
      inputs: baseInputs(),
      registries,
      schemasDir: SCHEMAS_DIR,
      existingFiles: { [envPath]: existingEnv },
    });

    expect(files[0].outcome.kind).toBe('conflict');
    expect(files[0].content).toBeUndefined();
    if (files[0].outcome.kind === 'conflict') {
      expect(files[0].outcome.reason).toContain('hooks');
    }
  });

  it('reports conflict on chart, version, releaseName, or non-default namespace mismatch', () => {
    const envPath = 'kubernetes/example-dev/example-team/dev.yaml';

    const cases = [
      'version: 1.2.3\nchart: example-aws/example/charts/other\nreleaseName: billing\n',
      'version: 9.9.9\nchart: example-aws/example/charts/web\nreleaseName: billing\n',
      'version: 1.2.3\nchart: example-aws/example/charts/web\nreleaseName: other-release\n',
      'version: 1.2.3\nchart: example-aws/example/charts/web\nreleaseName: billing\nnamespace: custom-ns\n',
    ];

    for (const existingEnv of cases) {
      const files = renderStateAppTargets({
        inputs: baseInputs(),
        registries,
        schemasDir: SCHEMAS_DIR,
        existingFiles: { [envPath]: existingEnv },
      });
      expect(files[0].outcome.kind).toBe('conflict');
      expect(files[0].content).toBeUndefined();
    }
  });

  it('returns a single conflict entry when two targets produce the same env file path', () => {
    const files = renderStateAppTargets({
      inputs: baseInputs({
        targets: [
          {
            platform: 'c1',
            tenant: 't',
            env: 'dev',
            cluster_url: 'https://u1',
            track: 'snapshots',
          },
          {
            platform: 'c1',
            tenant: 't',
            env: 'dev',
            cluster_url: 'https://u2',
            track: 'snapshots',
          },
        ],
      }),
      registries,
      schemasDir: SCHEMAS_DIR,
    });

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('kubernetes/c1/t/dev.yaml');
    expect(files[0].outcome.kind).toBe('conflict');
    expect(files[0].content).toBeUndefined();
  });
});
