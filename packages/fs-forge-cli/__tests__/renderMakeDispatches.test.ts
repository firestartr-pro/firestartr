import { describe, expect, it } from '@jest/globals';
import { resolve } from 'path';
import YAML from 'yaml';

import { renderMakeDispatches } from '../src/app/render/makeDispatches.js';
import {
  actionsSchemasDir,
  loadActionsValidator,
} from '../src/schema/actionsSchemas.js';

import type { AppInputs } from '../src/schema/appInputs.js';

const PACKAGE_ROOT = resolve(__dirname, '..');
const ACTIONS_SCHEMAS_DIR = actionsSchemasDir(PACKAGE_ROOT);

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
    {
      platform: 'eks-eu',
      tenant: 'core',
      env: 'pre',
      cluster_url: 'https://eks-eu.example.com',
      track: 'pre-releases',
      flavor: 'worker',
    },
    {
      platform: 'eks-eu',
      tenant: 'core',
      env: 'pro',
      cluster_url: 'https://eks-eu.example.com',
      track: 'releases',
    },
  ],
  chart: {
    name: 'web-app',
    version: '1.0.0',
    registry: 'ecr-main',
  },
};

describe('renderMakeDispatches', () => {
  it('creates a valid make_dispatches.yaml for all three tracks', () => {
    const result = renderMakeDispatches({
      org: 'acme',
      inputs: BASE_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
    });

    expect(result.path).toBe('.github/make_dispatches.yaml');
    expect(result.outcome).toEqual({ kind: 'create' });
    expect(result.content).toBeDefined();

    const parsed = YAML.parse(result.content!) as { deployments: unknown[] };
    expect(parsed).toEqual({
      deployments: [
        {
          application: 'billing',
          platform: 'eks-eu',
          tenant: 'core',
          env: 'dev',
          type: 'snapshots',
          version: '$branch_main',
          flavor: 'default',
          service_names: ['billing-api'],
        },
        {
          application: 'billing',
          platform: 'eks-eu',
          tenant: 'core',
          env: 'pre',
          type: 'snapshots',
          version: '$latest_prerelease',
          flavor: 'worker',
          service_names: ['billing-api'],
        },
        {
          application: 'billing',
          platform: 'eks-eu',
          tenant: 'core',
          env: 'pro',
          type: 'releases',
          version: '$latest_release',
          flavor: 'default',
          service_names: ['billing-api'],
        },
      ],
    });

    const validate = loadActionsValidator('make_dispatches', ACTIONS_SCHEMAS_DIR);
    expect(validate(parsed)).toBe(true);
  });

  it('is idempotent (noop) on its own output', () => {
    const created = renderMakeDispatches({
      org: 'acme',
      inputs: BASE_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
    });

    const second = renderMakeDispatches({
      org: 'acme',
      inputs: BASE_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: created.content,
    });

    expect(second.outcome).toEqual({ kind: 'noop' });
    expect(second.content).toBe(created.content);
    expect(second.notes).toBeUndefined();
  });

  it('appends missing entries and adds missing service_names while keeping comments and other entries', () => {
    const existing = [
      '# Existing dispatches',
      'deployments:',
      '  - application: other-app',
      '    platform: eks-eu',
      '    tenant: core',
      '    env: dev',
      '    type: snapshots',
      '    version: $branch_main',
      '    flavor: default',
      '    service_names:',
      '      - other-svc',
      '  - application: billing',
      '    platform: eks-eu',
      '    tenant: core',
      '    env: dev',
      '    type: snapshots',
      '    version: $branch_main',
      '    flavor: default',
      '    service_names:',
      '      - existing-svc',
      '',
    ].join('\n');

    const result = renderMakeDispatches({
      org: 'acme',
      inputs: {
        ...BASE_INPUTS,
        targets: [BASE_INPUTS.targets[0], BASE_INPUTS.targets[2]],
      },
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome).toEqual({
      kind: 'merge',
      added: [
        'service_name:billing/eks-eu/core/dev/default:billing-api',
        'deployment:billing/eks-eu/core/pro/default',
      ],
    });
    expect(result.content).toContain('# Existing dispatches');

    const parsed = YAML.parse(result.content!) as {
      deployments: Array<{ application: string; env: string; service_names?: string[] }>;
    };
    expect(parsed.deployments).toHaveLength(3);
    expect(parsed.deployments[0].application).toBe('other-app');
    expect(parsed.deployments[1].service_names).toEqual([
      'existing-svc',
      'billing-api',
    ]);
    expect(parsed.deployments[2].env).toBe('pro');
  });

  it('reports info and leaves entry unchanged when it uses image_keys or has a different version', () => {
    const existing = [
      'deployments:',
      '  - application: billing',
      '    platform: eks-eu',
      '    tenant: core',
      '    env: dev',
      '    type: snapshots',
      '    version: $branch_develop',
      '    flavor: default',
      '    image_keys:',
      '      - api',
      '',
    ].join('\n');

    const result = renderMakeDispatches({
      org: 'acme',
      inputs: {
        ...BASE_INPUTS,
        targets: [BASE_INPUTS.targets[0]],
      },
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome).toEqual({ kind: 'noop' });
    expect(result.content).toBe(existing);
    expect(result.notes).toHaveLength(2);
    expect(result.notes![0]).toContain('$branch_develop');
    expect(result.notes![1]).toContain('image_keys');
  });

  it('conflicts when an existing entry with the same identity has a different type', () => {
    const existing = [
      'deployments:',
      '  - application: billing',
      '    platform: eks-eu',
      '    tenant: core',
      '    env: dev',
      '    type: releases',
      '    version: $latest_release',
      '    flavor: default',
      '    service_names:',
      '      - billing-api',
      '',
    ].join('\n');

    const result = renderMakeDispatches({
      org: 'acme',
      inputs: {
        ...BASE_INPUTS,
        targets: [BASE_INPUTS.targets[0]],
      },
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome.kind).toBe('conflict');
    expect(result.content).toBeUndefined();
  });

  it('conflicts on unparsable YAML or wrong-typed owned nodes', () => {
    const malformed = renderMakeDispatches({
      org: 'acme',
      inputs: BASE_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: 'deployments: [unclosed',
    });
    expect(malformed.outcome.kind).toBe('conflict');
    expect(malformed.content).toBeUndefined();

    const wrongType = renderMakeDispatches({
      org: 'acme',
      inputs: BASE_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: 'deployments: not-a-list\n',
    });
    expect(wrongType.outcome.kind).toBe('conflict');
    expect(wrongType.content).toBeUndefined();
  });

  it('preserves CRLF line endings on merge', () => {
    const existing = ['deployments: []', ''].join('\r\n');
    const result = renderMakeDispatches({
      org: 'acme',
      inputs: {
        ...BASE_INPUTS,
        targets: [BASE_INPUTS.targets[0]],
      },
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome.kind).toBe('merge');
    expect(result.content).toContain('\r\n');
    expect(result.content).not.toMatch(/(?<!\r)\n/);
  });
});
