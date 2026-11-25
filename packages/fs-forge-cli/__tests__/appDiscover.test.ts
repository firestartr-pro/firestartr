import { readFileSync } from 'fs';
import { join } from 'path';

import { discoverApp, formatDiscoverSummary } from '../src/app/discover.js';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi.js';

import type { FeatureSource } from '../src/utils/featureSource.js';

const DOT_FIRESTARTR_FIXTURES = join(__dirname, 'fixtures', 'dot-firestartr');
const VALID_CLAIM_FIXTURES = join(__dirname, 'fixtures', 'valid');

const APPS_YAML = readFileSync(
  join(DOT_FIRESTARTR_FIXTURES, 'apps.yaml'),
  'utf8',
);
const PLATFORMS_YAML = readFileSync(
  join(DOT_FIRESTARTR_FIXTURES, 'platforms.yaml'),
  'utf8',
);
const REGISTRIES_YAML = readFileSync(
  join(DOT_FIRESTARTR_FIXTURES, 'docker_registries.yaml'),
  'utf8',
);
const COMPONENT_WITH_FEATURES_YAML = readFileSync(
  join(VALID_CLAIM_FIXTURES, 'component-with-features.yaml'),
  'utf8',
);

const ORG = 'acme';
const CLAIMS_REPO = 'claims';

function seedClaimsMap(
  api: MemoryGitHubApi,
  claims: Record<string, string>,
): void {
  const ref = { owner: ORG, repo: CLAIMS_REPO };
  api.addRepo(ref);
  api.setDefaultBranch(ref, 'main');
  const mapObj = {
    headers: { sha: 'map-sha' },
    claims: Object.fromEntries(
      Object.entries(claims).map(([key, filePath]) => [key, { filePath }]),
    ),
  };
  api.setFile(ref, 'claims-map.json', JSON.stringify(mapObj));
}

function makeFeatureSource(
  schemas: Record<string, Record<string, unknown>>,
): FeatureSource {
  return {
    async readFeatureIndex() {
      return {
        features: Object.keys(schemas).map((name) => ({
          name,
          version: '1.0.0',
          files: [],
        })),
      };
    },
    async readFeatureVersions(name: string) {
      return [{ version: '1.0.0', date: '2026-01-01', url: `${name}.json` }];
    },
    async readFeatureSchema(name: string) {
      const schema = schemas[name];
      if (!schema) throw new Error(`No schema for ${name}`);
      return schema;
    },
    async readFeatureDocument() {
      return '';
    },
  };
}

describe('discoverApp', () => {
  it('reads canonical .firestartr fixtures, ApplicationSet values map, real ComponentClaim features, release_type, and tracks', async () => {
    const api = new MemoryGitHubApi();

    // 1. .firestartr using real fixtures copied from cdk8s_renderer
    const dotRef = { owner: ORG, repo: '.firestartr' };
    api.addRepo(dotRef);
    api.setDefaultBranch(dotRef, 'main');
    api.setBlobPaths(dotRef, [
      'platforms/example-dev.yaml',
      'docker_registries/example-aws.yaml',
      'apps/example-store.yaml',
    ]);
    api.setFile(dotRef, 'platforms/example-dev.yaml', PLATFORMS_YAML);
    api.setFile(dotRef, 'docker_registries/example-aws.yaml', REGISTRIES_YAML);
    api.setFile(dotRef, 'apps/example-store.yaml', APPS_YAML);

    // 2. state-argocd with canonical git-generator values: {<cluster>: <URL>}
    const argoRef = { owner: ORG, repo: 'state-argocd' };
    api.addRepo(argoRef);
    api.setDefaultBranch(argoRef, 'main');
    api.setBlobPaths(argoRef, ['projects/core.yaml', 'appsets/store.yaml']);
    api.setFile(
      argoRef,
      'projects/core.yaml',
      [
        'apiVersion: argoproj.io/v1alpha1',
        'kind: AppProject',
        'metadata:',
        '  name: core',
        '  annotations:',
        '    notifications.argoproj.io/subscribe.on-sync-failed.slack: alerts-core, alerts-ops',
        '    notifications.argoproj.io/subscribe.on-health-degraded.slack: alerts-core',
        'spec:',
        '  destinations:',
        '    - name: eks-dev',
        '      server: https://eks-dev.example.com',
      ].join('\n'),
    );
    api.setFile(
      argoRef,
      'appsets/store.yaml',
      [
        'apiVersion: argoproj.io/v1alpha1',
        'kind: ApplicationSet',
        'spec:',
        '  generators:',
        '    - git:',
        '        values:',
        '          eks-pro: https://eks-pro.example.com',
        '          eks-pre: https://eks-pre.example.com',
      ].join('\n'),
    );

    // 3. Real ComponentClaims (no spec: wrapper; features under providers.github.features)
    seedClaimsMap(api, {
      'ComponentClaim-store': 'components/store.yaml',
      'ComponentClaim-worker': 'components/worker.yaml',
    });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/store.yaml',
      [
        'name: store',
        'kind: ComponentClaim',
        'owner: group:payments',
        'system: commerce',
        'providers:',
        '  github:',
        '    name: store',
        '    org: example-org',
        '    features:',
        '      - name: build_and_dispatch_docker_images',
        '        version: 1.0.0',
        '        args:',
        '          trigger_filter_by_env_snapshot: dev',
        '          trigger_filter_by_env_pre_releases: test',
        '          trigger_filter_by_env_releases: pro',
      ].join('\n'),
    );
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/worker.yaml',
      [
        'name: worker',
        'kind: ComponentClaim',
        'owner: group:payments',
        'system: commerce',
      ].join('\n'),
    );

    // 4. Service repo release-please-config.json uses repo's owner (example-org) and basename (store)
    api.setFile(
      { owner: 'example-org', repo: 'store' },
      'release-please-config.json',
      JSON.stringify({ 'release-type': 'node' }),
    );

    const result = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'example-store',
      service: 'store',
    });

    expect(result.service).toBe('store');
    expect(result.dotFirestartr.present).toBe(true);
    expect(result.dotFirestartr.errors).toEqual([]);
    expect(result.dotFirestartr.platforms).toEqual([
      {
        name: 'example-dev',
        type: 'kubernetes',
        tenants: ['example-team'],
        envs: ['dev', 'test'],
      },
    ]);
    expect(result.dotFirestartr.registries).toEqual([
      {
        name: 'example-aws',
        default: true,
        image_types: ['services', 'charts'],
        auth_strategy: 'aws_oidc',
        base_paths: {
          services: 'example/services',
          charts: 'example/charts',
        },
      },
    ]);
    expect(result.dotFirestartr.appConfig).toEqual({
      present: true,
      state_repo: 'example-org/store-state',
      services: [
        {
          name: 'store',
          repo: 'example-org/store',
          service_names: ['frontend', 'api'],
          platforms: ['example-dev'],
        },
        {
          name: 'worker',
          repo: 'example-org/worker',
          service_names: ['worker'],
        },
      ],
    });

    expect(result.argocd).toEqual({
      present: true,
      clusters: [
        { name: 'eks-dev', url: 'https://eks-dev.example.com' },
        { name: 'eks-pre', url: 'https://eks-pre.example.com' },
        { name: 'eks-pro', url: 'https://eks-pro.example.com' },
      ],
      slackChannel: 'alerts-core',
    });

    expect(result.serviceFacts.owner).toBe('group:payments');
    expect(result.serviceFacts.system).toBe('commerce');
    expect(result.serviceFacts.ownerSystemDisagreement).toBe(false);
    expect(result.serviceFacts.otherServices).toEqual([
      {
        name: 'worker',
        present: true,
        owner: 'group:payments',
        system: 'commerce',
      },
    ]);
    expect(result.serviceFacts.releaseType).toEqual({
      value: 'node',
      source: 'release-please-config',
    });
    expect(result.serviceFacts.tracks).toEqual({
      dev: 'snapshots',
      test: 'pre-releases',
    });

    const summary = formatDiscoverSummary(result);
    expect(summary).toContain('App: example-store (org: acme, service: store)');
    expect(summary).toContain('Slack channel: alerts-core');
    expect(summary).toContain('Release type: node (release-please-config)');
  });

  it('infers --service as repo basename when apps/<app>.yaml has one repo entry even with multiple service_names', async () => {
    const api = new MemoryGitHubApi();
    const dotRef = { owner: ORG, repo: '.firestartr' };
    api.addRepo(dotRef);
    api.setDefaultBranch(dotRef, 'main');
    api.setBlobPaths(dotRef, ['platforms/p.yaml', 'apps/store.yaml']);
    api.setFile(dotRef, 'platforms/p.yaml', PLATFORMS_YAML);
    api.setFile(
      dotRef,
      'apps/store.yaml',
      [
        'name: store',
        'state_repo: example-org/store-state',
        'services:',
        '  - repo: example-org/store',
        '    service_names: [frontend, api]',
      ].join('\n'),
    );

    seedClaimsMap(api, { 'ComponentClaim-store': 'components/store.yaml' });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/store.yaml',
      COMPONENT_WITH_FEATURES_YAML,
    );
    api.setPrimaryLanguage({ owner: 'example-org', repo: 'store' }, 'Go');

    const result = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'store',
    });

    expect(result.service).toBe('store');
    expect(result.serviceFacts.owner).toBe('group:my-team');
    expect(result.serviceFacts.releaseType).toEqual({
      value: 'go',
      source: 'proposed',
      language: 'Go',
    });
  });

  it('reports absent .firestartr and state-argocd without throwing when --service is provided', async () => {
    const api = new MemoryGitHubApi();
    seedClaimsMap(api, { 'ComponentClaim-svc-a': 'components/svc-a.yaml' });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/svc-a.yaml',
      'name: svc-a\nkind: ComponentClaim\nowner: team-a\nsystem: sys-a\n',
    );
    api.setPrimaryLanguage({ owner: ORG, repo: 'svc-a' }, 'TypeScript');

    const result = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'new-app',
      service: 'svc-a',
    });

    expect(result.dotFirestartr).toEqual({
      present: false,
      platforms: [],
      registries: [],
      appConfig: { present: false },
      errors: [],
    });
    expect(result.argocd).toEqual({ present: false, clusters: [] });
    expect('slackChannel' in result.argocd).toBe(false);
    expect(result.serviceFacts.releaseType).toEqual({
      value: 'node',
      source: 'proposed',
      language: 'TypeScript',
    });
    expect(result.serviceFacts.tracks).toEqual({});
  });

  it('throws when --service cannot be inferred or when Service claim is missing', async () => {
    const api = new MemoryGitHubApi();
    seedClaimsMap(api, {});

    await expect(
      discoverApp({
        api,
        org: ORG,
        claimsRepoName: CLAIMS_REPO,
        app: 'missing-app',
      }),
    ).rejects.toThrow(/Cannot infer --service/);

    await expect(
      discoverApp({
        api,
        org: ORG,
        claimsRepoName: CLAIMS_REPO,
        app: 'missing-app',
        service: 'ghost-svc',
      }),
    ).rejects.toThrow(/Service claim not found: ComponentClaim-ghost-svc/);
  });

  it('detects owner/system disagreement across other repo entries of the App', async () => {
    const api = new MemoryGitHubApi();
    const dotRef = { owner: ORG, repo: '.firestartr' };
    api.addRepo(dotRef);
    api.setDefaultBranch(dotRef, 'main');
    api.setBlobPaths(dotRef, ['apps/example-store.yaml']);
    api.setFile(dotRef, 'apps/example-store.yaml', APPS_YAML);

    seedClaimsMap(api, {
      'ComponentClaim-store': 'components/store.yaml',
      'ComponentClaim-worker': 'components/worker.yaml',
    });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/store.yaml',
      'name: store\nkind: ComponentClaim\nowner: team-a\nsystem: sys-1\n',
    );
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/worker.yaml',
      'name: worker\nkind: ComponentClaim\nowner: team-b\nsystem: sys-1\n',
    );

    // Without --service, multiple repo entries in apps/<app>.yaml must error clearly
    await expect(
      discoverApp({
        api,
        org: ORG,
        claimsRepoName: CLAIMS_REPO,
        app: 'example-store',
      }),
    ).rejects.toThrow(/lists multiple services/);

    const result = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'example-store',
      service: 'store',
    });

    expect(result.serviceFacts.ownerSystemDisagreement).toBe(true);
    expect(result.serviceFacts.otherServices).toEqual([
      { name: 'worker', present: true, owner: 'team-b', system: 'sys-1' },
    ]);
  });

  it('skips malformed platform, registry, and app YAML files and reports them in JSON and human summary', async () => {
    const api = new MemoryGitHubApi();
    const dotRef = { owner: ORG, repo: '.firestartr' };
    api.addRepo(dotRef);
    api.setDefaultBranch(dotRef, 'main');
    api.setBlobPaths(dotRef, [
      'platforms/good.yaml',
      'platforms/bad.yaml',
      'docker_registries/bad-reg.yaml',
      'apps/broken.yaml',
    ]);
    api.setFile(dotRef, 'platforms/good.yaml', PLATFORMS_YAML);
    api.setFile(dotRef, 'platforms/bad.yaml', 'name: [unclosed\n  bad: {{{\n');
    api.setFile(
      dotRef,
      'docker_registries/bad-reg.yaml',
      'a: 1\n---\nb: 2\n',
    );
    api.setFile(dotRef, 'apps/broken.yaml', 'services: [unclosed\n');

    seedClaimsMap(api, { 'ComponentClaim-store': 'components/store.yaml' });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/store.yaml',
      'name: store\nkind: ComponentClaim\nowner: team-a\nsystem: sys-1\n',
    );

    const result = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'broken',
      service: 'store',
    });

    expect(result.dotFirestartr.platforms).toEqual([
      {
        name: 'example-dev',
        type: 'kubernetes',
        tenants: ['example-team'],
        envs: ['dev', 'test'],
      },
    ]);
    expect(result.dotFirestartr.registries).toEqual([]);
    expect(result.dotFirestartr.appConfig).toEqual({
      present: true,
      malformed: true,
      error: expect.any(String),
      services: [],
    });
    expect(result.dotFirestartr.errors.map((e) => e.path)).toEqual([
      'platforms/bad.yaml',
      'docker_registries/bad-reg.yaml',
      'apps/broken.yaml',
    ]);

    const summary = formatDiscoverSummary(result);
    expect(summary).toContain('App config: malformed');
    expect(summary).toContain('platforms/bad.yaml');
    expect(summary).toContain('docker_registries/bad-reg.yaml');
    expect(summary).toContain('apps/broken.yaml');
  });

  it('honors wildcard "*" in trigger_filter_by_env_* with releases > pre-releases > snapshots precedence', async () => {
    const api = new MemoryGitHubApi();
    const dotRef = { owner: ORG, repo: '.firestartr' };
    api.addRepo(dotRef);
    api.setDefaultBranch(dotRef, 'main');
    api.setBlobPaths(dotRef, ['platforms/p.yaml']);
    api.setFile(
      dotRef,
      'platforms/p.yaml',
      'name: p\ntype: eks\ntenants: [core]\nenvs: [dev, pre, pro]\n',
    );

    seedClaimsMap(api, { 'ComponentClaim-store': 'components/store.yaml' });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/store.yaml',
      [
        'name: store',
        'kind: ComponentClaim',
        'owner: team',
        'system: sys',
        'providers:',
        '  github:',
        '    features:',
        '      - name: build_and_dispatch_docker_images',
        '        args:',
        "          trigger_filter_by_env_snapshot: 'dev'",
        "          trigger_filter_by_env_pre_releases: 'pre'",
        "          trigger_filter_by_env_releases: '*'",
      ].join('\n'),
    );

    const result = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'store',
      service: 'store',
    });

    expect(result.serviceFacts.tracks).toEqual({
      dev: 'releases',
      pre: 'releases',
      pro: 'releases',
    });
  });

  it('reads packages["."]["release-type"] and constrains proposed language mapping to release_please enum', async () => {
    const api = new MemoryGitHubApi();
    seedClaimsMap(api, {
      'ComponentClaim-svc-pkg': 'components/svc-pkg.yaml',
      'ComponentClaim-svc-elixir': 'components/svc-elixir.yaml',
      'ComponentClaim-svc-csharp': 'components/svc-csharp.yaml',
    });
    for (const name of ['svc-pkg', 'svc-elixir', 'svc-csharp']) {
      api.setFile(
        { owner: ORG, repo: CLAIMS_REPO },
        `claims/components/${name}.yaml`,
        `name: ${name}\nkind: ComponentClaim\nowner: team\nsystem: sys\n`,
      );
    }

    api.setFile(
      { owner: ORG, repo: 'svc-pkg' },
      'release-please-config.json',
      JSON.stringify({ packages: { '.': { 'release-type': 'python' } } }),
    );
    api.setPrimaryLanguage({ owner: ORG, repo: 'svc-elixir' }, 'Elixir');
    api.setPrimaryLanguage({ owner: ORG, repo: 'svc-csharp' }, 'C#');

    const featureSource = makeFeatureSource({
      release_please: {
        properties: {
          release_type: { enum: ['node', 'python', 'go', 'simple'] },
        },
      },
    });

    const pkgResult = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'a',
      service: 'svc-pkg',
      featureSource,
    });
    expect(pkgResult.serviceFacts.releaseType).toEqual({
      value: 'python',
      source: 'release-please-config',
    });

    const elixirResult = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'a',
      service: 'svc-elixir',
      featureSource,
    });
    expect(elixirResult.serviceFacts.releaseType).toEqual({
      value: 'simple',
      source: 'proposed',
      language: 'Elixir',
    });

    const csharpResult = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'a',
      service: 'svc-csharp',
      featureSource,
    });
    expect(csharpResult.serviceFacts.releaseType).toEqual({
      value: 'simple',
      source: 'proposed',
      language: 'C#',
    });
  });

  it('applies track filter precedence (releases > pre-releases > snapshots) and feature defaults', async () => {
    const api = new MemoryGitHubApi();
    const dotRef = { owner: ORG, repo: '.firestartr' };
    api.addRepo(dotRef);
    api.setDefaultBranch(dotRef, 'main');
    api.setBlobPaths(dotRef, ['platforms/p.yaml']);
    api.setFile(
      dotRef,
      'platforms/p.yaml',
      'name: p\ntype: eks\ntenants: [t]\nenvs: [dev, pre, pro, overlap]\n',
    );

    seedClaimsMap(api, {
      'ComponentClaim-precedence': 'components/precedence.yaml',
      'ComponentClaim-defaults': 'components/defaults.yaml',
    });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/precedence.yaml',
      [
        'name: precedence',
        'kind: ComponentClaim',
        'owner: team',
        'system: sys',
        'providers:',
        '  github:',
        '    features:',
        '      - name: build_and_dispatch_docker_images',
        '        args:',
        '          trigger_filter_by_env_snapshot: dev, pre, overlap',
        '          trigger_filter_by_env_pre_releases: pre, overlap',
        '          trigger_filter_by_env_releases: pro, overlap',
      ].join('\n'),
    );
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/defaults.yaml',
      'name: defaults\nkind: ComponentClaim\nowner: team\nsystem: sys\n',
    );

    const featureSource = makeFeatureSource({
      build_and_dispatch_docker_images: {
        properties: {
          trigger_filter_by_env_snapshot: { default: 'dev' },
          trigger_filter_by_env_pre_releases: { default: 'pre' },
          trigger_filter_by_env_releases: { default: 'pro,overlap' },
        },
      },
    });

    const precResult = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'a',
      service: 'precedence',
      featureSource,
    });
    expect(precResult.serviceFacts.tracks).toEqual({
      dev: 'snapshots',
      pre: 'pre-releases',
      pro: 'releases',
      overlap: 'releases',
    });

    const defResult = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'a',
      service: 'defaults',
      featureSource,
    });
    expect(defResult.serviceFacts.tracks).toEqual({
      dev: 'snapshots',
      pre: 'pre-releases',
      pro: 'releases',
      overlap: 'releases',
    });
  });
});
