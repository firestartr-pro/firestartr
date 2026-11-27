import { describe, expect, it } from '@jest/globals';
import YAML from 'yaml';

import { renderServiceClaimFeatures } from '../src/app/render/serviceClaim.js';
import { validateFeatureArgs } from '../src/utils/featureSchema.js';

import type { AppInputs } from '../src/schema/appInputs.js';

const BUILD_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    auth_strategy: { type: 'string', enum: ['oidc', 'static'] },
    trigger_filter_by_env_snapshot: { type: 'string' },
    trigger_filter_by_env_pre_releases: { type: 'string' },
    trigger_filter_by_env_releases: { type: 'string' },
    custom_arg: { type: 'string' },
  },
  required: ['auth_strategy'],
  additionalProperties: false,
};

const RELEASE_PLEASE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    release_type: { type: 'string', enum: ['node', 'python', 'simple'] },
  },
  required: ['release_type'],
  additionalProperties: false,
};

const DEFAULT_FILTERS = {
  snapshot: 'dev',
  preReleases: 'pre',
  releases: 'pro',
};

const FEATURE_MAJORS = {
  build_and_dispatch_docker_images: 7,
  release_please: 2,
};

const FEATURE_SCHEMAS = {
  build_and_dispatch_docker_images: BUILD_SCHEMA,
  release_please: RELEASE_PLEASE_SCHEMA,
};

const BASE_SERVICE_CLAIM = [
  '# Service claim comment',
  'kind: ComponentClaim',
  'version: "1.0"',
  'name: billing-api',
  'owner: group:default/platform',
  'type: service',
  'lifecycle: production',
  'providers:',
  '  github:',
  '    name: billing-api',
  '    org: acme',
  '',
].join('\n');

function makeInputs(targets: AppInputs['targets']): AppInputs {
  return {
    app: 'billing',
    service: {
      repo: 'acme/billing-api',
      release_type: 'node',
    },
    targets,
    chart: {
      name: 'web-app',
      version: '1.0.0',
      registry: 'ecr-main',
    },
  };
}

describe('renderServiceClaimFeatures', () => {
  it('adds both features with only derived args when missing (omitting default filters)', () => {
    const inputs = makeInputs([
      {
        platform: 'eks',
        tenant: 'core',
        env: 'dev',
        cluster_url: 'https://eks.example.com',
        track: 'snapshots',
      },
      {
        platform: 'eks',
        tenant: 'core',
        env: 'pre',
        cluster_url: 'https://eks.example.com',
        track: 'pre-releases',
      },
      {
        platform: 'eks',
        tenant: 'core',
        env: 'pro',
        cluster_url: 'https://eks.example.com',
        track: 'releases',
      },
    ]);

    const result = renderServiceClaimFeatures({
      org: 'acme',
      inputs,
      existingContent: BASE_SERVICE_CLAIM,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(result.path).toBe('claims/components/billing-api.yaml');
    expect(result.outcome).toEqual({
      kind: 'merge',
      added: [
        'feature:build_and_dispatch_docker_images',
        'feature:release_please',
      ],
    });
    expect(result.content).toContain('# Service claim comment');

    const parsed = YAML.parse(result.content!) as {
      providers: {
        github: {
          features: Array<{
            name: string;
            ref: string;
            args: Record<string, unknown>;
          }>;
        };
      };
    };
    expect(parsed.providers.github.features).toEqual([
      {
        name: 'build_and_dispatch_docker_images',
        ref: 'build_and_dispatch_docker_images-v7',
        args: {
          auth_strategy: 'oidc',
        },
      },
      {
        name: 'release_please',
        ref: 'release_please-v2',
        args: {
          release_type: 'node',
        },
      },
    ]);
    expect(
      validateFeatureArgs(
        BUILD_SCHEMA,
        parsed.providers.github.features[0].args,
      ),
    ).toEqual({ valid: true, errors: [] });
    expect(
      validateFeatureArgs(
        RELEASE_PLEASE_SCHEMA,
        parsed.providers.github.features[1].args,
      ),
    ).toEqual({ valid: true, errors: [] });

    // Idempotent on its own output
    const second = renderServiceClaimFeatures({
      org: 'acme',
      inputs,
      existingContent: result.content!,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });
    expect(second.outcome).toEqual({ kind: 'noop' });
    expect(second.content).toBe(result.content);
  });

  it('writes trigger_filter_by_env_* only when the result differs from the feature default', () => {
    const inputs = makeInputs([
      {
        platform: 'eks',
        tenant: 'core',
        env: 'qa',
        cluster_url: 'https://eks.example.com',
        track: 'snapshots',
      },
      {
        platform: 'eks',
        tenant: 'core',
        env: 'staging',
        cluster_url: 'https://eks.example.com',
        track: 'pre-releases',
      },
      {
        platform: 'eks',
        tenant: 'core',
        env: 'pro',
        cluster_url: 'https://eks.example.com',
        track: 'releases',
      },
    ]);

    const result = renderServiceClaimFeatures({
      org: 'acme',
      inputs,
      existingContent: BASE_SERVICE_CLAIM,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(result.outcome.kind).toBe('merge');
    const parsed = YAML.parse(result.content!) as {
      providers: {
        github: { features: Array<{ name: string; args?: Record<string, unknown> }> };
      };
    };
    const build = parsed.providers.github.features.find(
      (f) => f.name === 'build_and_dispatch_docker_images',
    );
    expect(build?.args).toEqual({
      auth_strategy: 'oidc',
      trigger_filter_by_env_snapshot: 'dev,qa',
      trigger_filter_by_env_pre_releases: 'pre,staging',
    });
  });

  it('merges filter args on same major while keeping other user args', () => {
    const existing = [
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: billing-api',
      'providers:',
      '  github:',
      '    name: billing-api',
      '    features:',
      '      - name: build_and_dispatch_docker_images',
      '        version: "7.2.0"',
      '        args:',
      '          auth_strategy: oidc',
      '          custom_arg: keep-me',
      '          trigger_filter_by_env_snapshot: dev, int',
      '      - name: release_please',
      '        ref: release_please-v2',
      '        args:',
      '          release_type: python',
      '',
    ].join('\n');

    const result = renderServiceClaimFeatures({
      org: 'acme',
      inputs: makeInputs([
        {
          platform: 'eks',
          tenant: 'core',
          env: 'qa',
          cluster_url: 'https://eks.example.com',
          track: 'snapshots',
        },
      ]),
      existingContent: existing,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(result.outcome).toEqual({
      kind: 'merge',
      added: ['arg:build_and_dispatch_docker_images.trigger_filter_by_env_snapshot'],
    });
    const parsed = YAML.parse(result.content!) as {
      providers: {
        github: { features: Array<{ name: string; args?: Record<string, unknown> }> };
      };
    };
    const build = parsed.providers.github.features[0];
    expect(build.args).toEqual({
      auth_strategy: 'oidc',
      custom_arg: 'keep-me',
      trigger_filter_by_env_snapshot: 'dev,int,qa',
    });
    // release_please args untouched
    expect(parsed.providers.github.features[1].args).toEqual({
      release_type: 'python',
    });
  });

  it('conflicts when auth_strategy differs on same major', () => {
    const existing = [
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: billing-api',
      'providers:',
      '  github:',
      '    name: billing-api',
      '    features:',
      '      - name: build_and_dispatch_docker_images',
      '        ref: build_and_dispatch_docker_images-v7',
      '        args:',
      '          auth_strategy: static',
      '      - name: release_please',
      '        ref: release_please-v2',
      '',
    ].join('\n');

    const result = renderServiceClaimFeatures({
      org: 'acme',
      inputs: makeInputs([
        {
          platform: 'eks',
          tenant: 'core',
          env: 'dev',
          cluster_url: 'https://eks.example.com',
          track: 'snapshots',
        },
      ]),
      existingContent: existing,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(result.outcome.kind).toBe('conflict');
    expect(result.content).toBeUndefined();
  });

  it('conflicts when target env is already in another track filter', () => {
    const result = renderServiceClaimFeatures({
      org: 'acme',
      inputs: makeInputs([
        {
          platform: 'eks',
          tenant: 'core',
          env: 'pro',
          cluster_url: 'https://eks.example.com',
          track: 'snapshots',
        },
      ]),
      existingContent: BASE_SERVICE_CLAIM,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(result.outcome.kind).toBe('conflict');
    expect(result.content).toBeUndefined();
    if (result.outcome.kind === 'conflict') {
      expect(result.outcome.reason).toContain('trigger_filter_by_env_releases');
    }
  });

  it('leaves own track wildcard "*" unchanged without appending', () => {
    const existing = [
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: billing-api',
      'providers:',
      '  github:',
      '    name: billing-api',
      '    features:',
      '      - name: build_and_dispatch_docker_images',
      '        ref: build_and_dispatch_docker_images-v7',
      '        args:',
      '          auth_strategy: oidc',
      '          trigger_filter_by_env_snapshot: "*"',
      '      - name: release_please',
      '        ref: release_please-v2',
      '',
    ].join('\n');

    const result = renderServiceClaimFeatures({
      org: 'acme',
      inputs: makeInputs([
        {
          platform: 'eks',
          tenant: 'core',
          env: 'qa',
          cluster_url: 'https://eks.example.com',
          track: 'snapshots',
        },
      ]),
      existingContent: existing,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(result.outcome).toEqual({ kind: 'noop' });
    expect(result.content).toBe(existing);
  });

  it('treats comma list holding "*" on own track as wildcard (unchanged)', () => {
    const existing = [
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: billing-api',
      'providers:',
      '  github:',
      '    name: billing-api',
      '    features:',
      '      - name: build_and_dispatch_docker_images',
      '        ref: build_and_dispatch_docker_images-v7',
      '        args:',
      '          auth_strategy: oidc',
      '          trigger_filter_by_env_snapshot: "dev, *"',
      '      - name: release_please',
      '        ref: release_please-v2',
      '',
    ].join('\n');

    const result = renderServiceClaimFeatures({
      org: 'acme',
      inputs: makeInputs([
        {
          platform: 'eks',
          tenant: 'core',
          env: 'qa',
          cluster_url: 'https://eks.example.com',
          track: 'snapshots',
        },
      ]),
      existingContent: existing,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(result.outcome).toEqual({ kind: 'noop' });
    expect(result.content).toBe(existing);
  });

  it('conflicts when another track filter is "*" or a comma list holding "*"', () => {
    for (const filterValue of ['*', 'pro, *']) {
      const existing = [
        'kind: ComponentClaim',
        'version: "1.0"',
        'name: billing-api',
        'providers:',
        '  github:',
        '    name: billing-api',
        '    features:',
        '      - name: build_and_dispatch_docker_images',
        '        ref: build_and_dispatch_docker_images-v7',
        '        args:',
        '          auth_strategy: oidc',
        `          trigger_filter_by_env_releases: "${filterValue}"`,
        '      - name: release_please',
        '        ref: release_please-v2',
        '',
      ].join('\n');

      const result = renderServiceClaimFeatures({
        org: 'acme',
        inputs: makeInputs([
          {
            platform: 'eks',
            tenant: 'core',
            env: 'qa',
            cluster_url: 'https://eks.example.com',
            track: 'snapshots',
          },
        ]),
        existingContent: existing,
        authStrategy: 'oidc',
        featureMajors: FEATURE_MAJORS,
        featureSchemas: FEATURE_SCHEMAS,
        defaultFilters: DEFAULT_FILTERS,
      });

      expect(result.outcome.kind).toBe('conflict');
      expect(result.content).toBeUndefined();
      if (result.outcome.kind === 'conflict') {
        expect(result.outcome.reason).toContain('trigger_filter_by_env_releases');
        expect(result.outcome.reason).toContain('*');
      }
    }
  });

  it('leaves older major unchanged and warns with manual filter edit when target env is outside filters', () => {
    const existing = [
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: billing-api',
      'providers:',
      '  github:',
      '    name: billing-api',
      '    features:',
      '      - name: build_and_dispatch_docker_images',
      '        ref: build_and_dispatch_docker_images-v6',
      '        args:',
      '          auth_strategy: oidc',
      '      - name: release_please',
      '        ref: release_please-v1',
      '',
    ].join('\n');

    const result = renderServiceClaimFeatures({
      org: 'acme',
      inputs: makeInputs([
        {
          platform: 'eks',
          tenant: 'core',
          env: 'qa',
          cluster_url: 'https://eks.example.com',
          track: 'snapshots',
        },
      ]),
      existingContent: existing,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(result.outcome).toEqual({ kind: 'noop' });
    expect(result.content).toBe(existing);
    expect(result.notes).toBeDefined();
    expect(result.notes!.some((n) => n.includes('build_and_dispatch_docker_images-v6'))).toBe(true);
    expect(result.notes!.some((n) => n.includes('trigger_filter_by_env_snapshot') && n.includes('qa'))).toBe(true);
    expect(result.notes!.some((n) => n.includes('release_please-v1'))).toBe(true);
  });

  it('conflicts when an owned node has the wrong type', () => {
    const existing = [
      'kind: ComponentClaim',
      'version: "1.0"',
      'name: billing-api',
      'providers:',
      '  github:',
      '    features:',
      '      - name: build_and_dispatch_docker_images',
      '        ref: build_and_dispatch_docker_images-v7',
      '        args: not-a-map',
      '',
    ].join('\n');

    const result = renderServiceClaimFeatures({
      org: 'acme',
      inputs: makeInputs([
        {
          platform: 'eks',
          tenant: 'core',
          env: 'dev',
          cluster_url: 'https://eks.example.com',
          track: 'snapshots',
        },
      ]),
      existingContent: existing,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(result.outcome.kind).toBe('conflict');
    expect(result.content).toBeUndefined();
  });

  it('preserves CRLF line endings on merge', () => {
    const existing = BASE_SERVICE_CLAIM.replace(/\n/g, '\r\n');
    const result = renderServiceClaimFeatures({
      org: 'acme',
      inputs: makeInputs([
        {
          platform: 'eks',
          tenant: 'core',
          env: 'dev',
          cluster_url: 'https://eks.example.com',
          track: 'snapshots',
        },
      ]),
      existingContent: existing,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(result.outcome.kind).toBe('merge');
    expect(result.content).toContain('\r\n');
    expect(result.content).not.toMatch(/(?<!\r)\n/);
  });

  it('conflicts when build_and_dispatch_docker_images or release_please is listed more than once', () => {
    const dupBuild = [
      BASE_SERVICE_CLAIM.trimEnd(),
      '    features:',
      '      - name: build_and_dispatch_docker_images',
      '        ref: build_and_dispatch_docker_images-v7',
      '        args:',
      '          auth_strategy: oidc',
      '      - name: build_and_dispatch_docker_images',
      '        ref: build_and_dispatch_docker_images-v7',
      '        args:',
      '          auth_strategy: oidc',
      '',
    ].join('\n');

    const buildRes = renderServiceClaimFeatures({
      org: 'acme',
      inputs: makeInputs([
        {
          platform: 'eks',
          tenant: 'core',
          env: 'qa',
          cluster_url: 'https://eks.example.com',
          track: 'snapshots',
        },
      ]),
      existingContent: dupBuild,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(buildRes.outcome.kind).toBe('conflict');
    expect(buildRes.content).toBeUndefined();
    if (buildRes.outcome.kind === 'conflict') {
      expect(buildRes.outcome.reason).toContain('build_and_dispatch_docker_images');
      expect(buildRes.outcome.reason).toContain('2 times');
    }

    const dupRelease = [
      BASE_SERVICE_CLAIM.trimEnd(),
      '    features:',
      '      - name: release_please',
      '        ref: release_please-v2',
      '        args:',
      '          release_type: node',
      '      - name: release_please',
      '        ref: release_please-v2',
      '        args:',
      '          release_type: node',
      '      - name: release_please',
      '        ref: release_please-v2',
      '        args:',
      '          release_type: node',
      '',
    ].join('\n');

    const releaseRes = renderServiceClaimFeatures({
      org: 'acme',
      inputs: makeInputs([
        {
          platform: 'eks',
          tenant: 'core',
          env: 'dev',
          cluster_url: 'https://eks.example.com',
          track: 'snapshots',
        },
      ]),
      existingContent: dupRelease,
      authStrategy: 'oidc',
      featureMajors: FEATURE_MAJORS,
      featureSchemas: FEATURE_SCHEMAS,
      defaultFilters: DEFAULT_FILTERS,
    });

    expect(releaseRes.outcome.kind).toBe('conflict');
    expect(releaseRes.content).toBeUndefined();
    if (releaseRes.outcome.kind === 'conflict') {
      expect(releaseRes.outcome.reason).toContain('release_please');
      expect(releaseRes.outcome.reason).toContain('3 times');
    }
  });
});
