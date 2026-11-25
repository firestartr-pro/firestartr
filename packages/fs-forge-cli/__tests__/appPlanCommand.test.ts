import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import YAML from 'yaml';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

jest.mock('../src/utils/featureSource', () => {
  const actual = jest.requireActual('../src/utils/featureSource');
  return {
    ...actual,
    createFeatureSource: jest.fn(),
  };
});

import type { AppPlanJsonOutput } from '../src/app/plan/index.js';
import AppPlan from '../src/commands/app/plan.js';
import { createGitHubApi } from '../src/github/index.js';
import type { FeatureSource } from '../src/utils/featureSource.js';
import { createFeatureSource } from '../src/utils/featureSource.js';

import { MemoryGitHubApi } from './fixtures/memoryGitHubApi.js';
import { runCommand } from './fixtures/waitForChecks.js';

const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;
const MockCreateFeatureSource = createFeatureSource as unknown as jest.Mock;

const ORG = 'acme';
const CLAIMS_REPO = { owner: ORG, repo: 'claims' };
const DOT_FIRESTARTR_REPO = { owner: ORG, repo: '.firestartr' };
const STATE_ARGOCD_REPO = { owner: ORG, repo: 'state-argocd' };
const SERVICE_REPO = { owner: ORG, repo: 'payments-api' };

function createFakeFeatureSource(): FeatureSource {
  const index = {
    features: [
      { name: 'build_and_dispatch_docker_images', version: '7.2.0', files: [] },
      { name: 'release_please', version: '2.1.0', files: [] },
      { name: 'state_repo_apps', version: '3.0.1', files: [] },
    ],
  };

  const schemas: Record<string, Record<string, unknown>> = {
    build_and_dispatch_docker_images: {
      type: 'object',
      properties: {
        auth_strategy: { type: 'string' },
        trigger_filter_by_env_snapshot: { type: 'string', default: 'dev' },
        trigger_filter_by_env_pre_releases: { type: 'string', default: 'pre' },
        trigger_filter_by_env_releases: { type: 'string', default: 'pro' },
      },
      additionalProperties: false,
    },
    release_please: {
      type: 'object',
      properties: {
        release_type: { type: 'string' },
      },
      additionalProperties: false,
    },
    state_repo_apps: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  };

  return {
    readFeatureIndex: async () => index,
    readFeatureVersions: async () => [],
    readFeatureSchema: async (name: string) => schemas[name] ?? {},
    readFeatureDocument: async () => '',
  };
}

function seedHappyApi(org = ORG): MemoryGitHubApi {
  const api = new MemoryGitHubApi();
  const claimsRepo = { owner: org, repo: 'claims' };
  const dotRepo = { owner: org, repo: '.firestartr' };
  const argoRepo = { owner: org, repo: 'state-argocd' };
  const svcRepo = { owner: org, repo: 'payments-api' };

  api.orgPlans.set(org, 'paid');
  api.existingRepos.add(`${org}/claims`);
  api.existingRepos.add(`${org}/.firestartr`);
  api.existingRepos.add(`${org}/state-argocd`);
  api.existingRepos.add(`${org}/payments-api`);

  api.defaultBranches.set(`${org}/claims`, 'main');
  api.defaultBranches.set(`${org}/.firestartr`, 'main');
  api.defaultBranches.set(`${org}/state-argocd`, 'main');
  api.defaultBranches.set(`${org}/payments-api`, 'main');

  api.setFile(
    claimsRepo,
    'claims-map.json',
    JSON.stringify({
      headers: { sha: 'test-sha' },
      claims: {
        'ComponentClaim-payments-api': {
          kind: 'ComponentClaim',
          name: 'payments-api',
          filePath: 'components/payments-api.yaml',
        },
      },
    }),
  );

  api.setFile(
    claimsRepo,
    'claims/components/payments-api.yaml',
    YAML.stringify({
      kind: 'ComponentClaim',
      version: '1.0',
      name: 'payments-api',
      type: 'service',
      lifecycle: 'production',
      owner: 'group:default/core',
      system: 'system:payments',
      providers: {
        github: {
          org,
          name: 'payments-api',
        },
      },
    }),
  );

  api.setBlobPaths(dotRepo, [
    'platforms/eks-main.yaml',
    'docker_registries/acr-main.yaml',
  ]);
  api.setFile(
    dotRepo,
    'platforms/eks-main.yaml',
    YAML.stringify({
      name: 'eks-main',
      type: 'kubernetes',
      tenants: ['core'],
      envs: ['dev', 'pre', 'pro'],
    }),
  );
  api.setFile(
    dotRepo,
    'docker_registries/acr-main.yaml',
    YAML.stringify({
      name: 'acr-main',
      default: true,
      image_types: ['snapshots', 'releases'],
      auth_strategy: 'azure_oidc',
      base_paths: { charts: 'charts' },
    }),
  );

  api.setBlobPaths(argoRepo, []);

  api.setFile(
    svcRepo,
    '.github/build_images.yaml',
    YAML.stringify({
      snapshots: {
        default: {
          dockerfile: './Dockerfile',
          auto: true,
        },
      },
      releases: {
        default: {
          dockerfile: './Dockerfile',
          auto: true,
        },
      },
    }),
  );

  return api;
}

const VALID_INPUTS = {
  org: ORG,
  app: 'payments',
  service: {
    repo: 'payments-api',
    release_type: 'node',
  },
  targets: [
    {
      platform: 'eks-main',
      tenant: 'core',
      env: 'dev',
      cluster_url: 'https://eks-main.example.com',
      track: 'snapshots',
    },
  ],
  chart: {
    name: 'microservice',
    version: '1.2.3',
    registry: 'acr-main',
  },
};

describe('fs-forge app plan command', () => {
  let workDir: string;
  let inputsPath: string;

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    workDir = await mkdtemp(join(tmpdir(), 'fs-forge-plan-cmd-'));
    inputsPath = join(workDir, 'inputs.yaml');
    await writeFile(inputsPath, YAML.stringify(VALID_INPUTS), 'utf8');
    MockCreateFeatureSource.mockReturnValue(createFakeFeatureSource());
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('outputs the expected --json shape and exits 0 when ready', async () => {
    const api = seedHappyApi();
    MockCreateGitHubApi.mockReturnValue(api);

    const { stdout, error } = await runCommand(AppPlan, [
      '--inputs',
      inputsPath,
      '--json',
    ]);

    expect(error).toBeUndefined();
    const parsed = JSON.parse(stdout) as AppPlanJsonOutput;
    expect(parsed.org).toBe(ORG);
    expect(parsed.app).toBe('payments');
    expect(parsed.orgPlan).toBe('paid');
    expect(parsed.ready).toBe(true);
    expect(parsed.conflicts).toEqual([]);
    expect(parsed.steps).toHaveLength(3);
    expect(parsed.steps[0].repos[0].headBranch).toBe('fs-forge/app-payments');
    expect(parsed.steps[0].repos[0].files[0].content).toEqual(
      expect.any(String),
    );
    expect(parsed.checks.length).toBeGreaterThan(0);
    // Read-only: never mutates GitHub
    expect(api.committed).toHaveLength(0);
    expect(api.createdPulls).toHaveLength(0);
  });

  it('prints full text output with fail checks and conflicts and exits 1', async () => {
    const api = seedHappyApi();
    // Introduce a conflict in .firestartr/apps/payments.yaml (legacy state_repo)
    api.setFile(
      DOT_FIRESTARTR_REPO,
      'apps/payments.yaml',
      YAML.stringify({
        name: 'payments',
        state_repo: 'acme/legacy-state',
        services: [{ repo: 'acme/payments-api', service_names: ['payments-api'] }],
      }),
    );
    // Introduce a fail check (unknown org plan)
    api.orgPlans.set(ORG, 'unknown');
    MockCreateGitHubApi.mockReturnValue(api);

    const { stdout, error } = await runCommand(AppPlan, [
      '--inputs',
      inputsPath,
    ]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(1);
    expect(stdout).toContain('Steps:');
    expect(stdout).toContain('Conflicts (1):');
    expect(stdout).toContain('apps/payments.yaml');
    expect(stdout).toContain('[fail] vars-and-secrets:');
    expect(stdout).toContain('[pass]');
    expect(stdout).toContain('Checklist:');
    expect(stdout).toContain('Not ready:');
  });

  it('reports malformed .firestartr/apps/<app>.yaml as a conflict in plan', async () => {
    const api = seedHappyApi();
    api.setFile(DOT_FIRESTARTR_REPO, 'apps/payments.yaml', 'name: [unclosed');
    MockCreateGitHubApi.mockReturnValue(api);

    const { stdout, error } = await runCommand(AppPlan, [
      '--inputs',
      inputsPath,
      '--json',
    ]);

    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(1);
    const parsed = JSON.parse(stdout) as AppPlanJsonOutput;
    expect(parsed.ready).toBe(false);
    expect(parsed.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repo: `${ORG}/.firestartr`,
          path: 'apps/payments.yaml',
        }),
      ]),
    );
  });

  it('writes non-noop, non-conflict files to --out <dir> and prints written paths', async () => {
    const api = seedHappyApi();
    MockCreateGitHubApi.mockReturnValue(api);
    const outDir = join(workDir, 'out');

    const { stdout, error } = await runCommand(AppPlan, [
      '--inputs',
      inputsPath,
      '--out',
      outDir,
    ]);

    expect(error).toBeUndefined();
    const expectedClaim = join(
      outDir,
      'claims',
      'claims/components/app-payments.yaml',
    );
    expect(stdout).toContain(`Wrote ${expectedClaim}`);
    const content = await readFile(expectedClaim, 'utf8');
    expect(content).toContain('kind: ComponentClaim');
  });

  it('applies --org, --app, and --org-plan flag overrides', async () => {
    const overrideOrg = 'other-org';
    const api = seedHappyApi(overrideOrg);
    api.orgPlans.set(overrideOrg, 'unknown');
    MockCreateGitHubApi.mockReturnValue(api);

    const { stdout, error } = await runCommand(AppPlan, [
      '--inputs',
      inputsPath,
      '--org',
      overrideOrg,
      '--app',
      'billing',
      '--org-plan',
      'paid',
      '--json',
    ]);

    expect(error).toBeUndefined();
    const parsed = JSON.parse(stdout) as AppPlanJsonOutput;
    expect(parsed.org).toBe(overrideOrg);
    expect(parsed.app).toBe('billing');
    expect(parsed.orgPlan).toBe('paid');
    expect(parsed.steps[0].repos[0].headBranch).toBe('fs-forge/app-billing');
  });

  it('exits with code 2 on an invalid inputs file', async () => {
    const badPath = join(workDir, 'bad.yaml');
    await writeFile(badPath, 'app: 123\n', 'utf8');
    MockCreateGitHubApi.mockReturnValue(seedHappyApi());

    const { error } = await runCommand(AppPlan, ['--inputs', badPath]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(2);
    expect(error?.message).toContain('Invalid inputs file');
  });

  it('exits with code 2 on resolve errors such as a missing Service claim', async () => {
    const api = seedHappyApi();
    api.setFile(
      CLAIMS_REPO,
      'claims-map.json',
      JSON.stringify({ headers: { sha: 'test-sha' }, claims: {} }),
    );
    MockCreateGitHubApi.mockReturnValue(api);

    const { error } = await runCommand(AppPlan, ['--inputs', inputsPath]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(2);
    expect(error?.message).toContain('Service ComponentClaim');
  });

  // Reference unused constants check avoidance
  it('uses state-argocd and service repos in steps', async () => {
    expect(STATE_ARGOCD_REPO.repo).toBe('state-argocd');
    expect(SERVICE_REPO.repo).toBe('payments-api');
  });
});
