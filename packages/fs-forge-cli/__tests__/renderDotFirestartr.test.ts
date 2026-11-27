import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

import { renderDotFirestartrApp } from '../src/app/render/dotFirestartr.js';
import {
  dotFirestartrSchemasDir,
  loadDotFirestartrValidator,
} from '../src/schema/dotFirestartrSchemas.js';

import type { AppInputs } from '../src/schema/appInputs.js';

const PACKAGE_ROOT = join(__dirname, '..');
const SCHEMAS_DIR = dotFirestartrSchemasDir(PACKAGE_ROOT);
const FIXTURES_DIR = join(
  PACKAGE_ROOT,
  '__tests__',
  'fixtures',
  'dot-firestartr',
);

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

describe('renderDotFirestartrApp', () => {
  const validate = loadDotFirestartrValidator('apps', SCHEMAS_DIR);

  it('creates apps/<app>.yaml from scratch matching the spec shape', () => {
    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs(),
      schemasDir: SCHEMAS_DIR,
    });

    expect(result.path).toBe('apps/billing.yaml');
    expect(result.outcome).toEqual({ kind: 'create' });

    const parsed = YAML.parse(result.content ?? '');
    expect(validate(parsed)).toBe(true);
    expect(parsed).toEqual({
      name: 'billing',
      state_repo: 'acme/app-billing',
      services: [
        {
          repo: 'acme/billing-api',
          service_names: ['billing-api'],
        },
      ],
    });
    expect(parsed.platforms).toBeUndefined();
  });

  it('uses service_names override when provided', () => {
    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs({
        service: {
          repo: 'billing-api',
          release_type: 'node',
          service_names: ['api', 'worker'],
        },
      }),
      schemasDir: SCHEMAS_DIR,
    });

    expect(result.outcome).toEqual({ kind: 'create' });
    const parsed = YAML.parse(result.content ?? '');
    expect(validate(parsed)).toBe(true);
    expect(parsed.services[0].service_names).toEqual(['api', 'worker']);
  });

  it('returns noop when existing file already has matching state_repo, service, and service_names', () => {
    const existing = [
      'name: billing',
      'state_repo: acme/app-billing',
      'platforms: [example-dev]',
      'services:',
      '  - repo: acme/billing-api',
      '    service_names: [billing-api, extra-svc]',
      '  - repo: acme/other-svc',
      '    service_names: [other-svc]',
      '',
    ].join('\n');

    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs(),
      schemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome).toEqual({ kind: 'noop' });
    expect(result.content).toBe(existing);
  });

  it('returns conflict when the existing document names a different app', () => {
    const existing = [
      'name: other-app',
      'state_repo: acme/app-billing',
      'services:',
      '  - repo: acme/billing-api',
      '    service_names: [billing-api]',
      '',
    ].join('\n');

    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs(),
      schemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome).toEqual({
      kind: 'conflict',
      reason: 'name is "other-app", expected "billing"',
    });
    expect(result.content).toBeUndefined();
  });

  it('returns conflict when the no-change path finds a schema-invalid document', () => {
    const existing = [
      'name: billing',
      'state_repo: acme/app-billing',
      'owner: someone',
      'services:',
      '  - repo: acme/billing-api',
      '    service_names: [billing-api]',
      '',
    ].join('\n');

    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs(),
      schemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome.kind).toBe('conflict');
    expect(result.content).toBeUndefined();
    if (result.outcome.kind === 'conflict') {
      expect(result.outcome.reason).toContain('owner');
    }
  });

  it('keeps the existing apps/<app>.yml path when the app is defined there', () => {
    const existing = [
      'name: billing',
      'state_repo: acme/app-billing',
      'services:',
      '  - repo: acme/billing-api',
      '    service_names: [billing-api]',
      '',
    ].join('\n');

    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs(),
      schemasDir: SCHEMAS_DIR,
      existingPath: 'apps/billing.yml',
      existingContent: existing,
    });

    expect(result.path).toBe('apps/billing.yml');
    expect(result.outcome).toEqual({ kind: 'noop' });
  });

  it('returns conflict when both apps/<app>.yaml and apps/<app>.yml exist', () => {
    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs(),
      schemasDir: SCHEMAS_DIR,
      existingContent: 'name: billing\nstate_repo: acme/app-billing\nservices: []\n',
      duplicatePaths: ['apps/billing.yaml', 'apps/billing.yml'],
    });

    expect(result.outcome.kind).toBe('conflict');
    expect(result.content).toBeUndefined();
    if (result.outcome.kind === 'conflict') {
      expect(result.outcome.reason).toContain('apps/billing.yaml');
      expect(result.outcome.reason).toContain('apps/billing.yml');
    }
  });

  it('merges a missing service_name into an existing service and preserves comments', () => {
    const existing = [
      '# Managed app config',
      'name: billing',
      'state_repo: acme/app-billing',
      'services:',
      '  # Primary service',
      '  - repo: acme/billing-api',
      '    service_names:',
      '      - existing-name',
      '',
    ].join('\n');

    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs({
        service: {
          repo: 'billing-api',
          release_type: 'node',
          service_names: ['existing-name', 'new-name'],
        },
      }),
      schemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome).toEqual({
      kind: 'merge',
      added: ['service_name:new-name'],
    });
    expect(result.content).toContain('# Managed app config');
    expect(result.content).toContain('# Primary service');
    const parsed = YAML.parse(result.content ?? '');
    expect(validate(parsed)).toBe(true);
    expect(parsed.services[0].service_names).toEqual([
      'existing-name',
      'new-name',
    ]);
  });

  it('merges a missing service entry into an existing file', () => {
    const existing = [
      'name: billing',
      'state_repo: acme/app-billing',
      'services:',
      '  - repo: acme/other-svc',
      '    service_names: [other-svc]',
      '',
    ].join('\n');

    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs(),
      schemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome).toEqual({
      kind: 'merge',
      added: ['service:acme/billing-api'],
    });
    const parsed = YAML.parse(result.content ?? '');
    expect(validate(parsed)).toBe(true);
    expect(parsed.services).toHaveLength(2);
    expect(parsed.services[1]).toEqual({
      repo: 'acme/billing-api',
      service_names: ['billing-api'],
    });
  });

  it('reports conflict when existing file has a legacy state_repo (using fixture)', () => {
    const fixture = readFileSync(join(FIXTURES_DIR, 'apps.yaml'), 'utf8');
    // Fixture has state_repo: example-org/store-state instead of example-org/app-example-store
    const result = renderDotFirestartrApp({
      org: 'example-org',
      inputs: baseInputs({
        org: 'example-org',
        app: 'example-store',
        service: { repo: 'store', release_type: 'node' },
      }),
      schemasDir: SCHEMAS_DIR,
      existingContent: fixture,
    });

    expect(result.outcome.kind).toBe('conflict');
    expect(result.content).toBeUndefined();
    if (result.outcome.kind === 'conflict') {
      expect(result.outcome.reason).toContain('example-org/store-state');
      expect(result.outcome.reason).toContain('example-org/app-example-store');
    }
  });

  it('returns conflict instead of throwing when merged file fails schema validation due to extra user field', () => {
    const existing = [
      'name: billing',
      'state_repo: acme/app-billing',
      'custom_extra: {deep: [1, 2]}',
      'services:',
      '  - repo: acme/billing-api',
      '    service_names: [a]',
      '',
    ].join('\n');

    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs({
        service: {
          repo: 'billing-api',
          release_type: 'node',
          service_names: ['a', 'b'],
        },
      }),
      schemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome.kind).toBe('conflict');
    expect(result.content).toBeUndefined();
    if (result.outcome.kind === 'conflict') {
      expect(result.outcome.reason).toContain('custom_extra');
    }
  });

  it('returns conflict when owned services or service_names node has wrong YAML type', () => {
    const servicesString = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs(),
      schemasDir: SCHEMAS_DIR,
      existingContent:
        'name: billing\nstate_repo: acme/app-billing\nservices: oops\n',
    });
    expect(servicesString.outcome.kind).toBe('conflict');
    expect(servicesString.content).toBeUndefined();
    if (servicesString.outcome.kind === 'conflict') {
      expect(servicesString.outcome.reason).toContain('services');
    }

    const namesString = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs({
        service: {
          repo: 'billing-api',
          release_type: 'node',
          service_names: ['a', 'b'],
        },
      }),
      schemasDir: SCHEMAS_DIR,
      existingContent:
        'name: billing\nstate_repo: acme/app-billing\nservices:\n  - repo: acme/billing-api\n    service_names: oops\n',
    });
    expect(namesString.outcome.kind).toBe('conflict');
    expect(namesString.content).toBeUndefined();
    if (namesString.outcome.kind === 'conflict') {
      expect(namesString.outcome.reason).toContain('service_names');
    }
  });

  it('preserves CRLF line endings when merging into a CRLF file', () => {
    const existing = [
      'name: billing',
      'state_repo: acme/app-billing',
      'services:',
      '  - repo: acme/other-svc',
      '    service_names: [other-svc]',
      '',
    ].join('\r\n');

    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs(),
      schemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome.kind).toBe('merge');
    expect(result.content).toContain('\r\n');
    expect(result.content).not.toMatch(/(?<!\r)\n/);
  });

  it('leaves output as LF when merging into a mixed-EOL file', () => {
    const existing =
      'name: billing\r\nstate_repo: acme/app-billing\nservices:\n  - repo: acme/other-svc\n    service_names: [other-svc]\n';

    const result = renderDotFirestartrApp({
      org: 'acme',
      inputs: baseInputs(),
      schemasDir: SCHEMAS_DIR,
      existingContent: existing,
    });

    expect(result.outcome.kind).toBe('merge');
    expect(result.content).not.toContain('\r\n');
  });
});
