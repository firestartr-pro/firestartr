import { mkdtemp, rm, writeFile } from 'fs/promises';
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

import * as applyModule from '../src/app/apply/index.js';
import AppApply, {
  APP_APPLY_EXIT_CODES,
  type AppApplyJsonOutput,
} from '../src/commands/app/apply.js';
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
const STATE_APP_REPO = { owner: ORG, repo: 'app-payments' };

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

describe('fs-forge app apply command', () => {
  let workDir: string;
  let inputsPath: string;

  beforeEach(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    workDir = await mkdtemp(join(tmpdir(), 'fs-forge-apply-cmd-'));
    inputsPath = join(workDir, 'inputs.yaml');
    await writeFile(inputsPath, YAML.stringify(VALID_INPUTS), 'utf8');
    MockCreateFeatureSource.mockReturnValue(createFakeFeatureSource());
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('exits 0 (done) and outputs --json shape when all steps are complete', async () => {
    const api = seedHappyApi();
    MockCreateGitHubApi.mockReturnValue(api);

    jest.spyOn(applyModule, 'applyApp').mockResolvedValue({
      outcome: 'done',
      steps: [
        {
          step: 1,
          repos: [
            {
              repo: `${ORG}/claims`,
              branch: 'fs-forge/ComponentClaim-app-payments',
              pr: { number: 1, url: 'https://github.com/acme/claims/pull/1' },
              state: 'provisioned',
            },
          ],
        },
        {
          step: 2,
          repos: [
            {
              repo: `${ORG}/.firestartr`,
              branch: 'fs-forge/app-payments',
              pr: {
                number: 2,
                url: 'https://github.com/acme/.firestartr/pull/2',
              },
              state: 'merged',
            },
          ],
        },
        {
          step: 3,
          repos: [
            {
              repo: `${ORG}/payments-api`,
              branch: 'fs-forge/app-payments',
              pr: {
                number: 3,
                url: 'https://github.com/acme/payments-api/pull/3',
              },
              state: 'merged',
            },
          ],
        },
      ],
      auditIssue: {
        number: 10,
        url: 'https://github.com/acme/claims/issues/10',
      },
    });

    const { stdout, error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
      '--json',
    ]);

    expect(error).toBeUndefined();
    expect(APP_APPLY_EXIT_CODES.done).toBe(0);
    const parsed = JSON.parse(stdout) as AppApplyJsonOutput;
    expect(parsed).toEqual({
      org: ORG,
      app: 'payments',
      outcome: 'done',
      steps: expect.arrayContaining([
        expect.objectContaining({ step: 1 }),
        expect.objectContaining({ step: 2 }),
        expect.objectContaining({ step: 3 }),
      ]),
      auditIssue: {
        number: 10,
        url: 'https://github.com/acme/claims/issues/10',
      },
    });
    expect(parsed.checks).toBeUndefined();
    expect(parsed.conflicts).toBeUndefined();
  });

  it('exits 3 (pending) with --no-wait and prints resume guidance', async () => {
    const api = seedHappyApi();
    MockCreateGitHubApi.mockReturnValue(api);

    const { stdout, error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
      '--no-wait',
    ]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.pending,
    );
    expect(stdout).toContain('fs-forge/ComponentClaim-app-payments');
    expect(stdout).toContain('open');
    expect(stdout).toContain(
      'rerun `fs-forge app apply` with the same inputs to resume',
    );
    expect(api.committed.length).toBeGreaterThan(0);
  });

  it('exits 1 (failed) and prints the failure reason', async () => {
    const api = seedHappyApi();
    MockCreateGitHubApi.mockReturnValue(api);

    jest.spyOn(applyModule, 'applyApp').mockResolvedValue({
      outcome: 'failed',
      steps: [
        {
          step: 1,
          repos: [
            {
              repo: `${ORG}/claims`,
              branch: 'fs-forge/ComponentClaim-app-payments',
              state: 'failed',
              reason: 'Verification check failed',
            },
          ],
        },
      ],
      reason: 'Verification check failed',
    });

    const { stdout, error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
    ]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.failed,
    );
    expect(stdout).toContain('Failed: Verification check failed');
  });

  it('exits 1 (not_ready), prints checks and conflicts, and writes nothing', async () => {
    const api = seedHappyApi();
    api.setFile(
      DOT_FIRESTARTR_REPO,
      'apps/payments.yaml',
      YAML.stringify({
        name: 'payments',
        state_repo: 'acme/legacy-state',
        services: [
          { repo: 'acme/payments-api', service_names: ['payments-api'] },
        ],
      }),
    );
    api.orgPlans.set(ORG, 'unknown');
    MockCreateGitHubApi.mockReturnValue(api);

    const { stdout, error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
    ]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.not_ready,
    );
    expect(stdout).toContain('Conflicts (1):');
    expect(stdout).toContain('apps/payments.yaml');
    expect(stdout).toContain('[fail] vars-and-secrets:');
    expect(stdout).toContain('Not ready:');
    expect(api.committed).toHaveLength(0);
    expect(api.createdPulls).toHaveLength(0);
  });

  it('includes checks and conflicts in --json output when not_ready', async () => {
    const api = seedHappyApi();
    api.orgPlans.set(ORG, 'unknown');
    MockCreateGitHubApi.mockReturnValue(api);

    const { stdout, error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
      '--json',
    ]);

    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.not_ready,
    );
    const parsed = JSON.parse(stdout) as AppApplyJsonOutput;
    expect(parsed.outcome).toBe('not_ready');
    expect(parsed.steps).toEqual([]);
    expect(parsed.checks?.some((c) => c.status === 'fail')).toBe(true);
    expect(parsed.conflicts).toEqual([]);
    expect(api.committed).toHaveLength(0);
  });

  it('parses --timeout in seconds and passes timeoutMs to applyApp', async () => {
    const api = seedHappyApi();
    MockCreateGitHubApi.mockReturnValue(api);

    const spy = jest.spyOn(applyModule, 'applyApp').mockResolvedValue({
      outcome: 'done',
      steps: [],
    });

    const { error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
      '--timeout',
      '120',
      '--json',
    ]);

    expect(error).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      api,
      expect.anything(),
      expect.objectContaining({
        timeoutMs: 120_000,
        noWait: false,
      }),
    );
  });

  it('rejects non-positive --timeout with exit code 2', async () => {
    MockCreateGitHubApi.mockReturnValue(seedHappyApi());

    const { error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
      '--timeout',
      '0',
    ]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.error,
    );
  });

  it('enforces audit flag exclusivity between --create-issue and --issue', async () => {
    MockCreateGitHubApi.mockReturnValue(seedHappyApi());

    const { error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
      '--create-issue',
      '--issue',
      '42',
    ]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.error,
    );
    expect(error?.message).toMatch(/cannot also be provided/i);
  });

  it('requires --create-issue when --issue-title is provided', async () => {
    MockCreateGitHubApi.mockReturnValue(seedHappyApi());

    const { error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
      '--issue-title',
      'Deploy payments',
    ]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.error,
    );
  });

  it('passes audit flags to applyApp when --create-issue is used', async () => {
    const api = seedHappyApi();
    MockCreateGitHubApi.mockReturnValue(api);

    const spy = jest.spyOn(applyModule, 'applyApp').mockResolvedValue({
      outcome: 'done',
      steps: [],
      auditIssue: {
        number: 7,
        url: 'https://github.com/acme/claims/issues/7',
      },
    });

    const { error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
      '--create-issue',
      '--issue-title',
      'Deploy payments',
      '--issue-body',
      'Initial deploy',
      '--json',
    ]);

    expect(error).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      api,
      expect.anything(),
      expect.objectContaining({
        audit: {
          issue: undefined,
          createIssue: true,
          issueTitle: 'Deploy payments',
          issueBody: 'Initial deploy',
        },
      }),
    );
  });

  it('exits with code 2 on an invalid inputs file', async () => {
    const badPath = join(workDir, 'bad.yaml');
    await writeFile(badPath, 'app: 123\n', 'utf8');
    MockCreateGitHubApi.mockReturnValue(seedHappyApi());

    const { error } = await runCommand(AppApply, ['--inputs', badPath]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.error,
    );
    expect(error?.message).toContain('Invalid inputs file');
  });

  it('exits with code 2 when --app override is not a valid DNS label', async () => {
    MockCreateGitHubApi.mockReturnValue(seedHappyApi());

    const { error } = await runCommand(AppApply, [
      '--inputs',
      inputsPath,
      '--app',
      '../evil',
    ]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.error,
    );
    expect(error?.message).toContain('../evil');
    expect(error?.message).toContain('pattern');
  });

  it('exits with code 2 on resolve errors such as a missing Service claim', async () => {
    const api = seedHappyApi();
    api.setFile(
      CLAIMS_REPO,
      'claims-map.json',
      JSON.stringify({ headers: { sha: 'test-sha' }, claims: {} }),
    );
    MockCreateGitHubApi.mockReturnValue(api);

    const { error } = await runCommand(AppApply, ['--inputs', inputsPath]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.error,
    );
    expect(error?.message).toContain('Service ComponentClaim');
  });

  it('exits with code 2 when GitHub auth setup fails (missing token)', async () => {
    MockCreateGitHubApi.mockImplementation(() => {
      throw new Error(
        'GITHUB_TOKEN is required (or log in with `gh auth login`)',
      );
    });

    const { error } = await runCommand(AppApply, ['--inputs', inputsPath]);

    expect(error).toBeDefined();
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(
      APP_APPLY_EXIT_CODES.error,
    );
    expect(error?.message).toContain('GITHUB_TOKEN is required');
  });

  it('keeps repo fixture constants referenced', () => {
    expect(STATE_ARGOCD_REPO.repo).toBe('state-argocd');
    expect(SERVICE_REPO.repo).toBe('payments-api');
    expect(STATE_APP_REPO.repo).toBe('app-payments');
  });
});
