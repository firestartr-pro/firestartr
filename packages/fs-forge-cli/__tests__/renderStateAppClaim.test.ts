import { describe, expect, it } from '@jest/globals';
import { resolve } from 'path';
import YAML from 'yaml';

import { renderStateAppClaim } from '../src/app/render/stateAppClaim.js';
import { claimSchemasDir } from '../src/schema/claimSchemas.js';
import { createClaimValidator } from '../src/utils/ajvValidation.js';

import type { AppInputs } from '../src/schema/appInputs.js';

const PACKAGE_ROOT = resolve(__dirname, '..');
const SCHEMAS_DIR = claimSchemasDir(PACKAGE_ROOT);

const BASE_INPUTS: AppInputs = {
  app: 'billing',
  service: {
    repo: 'acme/billing-api',
    release_type: 'node',
  },
  targets: [
    {
      platform: 'eks-eu',
      tenant: 'core',
      env: 'dev',
      cluster_url: 'https://eks-eu.example.com',
      track: 'snapshots',
    },
  ],
  chart: {
    name: 'web-app',
    version: '1.2.3',
    registry: 'ecr-main',
  },
};

const SERVICE_CLAIM_DEFAULTS = {
  owner: 'group:default/platform',
  system: 'system:default/payments',
};

describe('renderStateAppClaim', () => {
  it('creates a valid ComponentClaim matching the spec shape', async () => {
    const result = await renderStateAppClaim({
      inputs: BASE_INPUTS,
      org: 'acme',
      serviceClaim: SERVICE_CLAIM_DEFAULTS,
      stateRepoAppsMajor: 3,
      claimSchemasDir: SCHEMAS_DIR,
    });

    expect(result.path).toBe('claims/components/app-billing.yaml');
    expect(result.outcome).toEqual({ kind: 'create' });
    expect(result.content).toBeDefined();

    const parsed = YAML.parse(result.content!) as Record<string, unknown>;
    expect(parsed).toEqual({
      kind: 'ComponentClaim',
      version: '1.0',
      name: 'app-billing',
      system: 'system:default/payments',
      owner: 'group:default/platform',
      type: 'service',
      lifecycle: 'production',
      providers: {
        github: {
          name: 'app-billing',
          org: 'acme',
          description: 'State repository for billing application',
          visibility: 'private',
          actions: {
            oidc: {
              useDefault: true,
            },
          },
          branchStrategy: {
            name: 'none',
            defaultBranch: 'main',
          },
          additionalBranches: [
            {
              name: 'deployment',
              orphan: true,
            },
          ],
          allowAutoMerge: true,
          deleteBranchOnMerge: true,
          allowUpdateBranch: true,
          features: [
            {
              name: 'state_repo_apps',
              ref: 'state_repo_apps-v3',
            },
          ],
        },
      },
    });
    expect(parsed.annotations).toBeUndefined();
    expect(parsed.labels).toBeUndefined();

    const validation = await createClaimValidator({
      schemasDir: SCHEMAS_DIR,
    }).validate(parsed, 'ComponentClaim');
    expect(validation).toEqual({ valid: true, errors: [] });
  });

  it('overrides owner and system from inputs when provided', async () => {
    const result = await renderStateAppClaim({
      inputs: {
        ...BASE_INPUTS,
        owner: 'group:default/billing-team',
        system: 'system:default/billing-sys',
      },
      org: 'acme',
      serviceClaim: SERVICE_CLAIM_DEFAULTS,
      stateRepoAppsMajor: 3,
      claimSchemasDir: SCHEMAS_DIR,
    });

    expect(result.outcome).toEqual({ kind: 'create' });
    const parsed = YAML.parse(result.content!) as Record<string, unknown>;
    expect(parsed.owner).toBe('group:default/billing-team');
    expect(parsed.system).toBe('system:default/billing-sys');
  });

  it('is idempotent (noop) on its own created output', async () => {
    const created = await renderStateAppClaim({
      inputs: BASE_INPUTS,
      org: 'acme',
      serviceClaim: SERVICE_CLAIM_DEFAULTS,
      stateRepoAppsMajor: 3,
      claimSchemasDir: SCHEMAS_DIR,
    });

    const second = await renderStateAppClaim({
      inputs: BASE_INPUTS,
      org: 'acme',
      serviceClaim: SERVICE_CLAIM_DEFAULTS,
      stateRepoAppsMajor: 3,
      claimSchemasDir: SCHEMAS_DIR,
      existingContent: created.content,
    });

    expect(second.outcome).toEqual({ kind: 'noop' });
    expect(second.content).toBe(created.content);
    expect(second.notes).toBeUndefined();
  });

  it('merges state_repo_apps when missing, preserving comments, unowned fields, and labels', async () => {
    const existing = [
      '# Existing state repo claim',
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: app-billing',
      'owner: group:default/other',
      'system: system:default/legacy',
      'type: service',
      'lifecycle: production',
      'providers:',
      '  github:',
      '    name: app-billing',
      '    org: acme',
      '    visibility: private',
      '    branchStrategy:',
      '      name: none',
      '      defaultBranch: main',
      '    labels:',
      '      - name: managed',
      '        color: ff0000',
      '    features:',
      '      - name: other_feature',
      '        ref: other_feature-v1',
      '',
    ].join('\n');

    const result = await renderStateAppClaim({
      inputs: BASE_INPUTS,
      org: 'acme',
      serviceClaim: SERVICE_CLAIM_DEFAULTS,
      stateRepoAppsMajor: 3,
      claimSchemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome).toEqual({
      kind: 'merge',
      added: ['feature:state_repo_apps'],
    });
    expect(result.content).toContain('# Existing state repo claim');

    const parsed = YAML.parse(result.content!) as {
      owner: string;
      providers: {
        github: {
          labels: unknown[];
          features: Array<{ name: string; ref?: string }>;
        };
      };
    };
    expect(parsed.owner).toBe('group:default/other');
    expect(parsed.providers.github.labels).toHaveLength(1);
    expect(parsed.providers.github.features).toEqual([
      { name: 'other_feature', ref: 'other_feature-v1' },
      { name: 'state_repo_apps', ref: 'state_repo_apps-v3' },
    ]);
  });

  it('reports noop with a warning note when state_repo_apps has a different major', async () => {
    const existing = [
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: app-billing',
      'owner: group:default/platform',
      'type: service',
      'lifecycle: production',
      'providers:',
      '  github:',
      '    name: app-billing',
      '    org: acme',
      '    features:',
      '      - name: state_repo_apps',
      '        ref: state_repo_apps-v2',
      '',
    ].join('\n');

    const result = await renderStateAppClaim({
      inputs: BASE_INPUTS,
      org: 'acme',
      serviceClaim: SERVICE_CLAIM_DEFAULTS,
      stateRepoAppsMajor: 3,
      claimSchemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome).toEqual({ kind: 'noop' });
    expect(result.content).toBe(existing);
    expect(result.notes).toHaveLength(1);
    expect(result.notes![0]).toContain('state_repo_apps-v2');
    expect(result.notes![0]).toContain('v3');
  });

  it('conflicts when an owned node has the wrong type', async () => {
    const existing = [
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: app-billing',
      'providers:',
      '  github:',
      '    name: app-billing',
      '    features: not-a-list',
      '',
    ].join('\n');

    const result = await renderStateAppClaim({
      inputs: BASE_INPUTS,
      org: 'acme',
      serviceClaim: SERVICE_CLAIM_DEFAULTS,
      stateRepoAppsMajor: 3,
      claimSchemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome.kind).toBe('conflict');
    expect(result.content).toBeUndefined();
  });

  it('preserves CRLF line endings on merge', async () => {
    const existing = [
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: app-billing',
      'owner: group:default/platform',
      'type: service',
      'lifecycle: production',
      'providers:',
      '  github:',
      '    name: app-billing',
      '    org: acme',
      '    visibility: private',
      '    branchStrategy:',
      '      name: none',
      '      defaultBranch: main',
      '',
    ].join('\r\n');

    const result = await renderStateAppClaim({
      inputs: BASE_INPUTS,
      org: 'acme',
      serviceClaim: SERVICE_CLAIM_DEFAULTS,
      stateRepoAppsMajor: 3,
      claimSchemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome.kind).toBe('merge');
    expect(result.content).toContain('\r\n');
    expect(result.content).not.toMatch(/(?<!\r)\n/);
  });

  it('conflicts when state_repo_apps is listed more than once', async () => {
    const existing = [
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: app-billing',
      'owner: group:default/platform',
      'type: service',
      'lifecycle: production',
      'providers:',
      '  github:',
      '    name: app-billing',
      '    org: acme',
      '    features:',
      '      - name: state_repo_apps',
      '        ref: state_repo_apps-v3',
      '      - name: state_repo_apps',
      '        ref: state_repo_apps-v3',
      '',
    ].join('\n');

    const result = await renderStateAppClaim({
      inputs: BASE_INPUTS,
      org: 'acme',
      serviceClaim: SERVICE_CLAIM_DEFAULTS,
      stateRepoAppsMajor: 3,
      claimSchemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome.kind).toBe('conflict');
    expect(result.content).toBeUndefined();
    if (result.outcome.kind === 'conflict') {
      expect(result.outcome.reason).toContain('state_repo_apps');
      expect(result.outcome.reason).toContain('2 times');
    }
  });
});
