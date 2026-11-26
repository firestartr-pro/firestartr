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

const SINGLE_TARGET_INPUTS: AppInputs = {
  ...BASE_INPUTS,
  targets: [BASE_INPUTS.targets[0]],
};

/** The single target as a block-style sequence item (the create path body). */
const BILLING_BLOCK_ENTRY = [
  '  - application: billing',
  '    platform: eks-eu',
  '    tenant: core',
  '    env: dev',
  '    type: snapshots',
  '    version: $branch_main',
  '    flavor: default',
  '    service_names:',
  '      - billing-api',
  '',
].join('\n');

/** Block style, `---` first: what `yamllint -d default` accepts. */
const BLOCK_SINGLE_DEPLOYMENT = `---\ndeployments:\n${BILLING_BLOCK_ENTRY}`;

const OTHER_BLOCK_ENTRY = [
  '  - application: other-app',
  '    platform: eks-eu',
  '    tenant: core',
  '    env: dev',
  '    type: snapshots',
  '    version: $branch_main',
  '    flavor: default',
].join('\n');

/** Every base below passes `yamllint -d default` before the merge. */
const YAMLLINT_VALID_BASES: Array<[string, string]> = [
  ['top-level flow map', '---\n{deployments: []}\n'],
  [
    'flow entry that gets a new service name',
    [
      '---',
      'deployments:',
      '  - {application: billing, platform: eks-eu, tenant: core, env: dev,',
      '     type: snapshots, version: $branch_main, flavor: default,',
      '     service_names: [other-svc]}',
      '',
    ].join('\n'),
  ],
  [
    'untouched entry with flow service_names',
    [
      '---',
      'deployments:',
      OTHER_BLOCK_ENTRY,
      '    service_names: [other-svc]',
      '',
    ].join('\n'),
  ],
  ['empty flow sequence', 'deployments: []\n'],
  [
    'existing block entries',
    [
      '# Existing dispatches',
      'deployments:',
      OTHER_BLOCK_ENTRY,
      '    service_names:',
      '      - other-svc',
      '',
    ].join('\n'),
  ],
  ['comments', '# header comment\ndeployments: [] # empty list\n'],
  ['leading document start', '---\ndeployments: []\n'],
  [
    'untouched flow entry inside a flow document',
    [
      '---',
      '{deployments: [{application: other-app, platform: eks-eu, tenant: core,',
      '                env: dev, type: snapshots, version: $branch_main,',
      '                flavor: default, service_names: [other-svc]}]}',
      '',
    ].join('\n'),
  ],
];

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

  it('creates the file in block style with a document start', () => {
    const result = renderMakeDispatches({
      org: 'acme',
      inputs: SINGLE_TARGET_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
    });

    expect(result.content).toBe(BLOCK_SINGLE_DEPLOYMENT);
  });

  it('merges into an empty flow-style base as block style, matching the create path', () => {
    const created = renderMakeDispatches({
      org: 'acme',
      inputs: SINGLE_TARGET_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
    });

    const merged = renderMakeDispatches({
      org: 'acme',
      inputs: SINGLE_TARGET_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: 'deployments: []\n',
    });

    expect(merged.outcome.kind).toBe('merge');
    expect(merged.content).toBe(BLOCK_SINGLE_DEPLOYMENT);
    expect(merged.content).toBe(created.content);
  });

  it('merges into a base with existing entries without flow collections', () => {
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
      '',
    ].join('\n');

    const result = renderMakeDispatches({
      org: 'acme',
      inputs: SINGLE_TARGET_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome.kind).toBe('merge');
    expect(result.content).toBe(
      [
        '---',
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
        '      - billing-api',
        '',
      ].join('\n'),
    );
  });

  it('renders a flow-style base as block style, so the merge no longer breaks `yamllint -d default`', () => {
    const expected: Record<string, string> = {
      'top-level flow map': BLOCK_SINGLE_DEPLOYMENT,
      'empty flow sequence': BLOCK_SINGLE_DEPLOYMENT,
      'leading document start': BLOCK_SINGLE_DEPLOYMENT,
      'flow entry that gets a new service name': [
        '---',
        'deployments:',
        '  - application: billing',
        '    platform: eks-eu',
        '    tenant: core',
        '    env: dev',
        '    type: snapshots',
        '    version: $branch_main',
        '    flavor: default',
        '    service_names:',
        '      - other-svc',
        '      - billing-api',
        '',
      ].join('\n'),
      'untouched entry with flow service_names': [
        '---',
        'deployments:',
        OTHER_BLOCK_ENTRY,
        '    service_names: [other-svc]',
        BILLING_BLOCK_ENTRY,
      ].join('\n'),
      comments: [
        '---',
        '# header comment',
        'deployments:',
        BILLING_BLOCK_ENTRY.trimEnd(),
        '  # empty list',
        '',
      ].join('\n'),
      'existing block entries': [
        '---',
        '# Existing dispatches',
        'deployments:',
        OTHER_BLOCK_ENTRY,
        '    service_names:',
        '      - other-svc',
        BILLING_BLOCK_ENTRY,
      ].join('\n'),
      'untouched flow entry inside a flow document': [
        '---',
        'deployments:',
        OTHER_BLOCK_ENTRY,
        '    service_names: [other-svc]',
        BILLING_BLOCK_ENTRY,
      ].join('\n'),
    };

    for (const [name, base] of YAMLLINT_VALID_BASES) {
      const result = renderMakeDispatches({
        org: 'acme',
        inputs: SINGLE_TARGET_INPUTS,
        defaultBranch: 'main',
        actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
        existingContent: base,
      });

      expect([name, result.outcome.kind]).toEqual([name, 'merge']);
      expect([name, result.content]).toEqual([name, expected[name]]);
      expect([name, result.content!.startsWith('---\n')]).toEqual([name, true]);
      expect([name, result.content!.split('---\n').length - 1]).toEqual([
        name,
        1,
      ]);
    }
  });

  it('leaves an empty base file alone with a clear reason', () => {
    const result = renderMakeDispatches({
      org: 'acme',
      inputs: SINGLE_TARGET_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: '',
    });

    expect(result.outcome).toEqual({
      kind: 'conflict',
      reason: 'Expected YAML mapping in .github/make_dispatches.yaml',
    });
    expect(result.content).toBeUndefined();
  });

  it('leaves a comments-only base file alone with a clear reason', () => {
    const result = renderMakeDispatches({
      org: 'acme',
      inputs: SINGLE_TARGET_INPUTS,
      defaultBranch: 'main',
      actionsSchemasDir: ACTIONS_SCHEMAS_DIR,
      existingContent: '# just a comment\n',
    });

    expect(result.outcome).toEqual({
      kind: 'conflict',
      reason: 'Expected YAML mapping in .github/make_dispatches.yaml',
    });
    expect(result.content).toBeUndefined();
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

  it('conflicts with a clear reason when an existing entry for our app is missing flavor', () => {
    const existing = [
      'deployments:',
      '  - application: billing',
      '    platform: eks-eu',
      '    tenant: core',
      '    env: dev',
      '    type: snapshots',
      '    version: $branch_main',
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
    if (result.outcome.kind === 'conflict') {
      expect(result.outcome.reason).toContain('invalid');
      expect(result.outcome.reason).toContain('fixed first');
      expect(result.outcome.reason).toContain('deployments[0] (application billing)');
      expect(result.outcome.reason).toContain("must have required property 'flavor'");
    }
  });

  it('conflicts with a clear reason when an existing entry for another app is missing flavor', () => {
    const existing = [
      'deployments:',
      '  - application: shop',
      '    platform: eks-eu',
      '    tenant: core',
      '    env: dev',
      '    type: snapshots',
      '    version: $branch_main',
      '    service_names:',
      '      - shop-api',
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
    if (result.outcome.kind === 'conflict') {
      expect(result.outcome.reason).toContain('invalid');
      expect(result.outcome.reason).toContain('fixed first');
      expect(result.outcome.reason).toContain('deployments[0] (application shop)');
      expect(result.outcome.reason).toContain("must have required property 'flavor'");
    }
  });

  it('conflicts on the noop path when an existing entry has both image_keys and service_names', () => {
    const existing = [
      'deployments:',
      '  - application: billing',
      '    platform: eks-eu',
      '    tenant: core',
      '    env: dev',
      '    type: snapshots',
      '    version: $branch_main',
      '    flavor: default',
      '    image_keys:',
      '      - img1',
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
    if (result.outcome.kind === 'conflict') {
      expect(result.outcome.reason).toContain('invalid');
      expect(result.outcome.reason).toContain('fixed first');
      expect(result.outcome.reason).toContain('deployments[0] (application billing)');
      expect(result.outcome.reason).toContain('service_names or image_keys');
    }
  });
});
