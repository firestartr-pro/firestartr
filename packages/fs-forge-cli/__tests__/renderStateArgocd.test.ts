import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

import { renderStateArgocd } from '../src/app/render/stateArgocd.js';
import {
  loadVendorValidator,
  vendorSchemasDir,
} from '../src/schema/vendorSchemas.js';

import type { DiscoveredPlatform } from '../src/app/dotFirestartr.js';
import type { AppInputs } from '../src/schema/appInputs.js';

const PACKAGE_ROOT = join(__dirname, '..');
const VENDOR_DIR = vendorSchemasDir(PACKAGE_ROOT);
const FIXTURES_DIR = join(
  PACKAGE_ROOT,
  '__tests__',
  'fixtures',
  'dot-firestartr',
);

function loadPlatformFixture(): DiscoveredPlatform {
  const parsed = YAML.parse(
    readFileSync(join(FIXTURES_DIR, 'platforms.yaml'), 'utf8'),
  ) as DiscoveredPlatform;
  return parsed;
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

describe('renderStateArgocd', () => {
  const validateAppSet = loadVendorValidator(
    'argocd-applicationset',
    VENDOR_DIR,
  );
  const validateProject = loadVendorValidator('argocd-appproject', VENDOR_DIR);
  const platforms = [loadPlatformFixture()];

  it('creates canonical ApplicationSet and AppProject with slack_channel matching councilbox ground truth', () => {
    const result = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs({ slack_channel: '#billing-alerts' }),
      platforms,
      vendorDir: VENDOR_DIR,
    });

    expect(result.applicationSet.path).toBe(
      'apps/billing/argo-billing.ApplicationSet.yaml',
    );
    expect(result.applicationSet.outcome).toEqual({ kind: 'create' });
    const appSet = YAML.parse(result.applicationSet.content ?? '');
    expect(validateAppSet(appSet)).toBe(true);
    expect(appSet).toEqual({
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'ApplicationSet',
      metadata: {
        name: 'app-billing',
        namespace: 'argocd',
      },
      spec: {
        goTemplate: true,
        goTemplateOptions: ['missingkey=error'],
        generators: [
          {
            git: {
              repoURL: 'https://github.com/acme/app-billing.git',
              revision: 'deployment',
              directories: [{ path: 'kubernetes/*/*/*' }],
              values: { 'example-dev': 'https://eks-dev.example.com' },
            },
          },
        ],
        template: {
          metadata: {
            name: 'app-billing-{{index .path.segments 1}}-{{index .path.segments 2}}-{{index .path.segments 3}}',
            labels: {
              'app-name': 'billing',
            },
          },
          spec: {
            project: 'app-billing',
            source: {
              repoURL: 'https://github.com/acme/app-billing.git',
              targetRevision: 'deployment',
              path: '{{index .path.segments 0}}/{{index .path.segments 1}}/{{index .path.segments 2}}/{{index .path.segments 3}}',
            },
            destination: {
              server: '{{index .values (index .path.segments 1)}}',
              namespace:
                '{{index .path.segments 2}}-billing-{{index .path.segments 3}}',
            },
            syncPolicy: {
              automated: {
                prune: true,
              },
              syncOptions: ['CreateNamespace=true', 'ServerSideApply=true'],
            },
            ignoreDifferences: [
              {
                group: 'policy',
                kind: 'PodDisruptionBudget',
                jsonPointers: [
                  '/status',
                  '/metadata/uid',
                  '/metadata/generation',
                  '/metadata/resourceVersion',
                  '/metadata/creationTimestamp',
                ],
              },
              {
                group: 'keda.sh',
                kind: 'ScaledObject',
                jsonPointers: [
                  '/status',
                  '/metadata/uid',
                  '/metadata/generation',
                  '/metadata/resourceVersion',
                  '/metadata/creationTimestamp',
                ],
              },
            ],
          },
        },
      },
    });

    expect(result.appProject.path).toBe(
      'apps/billing/argo-billing.Project.yaml',
    );
    expect(result.appProject.outcome).toEqual({ kind: 'create' });
    const project = YAML.parse(result.appProject.content ?? '');
    expect(validateProject(project)).toBe(true);
    expect(project).toEqual({
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'AppProject',
      metadata: {
        name: 'app-billing',
        namespace: 'argocd',
        annotations: {
          'notifications.argoproj.io/subscribe.on-deployed.github':
            'fs-argocd-notifications',
          'notifications.argoproj.io/subscribe.on-health-degraded.github':
            'fs-argocd-notifications',
          'notifications.argoproj.io/subscribe.on-sync-failed.github':
            'fs-argocd-notifications',
          'notifications.argoproj.io/subscribe.on-sync-failed.slack':
            '#billing-alerts',
          'notifications.argoproj.io/subscribe.on-health-degraded.slack':
            '#billing-alerts',
        },
      },
      spec: {
        description: 'billing State Project',
        sourceRepos: ['https://github.com/acme/app-billing.git'],
        destinations: [
          {
            namespace: 'example-team-billing-dev',
            server: 'https://eks-dev.example.com',
          },
        ],
        clusterResourceWhitelist: [
          { group: '', kind: 'Namespace' },
          { group: '', kind: 'PersistentVolume' },
          { group: 'networking.k8s.io', kind: 'IngressClass' },
          { group: 'rbac.authorization.k8s.io', kind: 'ClusterRole' },
          { group: 'rbac.authorization.k8s.io', kind: 'ClusterRoleBinding' },
          {
            group: 'apiextensions.k8s.io',
            kind: 'CustomResourceDefinition',
          },
        ],
      },
    });
  });

  it('creates canonical AppProject without Slack annotations when slack_channel is not set', () => {
    const result = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });

    const project = YAML.parse(result.appProject.content ?? '');
    expect(validateProject(project)).toBe(true);
    expect(project).toEqual({
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'AppProject',
      metadata: {
        name: 'app-billing',
        namespace: 'argocd',
        annotations: {
          'notifications.argoproj.io/subscribe.on-deployed.github':
            'fs-argocd-notifications',
          'notifications.argoproj.io/subscribe.on-health-degraded.github':
            'fs-argocd-notifications',
          'notifications.argoproj.io/subscribe.on-sync-failed.github':
            'fs-argocd-notifications',
        },
      },
      spec: {
        description: 'billing State Project',
        sourceRepos: ['https://github.com/acme/app-billing.git'],
        destinations: [
          {
            namespace: 'example-team-billing-dev',
            server: 'https://eks-dev.example.com',
          },
        ],
        clusterResourceWhitelist: [
          { group: '', kind: 'Namespace' },
          { group: '', kind: 'PersistentVolume' },
          { group: 'networking.k8s.io', kind: 'IngressClass' },
          { group: 'rbac.authorization.k8s.io', kind: 'ClusterRole' },
          { group: 'rbac.authorization.k8s.io', kind: 'ClusterRoleBinding' },
          {
            group: 'apiextensions.k8s.io',
            kind: 'CustomResourceDefinition',
          },
        ],
      },
    });
  });

  it('returns noop on identical existing ApplicationSet and AppProject', () => {
    const created = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });

    const rerun = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: created.applicationSet.content ?? '',
      },
      existingAppProject: {
        path: created.appProject.path,
        content: created.appProject.content ?? '',
      },
    });

    expect(rerun.applicationSet.outcome).toEqual({ kind: 'noop' });
    expect(rerun.appProject.outcome).toEqual({ kind: 'noop' });
  });

  it('merges missing values and destinations while preserving comments and unowned fields', () => {
    const created = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });

    const appSetWithComment = `# Keep this ApplicationSet comment\n${created.applicationSet.content}`;
    const projectWithComment = `# Keep this AppProject comment\n${created.appProject.content}  syncWindows:\n    - kind: allow\n      schedule: "* * * * *"\n      duration: 1h\n`;

    const merged = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs({
        targets: [
          {
            platform: 'example-dev',
            tenant: 'example-team',
            env: 'dev',
            cluster_url: 'https://eks-dev.example.com',
            track: 'snapshots',
          },
          {
            platform: 'example-prod',
            tenant: 'example-team',
            env: 'pro',
            cluster_url: 'https://eks-prod.example.com',
            track: 'releases',
          },
        ],
      }),
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: appSetWithComment,
      },
      existingAppProject: {
        path: created.appProject.path,
        content: projectWithComment,
      },
    });

    expect(merged.applicationSet.outcome).toEqual({
      kind: 'merge',
      added: ['value:example-prod'],
    });
    expect(merged.applicationSet.content).toContain(
      '# Keep this ApplicationSet comment',
    );
    const mergedAppSet = YAML.parse(merged.applicationSet.content ?? '');
    expect(validateAppSet(mergedAppSet)).toBe(true);
    expect(mergedAppSet.spec.generators[0].git.values['example-prod']).toBe(
      'https://eks-prod.example.com',
    );

    expect(merged.appProject.outcome).toEqual({
      kind: 'merge',
      added: ['destination:example-team-billing-pro'],
    });
    expect(merged.appProject.content).toContain(
      '# Keep this AppProject comment',
    );
    const mergedProject = YAML.parse(merged.appProject.content ?? '');
    expect(validateProject(mergedProject)).toBe(true);
    expect(mergedProject.spec.syncWindows).toHaveLength(1);
    expect(mergedProject.spec.destinations).toHaveLength(2);
  });

  it('reports conflict on both ApplicationSet and AppProject when same cluster has a different URL', () => {
    const created = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });

    const conflict = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs({
        targets: [
          {
            platform: 'example-dev',
            tenant: 'example-team',
            env: 'dev',
            cluster_url: 'https://different.example.com',
            track: 'snapshots',
          },
        ],
      }),
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: created.applicationSet.content ?? '',
      },
      existingAppProject: {
        path: created.appProject.path,
        content: created.appProject.content ?? '',
      },
    });

    expect(conflict.applicationSet.outcome.kind).toBe('conflict');
    expect(conflict.applicationSet.content).toBeUndefined();
    expect(conflict.appProject.outcome.kind).toBe('conflict');
    expect(conflict.appProject.content).toBeUndefined();
  });

  it('merges a second cluster for an existing env when inputs list only the new cluster', () => {
    const created = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });

    const merged = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs({
        targets: [
          {
            platform: 'example-dev-b',
            tenant: 'example-team',
            env: 'dev',
            cluster_url: 'https://eks-dev-b.example.com',
            track: 'snapshots',
          },
        ],
      }),
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: created.applicationSet.content ?? '',
      },
      existingAppProject: {
        path: created.appProject.path,
        content: created.appProject.content ?? '',
      },
    });

    expect(merged.applicationSet.outcome).toEqual({
      kind: 'merge',
      added: ['value:example-dev-b'],
    });
    expect(merged.appProject.outcome).toEqual({
      kind: 'merge',
      added: ['destination:example-team-billing-dev'],
    });
    const mergedProject = YAML.parse(merged.appProject.content ?? '');
    expect(mergedProject.spec.destinations).toEqual([
      {
        namespace: 'example-team-billing-dev',
        server: 'https://eks-dev.example.com',
      },
      {
        namespace: 'example-team-billing-dev',
        server: 'https://eks-dev-b.example.com',
      },
    ]);
  });

  it('reports conflict on mismatched kind, repoURL, project, or label', () => {
    const created = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });

    const wrongRepo = (created.applicationSet.content ?? '').replace(
      'https://github.com/acme/app-billing.git',
      'https://github.com/acme/other-repo.git',
    );
    const resRepo = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: wrongRepo,
      },
    });
    expect(resRepo.applicationSet.outcome.kind).toBe('conflict');

    const wrongLabel = (created.applicationSet.content ?? '').replace(
      'app-name: billing',
      'app-name: other',
    );
    const resLabel = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: wrongLabel,
      },
    });
    expect(resLabel.applicationSet.outcome.kind).toBe('conflict');

    const wrongProject = (created.applicationSet.content ?? '').replace(
      'project: app-billing',
      'project: other-project',
    );
    const resProject = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: wrongProject,
      },
    });
    expect(resProject.applicationSet.outcome.kind).toBe('conflict');

    const wrongKind = (created.appProject.content ?? '').replace(
      'kind: AppProject',
      'kind: Application',
    );
    const resKind = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
      existingAppProject: {
        path: created.appProject.path,
        content: wrongKind,
      },
    });
    expect(resKind.appProject.outcome.kind).toBe('conflict');
    expect(resKind.appProject.content).toBeUndefined();
  });

  it('returns noop on re-render when the same tenant/env targets two clusters', () => {
    const twoClusterPlatforms: DiscoveredPlatform[] = [
      { name: 'c1', type: 'kubernetes', tenants: [], envs: [] },
      { name: 'c2', type: 'kubernetes', tenants: [], envs: [] },
    ];
    const twoClusterInputs = baseInputs({
      targets: [
        {
          platform: 'c1',
          tenant: 't',
          env: 'dev',
          cluster_url: 'https://u1',
          track: 'snapshots',
        },
        {
          platform: 'c2',
          tenant: 't',
          env: 'dev',
          cluster_url: 'https://u2',
          track: 'snapshots',
        },
      ],
    });

    const c1 = renderStateArgocd({
      org: 'acme',
      inputs: twoClusterInputs,
      platforms: twoClusterPlatforms,
      vendorDir: VENDOR_DIR,
    });
    const c2 = renderStateArgocd({
      org: 'acme',
      inputs: twoClusterInputs,
      platforms: twoClusterPlatforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: c1.applicationSet.path,
        content: c1.applicationSet.content ?? '',
      },
      existingAppProject: {
        path: c1.appProject.path,
        content: c1.appProject.content ?? '',
      },
    });

    expect(c2.applicationSet.outcome).toEqual({ kind: 'noop' });
    expect(c2.appProject.outcome).toEqual({ kind: 'noop' });
  });

  it('returns conflict instead of throwing when merged ApplicationSet or AppProject fails schema validation', () => {
    const created = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });
    const twoTargets = baseInputs({
      targets: [
        {
          platform: 'example-dev',
          tenant: 'example-team',
          env: 'dev',
          cluster_url: 'https://eks-dev.example.com',
          track: 'snapshots',
        },
        {
          platform: 'example-prod',
          tenant: 'example-team',
          env: 'pro',
          cluster_url: 'https://eks-prod.example.com',
          track: 'releases',
        },
      ],
    });

    const invalidAppSet = (created.applicationSet.content ?? '').replace(
      'goTemplate: true',
      'goTemplate: "not-a-bool"',
    );
    const invalidProject = (created.appProject.content ?? '').replace(
      'description: billing State Project',
      'description: 12345',
    );

    const res = renderStateArgocd({
      org: 'acme',
      inputs: twoTargets,
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: invalidAppSet,
      },
      existingAppProject: {
        path: created.appProject.path,
        content: invalidProject,
      },
    });

    expect(res.applicationSet.outcome.kind).toBe('conflict');
    expect(res.applicationSet.content).toBeUndefined();
    expect(res.appProject.outcome.kind).toBe('conflict');
    expect(res.appProject.content).toBeUndefined();
  });

  it('returns conflict when owned values or destinations node has wrong YAML type', () => {
    const created = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });
    const twoTargets = baseInputs({
      targets: [
        {
          platform: 'example-dev',
          tenant: 'example-team',
          env: 'dev',
          cluster_url: 'https://eks-dev.example.com',
          track: 'snapshots',
        },
        {
          platform: 'example-prod',
          tenant: 'example-team',
          env: 'pro',
          cluster_url: 'https://eks-prod.example.com',
          track: 'releases',
        },
      ],
    });

    const strVals = (created.applicationSet.content ?? '').replace(
      /values:\n(\s+example-dev:[^\n]*\n)?/,
      'values: just-a-string\n',
    );
    const resAppSet = renderStateArgocd({
      org: 'acme',
      inputs: twoTargets,
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: strVals,
      },
    });
    expect(resAppSet.applicationSet.outcome.kind).toBe('conflict');
    expect(resAppSet.applicationSet.content).toBeUndefined();
    if (resAppSet.applicationSet.outcome.kind === 'conflict') {
      expect(resAppSet.applicationSet.outcome.reason).toContain('values');
    }

    const projStr = (created.appProject.content ?? '').replace(
      /destinations:\n(\s+-[^\n]*\n(\s+[^\n]*\n)*)?/,
      'destinations: oops\n',
    );
    const resProj = renderStateArgocd({
      org: 'acme',
      inputs: twoTargets,
      platforms,
      vendorDir: VENDOR_DIR,
      existingAppProject: {
        path: created.appProject.path,
        content: projStr,
      },
    });
    expect(resProj.appProject.outcome.kind).toBe('conflict');
    expect(resProj.appProject.content).toBeUndefined();
    if (resProj.appProject.outcome.kind === 'conflict') {
      expect(resProj.appProject.outcome.reason).toContain('destinations');
    }
  });

  it('omits content on cluster URL split conflict during create', () => {
    const res = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs({
        targets: [
          {
            platform: 'example-dev',
            tenant: 't1',
            env: 'dev',
            cluster_url: 'https://u1',
            track: 'snapshots',
          },
          {
            platform: 'example-dev',
            tenant: 't2',
            env: 'dev',
            cluster_url: 'https://u2',
            track: 'snapshots',
          },
        ],
      }),
      platforms,
      vendorDir: VENDOR_DIR,
    });

    expect(res.applicationSet.outcome.kind).toBe('conflict');
    expect(res.applicationSet.content).toBeUndefined();
  });

  it('preserves CRLF line endings when merging into CRLF files', () => {
    const created = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });
    const crlfAppSet = (created.applicationSet.content ?? '').replace(
      /\n/g,
      '\r\n',
    );
    const crlfProject = (created.appProject.content ?? '').replace(
      /\n/g,
      '\r\n',
    );

    const merged = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs({
        targets: [
          {
            platform: 'example-dev',
            tenant: 'example-team',
            env: 'dev',
            cluster_url: 'https://eks-dev.example.com',
            track: 'snapshots',
          },
          {
            platform: 'example-prod',
            tenant: 'example-team',
            env: 'pro',
            cluster_url: 'https://eks-prod.example.com',
            track: 'releases',
          },
        ],
      }),
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: crlfAppSet,
      },
      existingAppProject: {
        path: created.appProject.path,
        content: crlfProject,
      },
    });

    expect(merged.applicationSet.outcome.kind).toBe('merge');
    expect(merged.applicationSet.content).toContain('\r\n');
    expect(merged.applicationSet.content).not.toMatch(/(?<!\r)\n/);
    expect(merged.appProject.outcome.kind).toBe('merge');
    expect(merged.appProject.content).toContain('\r\n');
    expect(merged.appProject.content).not.toMatch(/(?<!\r)\n/);
  });

  it('leaves output as LF when existing files have mixed line endings', () => {
    const created = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });
    const mixedAppSet = (created.applicationSet.content ?? '').replace(
      '\n',
      '\r\n',
    );
    const mixedProject = (created.appProject.content ?? '').replace(
      '\n',
      '\r\n',
    );

    const merged = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs({
        targets: [
          {
            platform: 'example-dev',
            tenant: 'example-team',
            env: 'dev',
            cluster_url: 'https://eks-dev.example.com',
            track: 'snapshots',
          },
          {
            platform: 'example-prod',
            tenant: 'example-team',
            env: 'pro',
            cluster_url: 'https://eks-prod.example.com',
            track: 'releases',
          },
        ],
      }),
      platforms,
      vendorDir: VENDOR_DIR,
      existingApplicationSet: {
        path: created.applicationSet.path,
        content: mixedAppSet,
      },
      existingAppProject: {
        path: created.appProject.path,
        content: mixedProject,
      },
    });

    expect(merged.applicationSet.outcome.kind).toBe('merge');
    expect(merged.applicationSet.content).not.toContain('\r\n');
    expect(merged.appProject.outcome.kind).toBe('merge');
    expect(merged.appProject.content).not.toContain('\r\n');
  });
});
