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

  it('creates ApplicationSet and AppProject from scratch matching spec and vendored schemas', () => {
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
    const appSet = YAML.parse(result.applicationSet.content);
    expect(validateAppSet(appSet)).toBe(true);
    expect(appSet.metadata).toEqual({ name: 'app-billing', namespace: 'argocd' });
    expect(appSet.spec.goTemplate).toBe(true);
    expect(appSet.spec.goTemplateOptions).toEqual(['missingkey=error']);
    expect(appSet.spec.generators[0].git).toEqual({
      repoURL: 'https://github.com/acme/app-billing.git',
      revision: 'deployment',
      directories: [{ path: 'kubernetes/*/*/*' }],
      values: { 'example-dev': 'https://eks-dev.example.com' },
    });
    expect(appSet.spec.template.metadata.labels).toEqual({
      'app-name': 'billing',
    });

    expect(result.appProject.path).toBe(
      'apps/billing/argo-billing.Project.yaml',
    );
    expect(result.appProject.outcome).toEqual({ kind: 'create' });
    const project = YAML.parse(result.appProject.content);
    expect(validateProject(project)).toBe(true);
    expect(project.metadata.annotations).toEqual({
      'notifications.argoproj.io/subscribe.on-sync-running.github':
        'fs-argocd-notifications',
      'notifications.argoproj.io/subscribe.on-sync-succeeded.github':
        'fs-argocd-notifications',
      'notifications.argoproj.io/subscribe.on-sync-failed.github':
        'fs-argocd-notifications',
      'notifications.argoproj.io/subscribe.on-sync-failed.slack':
        '#billing-alerts',
      'notifications.argoproj.io/subscribe.on-health-degraded.slack':
        '#billing-alerts',
    });
    expect(project.spec.description).toBe('billing State Project');
    expect(project.spec.destinations).toEqual([
      {
        namespace: 'example-team-billing-dev',
        server: 'https://eks-dev.example.com',
      },
    ]);
  });

  it('omits Slack annotations when slack_channel is not set', () => {
    const result = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });

    const project = YAML.parse(result.appProject.content);
    expect(validateProject(project)).toBe(true);
    const keys = Object.keys(project.metadata.annotations);
    expect(keys.some((k) => k.endsWith('.slack'))).toBe(false);
    expect(keys).toHaveLength(3);
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
        content: created.applicationSet.content,
      },
      existingAppProject: {
        path: created.appProject.path,
        content: created.appProject.content,
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
    const mergedAppSet = YAML.parse(merged.applicationSet.content);
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
    const mergedProject = YAML.parse(merged.appProject.content);
    expect(validateProject(mergedProject)).toBe(true);
    expect(mergedProject.spec.syncWindows).toHaveLength(1);
    expect(mergedProject.spec.destinations).toHaveLength(2);
  });

  it('reports conflict when same cluster has a different URL', () => {
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
        content: created.applicationSet.content,
      },
      existingAppProject: {
        path: created.appProject.path,
        content: created.appProject.content,
      },
    });

    expect(conflict.applicationSet.outcome.kind).toBe('conflict');
    expect(conflict.appProject.outcome.kind).toBe('conflict');
  });

  it('reports conflict on mismatched kind, repoURL, project, or label', () => {
    const created = renderStateArgocd({
      org: 'acme',
      inputs: baseInputs(),
      platforms,
      vendorDir: VENDOR_DIR,
    });

    const wrongRepo = created.applicationSet.content.replace(
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

    const wrongLabel = created.applicationSet.content.replace(
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

    const wrongProject = created.applicationSet.content.replace(
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

    const wrongKind = created.appProject.content.replace(
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
  });
});
