import { join } from 'path';
import YAML from 'yaml';

import { applyApp } from '../src/app/apply/index.js';
import { planApp } from '../src/app/plan/index.js';
import type { PlanSchemaDirs } from '../src/app/plan/index.js';
import { actionsSchemasDir } from '../src/schema/actionsSchemas.js';
import type { AppInputs } from '../src/schema/appInputs.js';
import { claimSchemasDir } from '../src/schema/claimSchemas.js';
import { dotFirestartrSchemasDir } from '../src/schema/dotFirestartrSchemas.js';
import { vendorSchemasDir } from '../src/schema/vendorSchemas.js';
import type { FeatureSource } from '../src/utils/featureSource.js';

import { MemoryGitHubApi } from './fixtures/memoryGitHubApi.js';

const PACKAGE_ROOT = join(__dirname, '..');

const SCHEMA_DIRS: PlanSchemaDirs = {
  claimSchemasDir: claimSchemasDir(PACKAGE_ROOT),
  dotFirestartrSchemasDir: dotFirestartrSchemasDir(PACKAGE_ROOT),
  actionsSchemasDir: actionsSchemasDir(PACKAGE_ROOT),
  vendorDir: vendorSchemasDir(PACKAGE_ROOT),
};

const ORG = 'acme';
const CLAIMS_REPO = { owner: ORG, repo: 'claims' };
const DOT_FIRESTARTR_REPO = { owner: ORG, repo: '.firestartr' };
const STATE_ARGOCD_REPO = { owner: ORG, repo: 'state-argocd' };
const SERVICE_REPO = { owner: ORG, repo: 'payments-api' };
const STATE_APP_REPO = { owner: ORG, repo: 'app-payments' };

const BASE_INPUTS: AppInputs = {
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

function createFakeFeatureSource(): FeatureSource {
  const index = {
    features: [
      {
        name: 'build_and_dispatch_docker_images',
        version: '7.2.0',
        files: [],
      },
      {
        name: 'release_please',
        version: '2.1.0',
        files: [],
      },
      {
        name: 'state_repo_apps',
        version: '3.0.1',
        files: [],
      },
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
    async readFeatureIndex() {
      return index;
    },
    async readFeatureVersions() {
      return [];
    },
    async readFeatureSchema(name) {
      const schema = schemas[name];
      if (!schema) throw new Error(`Unknown feature: ${name}`);
      return schema;
    },
    async readFeatureDocument() {
      return '';
    },
  };
}

function seedBaseRepos(api: MemoryGitHubApi, options?: {
  orgPlan?: 'free' | 'paid' | 'unknown';
  serviceClaimYaml?: string;
  registryYaml?: string;
  platformYaml?: string;
}): void {
  api.setOrgPlan(ORG, options?.orgPlan ?? 'paid');
  api.existingRepos.add(api.key(CLAIMS_REPO));
  api.existingRepos.add(api.key(DOT_FIRESTARTR_REPO));
  api.existingRepos.add(api.key(STATE_ARGOCD_REPO));
  api.existingRepos.add(api.key(SERVICE_REPO));
  api.setDefaultBranch(CLAIMS_REPO, 'main');
  api.setDefaultBranch(DOT_FIRESTARTR_REPO, 'main');
  api.setDefaultBranch(STATE_ARGOCD_REPO, 'main');
  api.setDefaultBranch(SERVICE_REPO, 'main');

  api.setFile(
    CLAIMS_REPO,
    'claims-map.json',
    JSON.stringify({
      headers: { sha: 'abc123' },
      claims: {
        'ComponentClaim-payments-api': {
          filePath: 'components/payments-api.yaml',
        },
      },
    }),
  );

  api.setFile(
    CLAIMS_REPO,
    'claims/components/payments-api.yaml',
    options?.serviceClaimYaml ??
      YAML.stringify({
        kind: 'ComponentClaim',
        version: '1.0',
        name: 'payments-api',
        owner: 'group:team-payments',
        system: 'system:billing',
        type: 'service',
        lifecycle: 'production',
        providers: {
          github: {
            name: 'payments-api',
            org: ORG,
          },
        },
      }),
  );

  api.setBlobPaths(DOT_FIRESTARTR_REPO, [
    'platforms/eks-main.yaml',
    'docker_registries/acr-main.yaml',
  ]);
  api.setFile(
    DOT_FIRESTARTR_REPO,
    'platforms/eks-main.yaml',
    options?.platformYaml ??
      YAML.stringify({
        name: 'eks-main',
        type: 'kubernetes',
        tenants: ['core'],
        envs: ['dev', 'pre', 'pro'],
      }),
  );
  api.setFile(
    DOT_FIRESTARTR_REPO,
    'docker_registries/acr-main.yaml',
    options?.registryYaml ??
      YAML.stringify({
        name: 'acr-main',
        default: true,
        image_types: ['snapshots', 'releases'],
        auth_strategy: 'azure_oidc',
        base_paths: {
          services: 'services',
          charts: 'charts',
        },
      }),
  );

  api.setBlobPaths(STATE_ARGOCD_REPO, []);
  api.setFile(
    SERVICE_REPO,
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
}

describe('app plan (resolve, render, checks)', () => {
  it('plans a new App on a paid plan', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    expect(result.context.org).toBe(ORG);
    expect(result.context.orgPlan).toBe('paid');

    // Claims repo: create app-payments claim + merge features into payments-api
    expect(result.files.claims).toHaveLength(2);
    expect(result.files.claims[0].outcome).toEqual({ kind: 'create' });
    expect(result.files.claims[1].outcome.kind).toBe('merge');
    // Paid plan writes no vars/secrets into app-payments
    const renderedStateClaim = YAML.parse(
      result.files.claims[0].content ?? '',
    ) as Record<string, unknown>;
    const gh = (
      renderedStateClaim.providers as Record<string, Record<string, unknown>>
    ).github;
    expect(gh.vars).toBeUndefined();
    expect(gh.secrets).toBeUndefined();

    // .firestartr, app-<app>, state-argocd, service repo all create
    expect(result.files.dotFirestartr[0].outcome).toEqual({ kind: 'create' });
    expect(result.files.stateApp.every((f) => f.outcome.kind === 'create')).toBe(
      true,
    );
    expect(
      result.files.stateArgocd.every((f) => f.outcome.kind === 'create'),
    ).toBe(true);
    expect(result.files.service[0].outcome).toEqual({ kind: 'create' });

    // Checks: claim-name, registry-and-platforms, image-types pass; argo + vars are info
    const byId = new Map(result.checks.map((c) => [c.id, c]));
    expect(byId.get('claim-name')?.status).toBe('pass');
    expect(byId.get('registry-and-platforms')?.status).toBe('pass');
    expect(byId.get('image-types')?.status).toBe('pass');
    expect(byId.get('argo-notifications-app')?.status).toBe('info');
    expect(byId.get('vars-and-secrets')?.status).toBe('info');
  });

  it('targets the App organization for the state-repo claim', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, {
      orgPlan: 'paid',
      serviceClaimYaml: YAML.stringify({
        kind: 'ComponentClaim',
        version: '1.0',
        name: 'payments-api',
        owner: 'group:team-payments',
        system: 'system:billing',
        type: 'service',
        lifecycle: 'production',
        providers: {
          github: { name: 'payments-api', org: 'service-owner-org' },
        },
      }),
    });

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    // Step 1 provisions app-payments through this claim, and every later step
    // opens PRs against `<org>/app-<app>`, so the claim must target the App org
    // rather than the organization the Service repository lives in.
    const parsed = YAML.parse(result.files.claims[0].content ?? '') as {
      providers: { github: { org: string } };
    };
    expect(parsed.providers.github.org).toBe(ORG);
  });

  it('produces all noop on a full rerun', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });

    const first = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    // Apply all rendered files into the fake GitHub repos.
    api.setFile(
      CLAIMS_REPO,
      'claims-map.json',
      JSON.stringify({
        headers: { sha: 'def456' },
        claims: {
          'ComponentClaim-payments-api': {
            filePath: 'components/payments-api.yaml',
          },
          'ComponentClaim-app-payments': {
            filePath: first.files.claims[0].path.replace(/^claims\//, ''),
          },
        },
      }),
    );
    api.setFile(
      CLAIMS_REPO,
      first.files.claims[0].path,
      first.files.claims[0].content ?? '',
    );
    api.setFile(
      CLAIMS_REPO,
      first.files.claims[1].path,
      first.files.claims[1].content ?? '',
    );
    api.setFile(
      DOT_FIRESTARTR_REPO,
      first.files.dotFirestartr[0].path,
      first.files.dotFirestartr[0].content ?? '',
    );
    api.existingRepos.add(api.key(STATE_APP_REPO));
    api.setDefaultBranch(STATE_APP_REPO, 'main');
    for (const file of first.files.stateApp) {
      api.setFile(STATE_APP_REPO, file.path, file.content ?? '');
    }
    api.setBlobPaths(
      STATE_ARGOCD_REPO,
      first.files.stateArgocd.map((f) => f.path),
    );
    for (const file of first.files.stateArgocd) {
      api.setFile(STATE_ARGOCD_REPO, file.path, file.content ?? '');
    }
    api.setFile(
      SERVICE_REPO,
      first.files.service[0].path,
      first.files.service[0].content ?? '',
    );

    const rerun = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    const allFiles = [
      ...rerun.files.claims,
      ...rerun.files.dotFirestartr,
      ...rerun.files.stateApp,
      ...rerun.files.stateArgocd,
      ...rerun.files.service,
    ];
    expect(allFiles.every((f) => f.outcome.kind === 'noop')).toBe(true);
    expect(
      rerun.checks.find((c) => c.id === 'claim-name')?.status,
    ).toBe('pass');
  });

  it('adds a target to an existing App with only missing files changing', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });

    const first = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    api.setFile(
      CLAIMS_REPO,
      'claims-map.json',
      JSON.stringify({
        headers: { sha: 'def456' },
        claims: {
          'ComponentClaim-payments-api': {
            filePath: 'components/payments-api.yaml',
          },
          'ComponentClaim-app-payments': {
            filePath: first.files.claims[0].path.replace(/^claims\//, ''),
          },
        },
      }),
    );
    api.setFile(
      CLAIMS_REPO,
      first.files.claims[0].path,
      first.files.claims[0].content ?? '',
    );
    api.setFile(
      CLAIMS_REPO,
      first.files.claims[1].path,
      first.files.claims[1].content ?? '',
    );
    api.setFile(
      DOT_FIRESTARTR_REPO,
      first.files.dotFirestartr[0].path,
      first.files.dotFirestartr[0].content ?? '',
    );
    api.existingRepos.add(api.key(STATE_APP_REPO));
    api.setDefaultBranch(STATE_APP_REPO, 'main');
    for (const file of first.files.stateApp) {
      api.setFile(STATE_APP_REPO, file.path, file.content ?? '');
    }
    api.setBlobPaths(
      STATE_ARGOCD_REPO,
      first.files.stateArgocd.map((f) => f.path),
    );
    for (const file of first.files.stateArgocd) {
      api.setFile(STATE_ARGOCD_REPO, file.path, file.content ?? '');
    }
    api.setFile(
      SERVICE_REPO,
      first.files.service[0].path,
      first.files.service[0].content ?? '',
    );

    const withSecondTarget: AppInputs = {
      ...BASE_INPUTS,
      targets: [
        ...BASE_INPUTS.targets,
        {
          platform: 'eks-main',
          tenant: 'core',
          env: 'pro',
          cluster_url: 'https://eks-main.example.com',
          track: 'releases',
        },
      ],
    };

    const next = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: withSecondTarget,
      schemaDirs: SCHEMA_DIRS,
    });

    // Claims and .firestartr are noop; dev target files are noop, pro target files are create
    expect(next.files.claims.every((f) => f.outcome.kind === 'noop')).toBe(
      true,
    );
    expect(next.files.dotFirestartr[0].outcome.kind).toBe('noop');

    const devFiles = next.files.stateApp.filter((f) => f.path.includes('/dev'));
    const proFiles = next.files.stateApp.filter((f) => f.path.includes('/pro'));
    expect(devFiles.every((f) => f.outcome.kind === 'noop')).toBe(true);
    expect(proFiles.every((f) => f.outcome.kind === 'create')).toBe(true);

    // AppProject merges new destination; make_dispatches merges new target
    expect(next.files.stateArgocd[0].outcome.kind).toBe('noop');
    expect(next.files.stateArgocd[1].outcome.kind).toBe('merge');
    expect(next.files.service[0].outcome.kind).toBe('merge');
  });

  it('writes core six + copied registry/cloud vars on a free plan and fails missing vars', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, {
      orgPlan: 'free',
      serviceClaimYaml: YAML.stringify({
        kind: 'ComponentClaim',
        version: '1.0',
        name: 'payments-api',
        owner: 'group:team-payments',
        system: 'system:billing',
        type: 'service',
        lifecycle: 'production',
        providers: {
          github: {
            name: 'payments-api',
            org: ORG,
            vars: {
              actions: [
                { name: 'FS_STATE_APP_ID', value: '12345' },
                { name: 'FS_CHECKS_APP_ID', value: '67890' },
                { name: 'DOCKER_REGISTRY_RELEASES', value: 'acr.azurecr.io' },
                { name: 'DOCKER_REGISTRY_SNAPSHOTS', value: 'acr.azurecr.io' },
                {
                  name: 'DOCKER_REGISTRIES_BASE_PATHS',
                  value: '{"services":{}}',
                },
                { name: 'AZURE_CLIENT_ID', value: 'cid' },
                { name: 'AZURE_SUBSCRIPTION_ID', value: 'sid' },
                { name: 'AZURE_TENANT_ID', value: 'tid' },
                { name: 'UNRELATED_VAR', value: 'should-not-be-copied' },
              ],
            },
            secrets: {
              actions: [
                {
                  name: 'FS_STATE_PEM_FILE',
                  value: 'ref:secretsclaim:firestartr-secrets:FS_STATE_PEM_FILE',
                },
                {
                  name: 'FS_CHECKS_PEM_FILE',
                  value:
                    'ref:secretsclaim:firestartr-secrets:FS_CHECKS_PEM_FILE',
                },
              ],
            },
          },
        },
      }),
    });

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    expect(result.files.claims[0].outcome).toEqual({ kind: 'create' });
    const parsed = YAML.parse(result.files.claims[0].content ?? '') as {
      providers: {
        github: {
          vars: { actions: Array<{ name: string; value: string }> };
          secrets: { actions: Array<{ name: string; value: string }> };
        };
      };
    };

    const varNames = parsed.providers.github.vars.actions.map((v) => v.name);
    expect(varNames).toContain('FS_STATE_APP_ID');
    expect(varNames).toContain('FS_CHECKS_APP_ID');
    expect(varNames).toContain('FIRESTARTR_CLI_VERSION');
    expect(varNames).toContain('DOCKER_REGISTRY_RELEASES');
    expect(varNames).toContain('AZURE_CLIENT_ID');
    expect(varNames).not.toContain('UNRELATED_VAR');

    const secretNames = parsed.providers.github.secrets.actions.map(
      (s) => s.name,
    );
    expect(secretNames).toEqual([
      'FS_STATE_PEM_FILE',
      'FS_CHECKS_PEM_FILE',
      'PREFAPP_BOT_PAT',
    ]);

    // HELM_CHARTS_PUBLICATION_TYPE was missing on Service claim -> fail check
    const missingHelm = result.checks.find(
      (c) => c.id === 'vars-state-app-HELM_CHARTS_PUBLICATION_TYPE',
    );
    expect(missingHelm?.status).toBe('fail');
  });

  it('reports failing checks for claim name conflict, missing registry/platform, and unsupported image_types', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, {
      orgPlan: 'unknown',
      registryYaml: YAML.stringify({
        name: 'acr-main',
        default: true,
        image_types: ['releases'],
        auth_strategy: 'azure_oidc',
        base_paths: { services: 'services', charts: 'charts' },
      }),
      platformYaml: YAML.stringify({
        name: 'eks-main',
        type: 'kubernetes',
        tenants: ['other-tenant'],
        envs: ['pro'],
      }),
    });

    // Existing app-payments claim without state_repo_apps feature
    api.setFile(
      CLAIMS_REPO,
      'claims-map.json',
      JSON.stringify({
        headers: { sha: 'abc123' },
        claims: {
          'ComponentClaim-payments-api': {
            filePath: 'components/payments-api.yaml',
          },
          'ComponentClaim-app-payments': {
            filePath: 'components/app-payments.yaml',
          },
        },
      }),
    );
    api.setFile(
      CLAIMS_REPO,
      'claims/components/app-payments.yaml',
      YAML.stringify({
        kind: 'ComponentClaim',
        version: '1.0',
        name: 'app-payments',
        providers: { github: { name: 'app-payments', org: ORG, features: [] } },
      }),
    );

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    const byId = new Map(result.checks.map((c) => [c.id, c]));
    expect(byId.get('claim-name')?.status).toBe('fail');
    expect(byId.get('registry-and-platforms')?.status).toBe('fail');
    expect(byId.get('image-types')?.status).toBe('fail');
    expect(byId.get('vars-and-secrets')?.status).toBe('fail');
    expect(result.files.claims[0].outcome.kind).toBe('conflict');
  });

  it('reports conflict when make_dispatches.yaml is unparsable', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });
    api.setFile(
      SERVICE_REPO,
      '.github/make_dispatches.yaml',
      'deployments: [\n  invalid: yaml: : :',
    );

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    expect(result.files.service[0].outcome.kind).toBe('conflict');
  });

  it('validates build_images.yaml and fails on missing flavor or unparsable YAML', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });

    // 1. Passing case (from seedBaseRepos)
    const ok = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });
    expect(ok.checks.find((c) => c.id === 'build-images')?.status).toBe('pass');

    // 2. Missing flavor -> fail with checklist item
    api.setFile(
      SERVICE_REPO,
      '.github/build_images.yaml',
      YAML.stringify({
        snapshots: {
          other: {
            dockerfile: './Dockerfile',
            auto: true,
          },
        },
      }),
    );
    const missingFlavor = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });
    const missingCheck = missingFlavor.checks.find(
      (c) => c.id === 'build-images',
    );
    expect(missingCheck?.status).toBe('fail');
    expect(missingCheck?.checklist?.length).toBeGreaterThan(0);

    // 3. Unparsable YAML -> fail
    api.setFile(
      SERVICE_REPO,
      '.github/build_images.yaml',
      'snapshots: [\n  invalid: yaml: : :',
    );
    const unparsable = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });
    expect(unparsable.checks.find((c) => c.id === 'build-images')?.status).toBe(
      'fail',
    );
  });

  it('free plan with existing app-<app> claim: does not edit it and fails on vars/secrets missing from the app claim', async () => {
    const api = new MemoryGitHubApi();
    const serviceWithVars = YAML.stringify({
      kind: 'ComponentClaim',
      version: '1.0',
      name: 'payments-api',
      owner: 'group:default/team',
      system: 'system:default/billing',
      type: 'service',
      lifecycle: 'production',
      providers: {
        github: {
          name: 'payments-api',
          org: ORG,
          vars: {
            actions: [
              { name: 'FS_STATE_APP_ID', value: '1' },
              { name: 'FS_CHECKS_APP_ID', value: '2' },
              { name: 'DOCKER_REGISTRY_RELEASES', value: 'r' },
              { name: 'DOCKER_REGISTRY_SNAPSHOTS', value: 's' },
              { name: 'DOCKER_REGISTRIES_BASE_PATHS', value: 'b' },
              { name: 'AZURE_CLIENT_ID', value: 'a' },
              { name: 'AZURE_SUBSCRIPTION_ID', value: 'b' },
              { name: 'AZURE_TENANT_ID', value: 'c' },
              { name: 'HELM_CHARTS_PUBLICATION_TYPE', value: 'oci' },
            ],
          },
          secrets: {
            actions: [
              { name: 'FS_STATE_PEM_FILE', value: 'x' },
              { name: 'FS_CHECKS_PEM_FILE', value: 'y' },
            ],
          },
        },
      },
    });
    seedBaseRepos(api, { orgPlan: 'free', serviceClaimYaml: serviceWithVars });

    api.setFile(
      CLAIMS_REPO,
      'claims-map.json',
      JSON.stringify({
        headers: { sha: 'abc123' },
        claims: {
          'ComponentClaim-payments-api': {
            filePath: 'components/payments-api.yaml',
          },
          'ComponentClaim-app-payments': {
            filePath: 'components/app-payments.yaml',
          },
        },
      }),
    );
    api.setFile(
      CLAIMS_REPO,
      'claims/components/app-payments.yaml',
      YAML.stringify({
        kind: 'ComponentClaim',
        version: '1.0',
        name: 'app-payments',
        owner: 'group:default/team',
        system: 'system:default/billing',
        type: 'service',
        lifecycle: 'production',
        providers: {
          github: {
            name: 'app-payments',
            org: ORG,
            visibility: 'private',
            allowAutoMerge: true,
            deleteBranchOnMerge: true,
            allowUpdateBranch: true,
            actions: { oidc: { useDefault: true } },
            branchStrategy: { name: 'none', defaultBranch: 'main' },
            additionalBranches: [{ name: 'deployment', orphan: true }],
            features: [{ name: 'state_repo_apps', ref: 'state_repo_apps-v3' }],
          },
        },
      }),
    );

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    // Existing app-<app> claim is not edited (noop)
    expect(result.files.claims[0].outcome).toEqual({ kind: 'noop' });

    // Missing state-app vars and secrets are reported as fail with checklist pointing to app-<app>'s claim
    const failIds = result.checks
      .filter((c) => c.status === 'fail')
      .map((c) => c.id);
    expect(failIds).toContain('vars-state-app-FS_STATE_APP_ID');
    expect(failIds).toContain('vars-state-app-AZURE_CLIENT_ID');
    expect(failIds).toContain('secrets-state-app-FS_STATE_PEM_FILE');
    const azureCheck = result.checks.find(
      (c) => c.id === 'vars-state-app-AZURE_CLIENT_ID',
    );
    expect(azureCheck?.checklist?.[0]).toContain(
      'claims/components/app-payments.yaml',
    );
  });

  it('unknown org plan fails check mentioning paid shape, and orgPlan option overrides detection', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'unknown' });

    const unknownResult = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    const planCheck = unknownResult.checks.find(
      (c) => c.id === 'vars-and-secrets',
    );
    expect(planCheck?.status).toBe('fail');
    expect(planCheck?.message).toMatch(/paid/i);
    expect(planCheck?.checklist?.[0]).toMatch(/org owner/i);
    // Paid shape rendered (no vars/secrets block)
    expect(unknownResult.files.claims[0].content).not.toMatch(/vars:/);

    // Override with orgPlan: 'paid'
    const paidOverride = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      orgPlan: 'paid',
      schemaDirs: SCHEMA_DIRS,
    });
    expect(paidOverride.context.orgPlan).toBe('paid');
    expect(
      paidOverride.checks.find((c) => c.id === 'vars-and-secrets')?.status,
    ).toBe('info');

    // Override with orgPlan: 'free'
    const freeOverride = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      orgPlan: 'free',
      schemaDirs: SCHEMA_DIRS,
    });
    expect(freeOverride.context.orgPlan).toBe('free');
    expect(freeOverride.files.claims[0].content).toMatch(/FS_STATE_APP_ID/);
  });

  it('reports conflict naming the file when state-argocd YAML is corrupt or multi-document', async () => {
    for (const [label, content] of [
      ['corrupt', 'a: [\n  invalid: yaml: : :'],
      [
        'multidoc',
        `${YAML.stringify({ kind: 'ApplicationSet', metadata: { name: 'app-payments' } })}---\n${YAML.stringify({ kind: 'AppProject', metadata: { name: 'app-payments' } })}`,
      ],
    ] as const) {
      const api = new MemoryGitHubApi();
      seedBaseRepos(api, { orgPlan: 'paid' });
      api.setBlobPaths(STATE_ARGOCD_REPO, ['apps/payments/x.yaml']);
      api.setFile(STATE_ARGOCD_REPO, 'apps/payments/x.yaml', content);

      const result = await planApp({
        api,
        featureSource: createFakeFeatureSource(),
        inputs: BASE_INPUTS,
        schemaDirs: SCHEMA_DIRS,
      });

      expect(result.files.stateArgocd.length).toBeGreaterThanOrEqual(2);
      for (const file of result.files.stateArgocd) {
        expect(file.outcome.kind).toBe('conflict');
        if (file.outcome.kind === 'conflict') {
          expect(file.outcome.reason).toContain('apps/payments/x.yaml');
        }
      }
      expect(label).toBeDefined();
    }
  });

  it('reports conflict naming every file when state-argocd has duplicate kind and metadata.name', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });
    api.setBlobPaths(STATE_ARGOCD_REPO, [
      'apps/payments/a.yaml',
      'apps/payments/b.yaml',
    ]);
    api.setFile(
      STATE_ARGOCD_REPO,
      'apps/payments/a.yaml',
      YAML.stringify({
        kind: 'ApplicationSet',
        apiVersion: 'argoproj.io/v1alpha1',
        metadata: { name: 'app-payments' },
        spec: {},
      }),
    );
    api.setFile(
      STATE_ARGOCD_REPO,
      'apps/payments/b.yaml',
      YAML.stringify({
        kind: 'ApplicationSet',
        apiVersion: 'argoproj.io/v1alpha1',
        metadata: { name: 'app-payments' },
        spec: { extra: 1 },
      }),
    );

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    const appSet = result.files.stateArgocd[0];
    expect(appSet.outcome.kind).toBe('conflict');
    if (appSet.outcome.kind === 'conflict') {
      expect(appSet.outcome.reason).toContain('apps/payments/a.yaml');
      expect(appSet.outcome.reason).toContain('apps/payments/b.yaml');
    }
  });

  it('throws descriptive errors naming repo/path for unparsable Service claim and invalid claims-map.json', async () => {
    const apiCorruptSvc = new MemoryGitHubApi();
    seedBaseRepos(apiCorruptSvc, {
      orgPlan: 'paid',
      serviceClaimYaml: '::: [ [',
    });
    await expect(
      planApp({
        api: apiCorruptSvc,
        featureSource: createFakeFeatureSource(),
        inputs: BASE_INPUTS,
        schemaDirs: SCHEMA_DIRS,
      }),
    ).rejects.toThrow(/claims\/components\/payments-api\.yaml/);

    const apiBadMap = new MemoryGitHubApi();
    seedBaseRepos(apiBadMap, { orgPlan: 'paid' });
    apiBadMap.setFile(CLAIMS_REPO, 'claims-map.json', '{ invalid json');
    await expect(
      planApp({
        api: apiBadMap,
        featureSource: createFakeFeatureSource(),
        inputs: BASE_INPUTS,
        schemaDirs: SCHEMA_DIRS,
      }),
    ).rejects.toThrow(/acme\/claims.*claims-map\.json/);
  });

  it('reports failing checks when state-argocd, .firestartr, or service repo does not exist', async () => {
    const cases = [
      {
        repo: STATE_ARGOCD_REPO,
        checkId: 'state-argocd-repo',
        slug: 'acme/state-argocd',
      },
      {
        repo: DOT_FIRESTARTR_REPO,
        checkId: 'dot-firestartr-repo',
        slug: 'acme/.firestartr',
      },
      {
        repo: SERVICE_REPO,
        checkId: 'service-repo',
        slug: 'acme/payments-api',
      },
    ];

    for (const { repo, checkId, slug } of cases) {
      const api = new MemoryGitHubApi();
      seedBaseRepos(api, { orgPlan: 'paid' });
      api.existingRepos.delete(api.key(repo));

      const result = await planApp({
        api,
        featureSource: createFakeFeatureSource(),
        inputs: BASE_INPUTS,
        schemaDirs: SCHEMA_DIRS,
      });

      const check = result.checks.find((c) => c.id === checkId);
      expect(check?.status).toBe('fail');
      expect(check?.message).toContain(slug);
      expect(check?.message).toMatch(/must exist/i);
    }
  });

  it('reports failing checks when state-argocd, .firestartr, or service repo is archived', async () => {
    const cases = [
      {
        repo: STATE_ARGOCD_REPO,
        checkId: 'state-argocd-repo',
        slug: 'acme/state-argocd',
      },
      {
        repo: DOT_FIRESTARTR_REPO,
        checkId: 'dot-firestartr-repo',
        slug: 'acme/.firestartr',
      },
      {
        repo: SERVICE_REPO,
        checkId: 'service-repo',
        slug: 'acme/payments-api',
      },
    ];

    for (const { repo, checkId, slug } of cases) {
      const api = new MemoryGitHubApi();
      seedBaseRepos(api, { orgPlan: 'paid' });
      api.setArchived(repo);

      const result = await planApp({
        api,
        featureSource: createFakeFeatureSource(),
        inputs: BASE_INPUTS,
        schemaDirs: SCHEMA_DIRS,
      });

      const check = result.checks.find((c) => c.id === checkId);
      expect(check?.status).toBe('fail');
      expect(check?.message).toContain(slug);
      expect(check?.message).toMatch(/archived/i);
      expect(check?.message).toMatch(/unarchiv/i);

      const checklistItem = check?.checklist?.join('\n');
      expect(checklistItem).toContain(slug);
      expect(checklistItem).toMatch(/unarchiv/i);
    }
  });

  it('allows a missing app-<app> repository because step 1 creates it', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    const check = result.checks.find((c) => c.id === 'state-app-repo');
    expect(check?.status).toBe('pass');
    expect(check?.message).toContain('acme/app-payments');
    expect(check?.message).toMatch(/step 1 creates it/i);
  });

  it('fails the plan when the existing app-<app> repository is archived', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });
    api.existingRepos.add(api.key(STATE_APP_REPO));
    api.setArchived(STATE_APP_REPO);

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    const check = result.checks.find((c) => c.id === 'state-app-repo');
    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('acme/app-payments');
    expect(check?.message).toMatch(/archived/i);
    expect(check?.checklist?.join('\n')).toMatch(/unarchiv/i);
  });

  it('merges into an existing apps/<app>.yml instead of creating a duplicate YAML', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });
    api.setFile(
      DOT_FIRESTARTR_REPO,
      'apps/payments.yml',
      [
        'name: payments',
        'state_repo: acme/app-payments',
        'services:',
        '  - repo: acme/other-svc',
        '    service_names: [other-svc]',
        '',
      ].join('\n'),
    );

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    expect(result.context.existingDotFirestartrAppPath).toBe('apps/payments.yml');
    expect(result.files.dotFirestartr[0].path).toBe('apps/payments.yml');
    expect(result.files.dotFirestartr[0].outcome).toEqual({
      kind: 'merge',
      added: ['service:acme/payments-api'],
    });
  });

  it('reports a conflict when both apps/<app>.yaml and apps/<app>.yml exist', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });
    api.setFile(
      DOT_FIRESTARTR_REPO,
      'apps/payments.yaml',
      'name: payments\nstate_repo: acme/app-payments\nservices: []\n',
    );
    api.setFile(
      DOT_FIRESTARTR_REPO,
      'apps/payments.yml',
      'name: payments\nstate_repo: acme/app-payments\nservices: []\n',
    );

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    const dotFirestartr = result.files.dotFirestartr[0];
    expect(dotFirestartr.outcome.kind).toBe('conflict');
    expect(dotFirestartr.content).toBeUndefined();
    if (dotFirestartr.outcome.kind === 'conflict') {
      expect(dotFirestartr.outcome.reason).toContain('apps/payments.yaml');
      expect(dotFirestartr.outcome.reason).toContain('apps/payments.yml');
    }
  });

  it('refuses to apply a plan whose target repository is archived', async () => {
    const api = new MemoryGitHubApi();
    seedBaseRepos(api, { orgPlan: 'paid' });
    api.setArchived(SERVICE_REPO);

    const result = await planApp({
      api,
      featureSource: createFakeFeatureSource(),
      inputs: BASE_INPUTS,
      schemaDirs: SCHEMA_DIRS,
    });

    const applied = await applyApp(api, result, { noWait: true });

    expect(applied.outcome).toBe('not_ready');
    expect(api.committed).toHaveLength(0);
    expect(api.createdPulls).toHaveLength(0);
    expect(api.issues).toHaveLength(0);
    expect(
      api.calls.filter((c) => c.startsWith('createBranch ')),
    ).toHaveLength(0);
  });
});
