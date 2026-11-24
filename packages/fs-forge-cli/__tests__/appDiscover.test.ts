import { discoverApp, formatDiscoverSummary } from '../src/app/discover.js';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi.js';

import type { FeatureSource } from '../src/utils/featureSource.js';

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

function makeFeatureSource(schemas: Record<string, Record<string, unknown>>): FeatureSource {
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
  it('reads .firestartr platforms, registries, appConfig, argocd clusters/slack, service claim, release_type, and tracks', async () => {
    const api = new MemoryGitHubApi();

    // 1. .firestartr
    const dotRef = { owner: ORG, repo: '.firestartr' };
    api.addRepo(dotRef);
    api.setDefaultBranch(dotRef, 'main');
    api.setBlobPaths(dotRef, [
      'platforms/aws.yaml',
      'platforms/gcp.yml',
      'docker_registries/ecr.yaml',
      'apps/billing.yaml',
    ]);
    api.setFile(
      dotRef,
      'platforms/aws.yaml',
      [
        'name: aws-eu',
        'type: eks',
        'tenants:',
        '  - core',
        'envs:',
        '  - dev',
        '  - pre',
        '  - pro',
      ].join('\n'),
    );
    api.setFile(
      dotRef,
      'platforms/gcp.yml',
      [
        'type: gke',
        'tenants:',
        '  - data',
        'envs:',
        '  - pro',
        '  - sandbox',
      ].join('\n'),
    );
    api.setFile(
      dotRef,
      'docker_registries/ecr.yaml',
      [
        'name: ecr-main',
        'default: true',
        'image_types:',
        '  - snapshots',
        '  - releases',
        'auth_strategy: aws-oidc',
        'base_paths:',
        '  snapshots: 123.dkr.ecr.eu-west-1.amazonaws.com/snap',
        '  releases: 123.dkr.ecr.eu-west-1.amazonaws.com/rel',
      ].join('\n'),
    );
    api.setFile(
      dotRef,
      'apps/billing.yaml',
      [
        'state_repo: app-billing',
        'services:',
        '  - name: billing-api',
        '    service_names:',
        '      - api',
      ].join('\n'),
    );

    // 2. state-argocd
    const argoRef = { owner: ORG, repo: 'state-argocd' };
    api.addRepo(argoRef);
    api.setDefaultBranch(argoRef, 'main');
    api.setBlobPaths(argoRef, ['projects/core.yaml', 'appsets/billing.yaml']);
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
      'appsets/billing.yaml',
      [
        'apiVersion: argoproj.io/v1alpha1',
        'kind: ApplicationSet',
        'spec:',
        '  generators:',
        '    - git:',
        '        values:',
        '          cluster: eks-pro',
        '          server: https://eks-pro.example.com',
      ].join('\n'),
    );

    // 3. Claims
    seedClaimsMap(api, { 'component-billing-api': 'components/billing-api.yaml' });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/billing-api.yaml',
      [
        'spec:',
        '  owner: group:payments',
        '  system: billing',
        '  features:',
        '    - name: build_and_dispatch_docker_images',
        '      args:',
        '        trigger_filter_by_env_snapshot: dev,sandbox',
        '        trigger_filter_by_env_pre_releases: pre',
        '        trigger_filter_by_env_releases: pro',
      ].join('\n'),
    );

    // 4. Service repo release-please-config.json
    api.setFile(
      { owner: ORG, repo: 'billing-api' },
      'release-please-config.json',
      JSON.stringify({ 'release-type': 'node' }),
    );

    const result = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'billing',
    });

    expect(result.service).toBe('billing-api');
    expect(result.dotFirestartr.present).toBe(true);
    expect(result.dotFirestartr.platforms).toEqual([
      { name: 'aws-eu', type: 'eks', tenants: ['core'], envs: ['dev', 'pre', 'pro'] },
      { name: 'gcp', type: 'gke', tenants: ['data'], envs: ['pro', 'sandbox'] },
    ]);
    expect(result.dotFirestartr.registries).toEqual([
      {
        name: 'ecr-main',
        default: true,
        image_types: ['snapshots', 'releases'],
        auth_strategy: 'aws-oidc',
        base_paths: {
          snapshots: '123.dkr.ecr.eu-west-1.amazonaws.com/snap',
          releases: '123.dkr.ecr.eu-west-1.amazonaws.com/rel',
        },
      },
    ]);
    expect(result.dotFirestartr.appConfig).toEqual({
      present: true,
      state_repo: 'app-billing',
      services: [{ name: 'billing-api', service_names: ['api'] }],
    });

    expect(result.argocd).toEqual({
      present: true,
      clusters: [
        { name: 'eks-dev', url: 'https://eks-dev.example.com' },
        { name: 'eks-pro', url: 'https://eks-pro.example.com' },
      ],
      slackChannel: 'alerts-core',
    });

    expect(result.serviceFacts.owner).toBe('group:payments');
    expect(result.serviceFacts.system).toBe('billing');
    expect(result.serviceFacts.ownerSystemDisagreement).toBe(false);
    expect(result.serviceFacts.releaseType).toEqual({
      value: 'node',
      source: 'release-please-config',
    });
    expect(result.serviceFacts.tracks).toEqual({
      dev: 'snapshots',
      pre: 'pre-releases',
      pro: 'releases',
      sandbox: 'snapshots',
    });

    const summary = formatDiscoverSummary(result);
    expect(summary).toContain('App: billing (org: acme, service: billing-api)');
    expect(summary).toContain('Slack channel: alerts-core');
    expect(summary).toContain('Release type: node (release-please-config)');
  });

  it('reports absent .firestartr and state-argocd without throwing when --service is provided', async () => {
    const api = new MemoryGitHubApi();
    seedClaimsMap(api, { 'component-svc-a': 'components/svc-a.yaml' });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/svc-a.yaml',
      'spec:\n  owner: team-a\n  system: sys-a\n',
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
    ).rejects.toThrow(/Service claim not found: component-ghost-svc/);
  });

  it('detects owner/system disagreement across other services of the App', async () => {
    const api = new MemoryGitHubApi();
    const dotRef = { owner: ORG, repo: '.firestartr' };
    api.addRepo(dotRef);
    api.setDefaultBranch(dotRef, 'main');
    api.setBlobPaths(dotRef, ['apps/multi.yaml']);
    api.setFile(
      dotRef,
      'apps/multi.yaml',
      'services:\n  - name: svc-a\n  - name: svc-b\n',
    );

    seedClaimsMap(api, {
      'component-svc-a': 'components/svc-a.yaml',
      'component-svc-b': 'components/svc-b.yaml',
    });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/svc-a.yaml',
      'spec:\n  owner: team-a\n  system: sys-1\n',
    );
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/svc-b.yaml',
      'spec:\n  owner: team-b\n  system: sys-1\n',
    );

    // Without --service, multiple services in apps/<app>.yaml must error clearly
    await expect(
      discoverApp({
        api,
        org: ORG,
        claimsRepoName: CLAIMS_REPO,
        app: 'multi',
      }),
    ).rejects.toThrow(/lists multiple services/);

    const result = await discoverApp({
      api,
      org: ORG,
      claimsRepoName: CLAIMS_REPO,
      app: 'multi',
      service: 'svc-a',
    });

    expect(result.serviceFacts.ownerSystemDisagreement).toBe(true);
    expect(result.serviceFacts.otherServices).toEqual([
      { name: 'svc-b', present: true, owner: 'team-b', system: 'sys-1' },
    ]);
  });

  it('reads packages["."]["release-type"] and constrains proposed language mapping to release_please enum', async () => {
    const api = new MemoryGitHubApi();
    seedClaimsMap(api, {
      'component-svc-pkg': 'components/svc-pkg.yaml',
      'component-svc-elixir': 'components/svc-elixir.yaml',
      'component-svc-csharp': 'components/svc-csharp.yaml',
    });
    for (const name of ['svc-pkg', 'svc-elixir', 'svc-csharp']) {
      api.setFile(
        { owner: ORG, repo: CLAIMS_REPO },
        `claims/components/${name}.yaml`,
        'spec:\n  owner: team\n  system: sys\n',
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

    // Elixir maps to 'elixir', which is outside the feature enum -> constrained to 'simple'
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

    // C# maps directly to 'simple'
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
      'component-precedence': 'components/precedence.yaml',
      'component-defaults': 'components/defaults.yaml',
    });
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/precedence.yaml',
      [
        'spec:',
        '  owner: team',
        '  system: sys',
        '  features:',
        '    - name: build_and_dispatch_docker_images',
        '      args:',
        '        trigger_filter_by_env_snapshot: dev,pre,overlap',
        '        trigger_filter_by_env_pre_releases: pre,overlap',
        '        trigger_filter_by_env_releases: pro,overlap',
      ].join('\n'),
    );
    api.setFile(
      { owner: ORG, repo: CLAIMS_REPO },
      'claims/components/defaults.yaml',
      'spec:\n  owner: team\n  system: sys\n',
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
