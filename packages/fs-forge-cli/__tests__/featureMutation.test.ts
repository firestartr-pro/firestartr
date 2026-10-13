import { describe, expect, it } from '@jest/globals';
import { Errors } from '@oclif/core';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { claimsRepo } from '../src/claims/claimsRepo';
import { runFeatureMutation } from '../src/features/mutation';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { ClaimsRepo } from '../src/claims/claimsRepo';
import type {
  FeatureMutationRequest,
  FeatureMutationResult,
} from '../src/features/mutation';

const ROOT = process.cwd();
const SCHEMAS_DIR = join(ROOT, 'schemas');
const COMPONENT_YAML = readFileSync(
  join(ROOT, '__tests__', 'fixtures', 'valid', 'component.yaml'),
  'utf8',
);
const COMPONENT_WITH_FEATURES = readFileSync(
  join(ROOT, '__tests__', 'fixtures', 'valid', 'component-with-features.yaml'),
  'utf8',
);
const COMPONENT_WITH_NESTED_FEATURE_ARGS = readFileSync(
  join(
    ROOT,
    '__tests__',
    'fixtures',
    'valid',
    'component-with-nested-feature-args.yaml',
  ),
  'utf8',
);
const REQUIRED_ENABLED_SCHEMA = JSON.parse(
  readFileSync(
    join(
      ROOT,
      '__tests__',
      'fixtures',
      'feature-schemas',
      'required-enabled.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

function createRepo(claimYaml = COMPONENT_YAML) {
  const api = new MemoryGitHubApi();
  api.autoCompleteDispatches = true;
  const repo = claimsRepo(api, 'my-org');
  api.setDefaultBranch(repo.ref, 'main');
  api.setBranchHeadSha(repo.ref, 'main', 'base-sha');
  api.setFile(
    repo.ref,
    'claims-map.json',
    JSON.stringify({
      headers: { sha: 'map-sha' },
      claims: {
        'ComponentClaim-my-component': {
          filePath: 'components/my-component.yaml',
        },
      },
    }),
    'map-file-sha',
  );
  api.setFile(
    repo.ref,
    'claims/components/my-component.yaml',
    claimYaml,
    'claim-sha',
  );
  return { api, repo };
}

async function run(
  request: FeatureMutationRequest,
  repo?: ClaimsRepo,
): Promise<{
  result?: FeatureMutationResult;
  error?: Error;
  stdout: string;
}> {
  let result: FeatureMutationResult | undefined;
  const outcome = await captureOutput(async () => {
    result = await runFeatureMutation(request, {
      repo,
      schemasDir: SCHEMAS_DIR,
    });
    return 0;
  });
  return { result, error: outcome.error, stdout: outcome.stdout };
}

function featuresOf(claim: Record<string, unknown>): unknown {
  return (claim.providers as Record<string, unknown>).github;
}

describe('runFeatureMutation', () => {
  it('adds a Feature reference to a ComponentClaim', async () => {
    const { repo } = createRepo();

    const { result, error } = await run(
      {
        operation: 'add',
        component: 'my-component',
        json: false,
        feature: { name: 'feature_a', version: '1.0.0', args: {} },
      },
      repo,
    );

    expect(error).toBeUndefined();
    expect(featuresOf(result!.claim)).toEqual(
      expect.objectContaining({
        features: [{ name: 'feature_a', version: '1.0.0', args: {} }],
      }),
    );
    expect(result!.output).toContain('name: feature_a');
  });

  it('rejects a Feature that already exists', async () => {
    const { repo } = createRepo(COMPONENT_WITH_FEATURES);

    const { error } = await run(
      {
        operation: 'add',
        component: 'my-component',
        json: false,
        feature: { name: 'feature_a', version: '2.0.0', args: {} },
      },
      repo,
    );

    expect(error?.message).toContain('Feature already exists: feature_a');
  });

  it('preserves the pin when an edit changes neither --version nor --ref', async () => {
    const { repo } = createRepo(COMPONENT_WITH_FEATURES);

    const { result, error } = await run(
      {
        operation: 'edit',
        component: 'my-component',
        json: false,
        feature: { name: 'feature_a' },
      },
      repo,
    );

    expect(error).toBeUndefined();
    expect(featuresOf(result!.claim)).toEqual(
      expect.objectContaining({
        features: [
          { name: 'feature_a', version: '1.0.0', args: { enabled: true } },
          { name: 'other', ref: 'main', args: {} },
        ],
      }),
    );
  });

  it('merges nested Feature args over the stored reference', async () => {
    const { repo } = createRepo(COMPONENT_WITH_NESTED_FEATURE_ARGS);

    const { result, error } = await run(
      {
        operation: 'edit',
        component: 'my-component',
        json: false,
        feature: { name: 'feature_a', args: { config: { left: 3 } } },
      },
      repo,
    );

    expect(error).toBeUndefined();
    expect(featuresOf(result!.claim)).toEqual(
      expect.objectContaining({
        features: [
          {
            name: 'feature_a',
            version: '1.0.0',
            args: { config: { left: 3, right: 2 } },
          },
          { name: 'plain', version: '1.0.0' },
        ],
      }),
    );
  });

  it('leaves a Feature without args free of an empty args object on edit', async () => {
    const { repo } = createRepo(COMPONENT_WITH_NESTED_FEATURE_ARGS);

    const { result, error } = await run(
      {
        operation: 'edit',
        component: 'my-component',
        json: false,
        feature: { name: 'plain', version: '1.0.0' },
      },
      repo,
    );

    expect(error).toBeUndefined();
    expect(featuresOf(result!.claim)).toEqual(
      expect.objectContaining({
        features: [
          {
            name: 'feature_a',
            version: '1.0.0',
            args: { config: { left: 1, right: 2 } },
          },
          { name: 'plain', version: '1.0.0' },
        ],
      }),
    );
  });

  it('rejects an edit of a missing Feature', async () => {
    const { repo } = createRepo(COMPONENT_WITH_FEATURES);

    const { error } = await run(
      {
        operation: 'edit',
        component: 'my-component',
        json: false,
        feature: { name: 'nope' },
      },
      repo,
    );

    expect(error?.message).toContain('Feature not found: nope');
    expect((error as Errors.CLIError).oclif.exit).toBe(2);
  });

  it('removes a Feature reference', async () => {
    const { repo } = createRepo(COMPONENT_WITH_FEATURES);

    const { result, error } = await run(
      {
        operation: 'remove',
        component: 'my-component',
        json: false,
        feature: { name: 'other' },
      },
      repo,
    );

    expect(error).toBeUndefined();
    expect(featuresOf(result!.claim)).toEqual(
      expect.objectContaining({
        features: [
          { name: 'feature_a', version: '1.0.0', args: { enabled: true } },
        ],
      }),
    );
  });

  it('rejects removing a missing Feature', async () => {
    const { repo } = createRepo(COMPONENT_WITH_FEATURES);

    const { error } = await run(
      {
        operation: 'remove',
        component: 'my-component',
        json: false,
        feature: { name: 'nope' },
      },
      repo,
    );

    expect(error?.message).toContain('Feature not found: nope');
  });

  it('validates the merged Feature args when editing', async () => {
    const { repo } = createRepo(COMPONENT_WITH_FEATURES);

    const { result, error } = await run(
      {
        operation: 'edit',
        component: 'my-component',
        json: false,
        feature: { name: 'feature_a' },
        featureSchema: REQUIRED_ENABLED_SCHEMA,
      },
      repo,
    );

    expect(error).toBeUndefined();
    expect(featuresOf(result!.claim)).toEqual(
      expect.objectContaining({
        features: [
          { name: 'feature_a', version: '1.0.0', args: { enabled: true } },
          { name: 'other', ref: 'main', args: {} },
        ],
      }),
    );
  });

  it('rejects a merged Feature args result that fails the schema', async () => {
    const { repo } = createRepo(COMPONENT_WITH_FEATURES);

    const { error } = await run(
      {
        operation: 'edit',
        component: 'my-component',
        json: false,
        feature: { name: 'other' },
        featureSchema: REQUIRED_ENABLED_SCHEMA,
      },
      repo,
    );

    expect(error?.message).toContain('must have required property');
    expect(error?.message).toContain('enabled');
    expect((error as Errors.CLIError).oclif.exit).toBe(2);
  });

  it('rejects a mutated claim that fails the claim schema', async () => {
    const { repo } = createRepo('kind: ComponentClaim\nname: my-component\n');

    const { error } = await run(
      {
        operation: 'add',
        component: 'my-component',
        json: false,
        feature: { name: 'feature_a', version: '1.0.0', args: {} },
      },
      repo,
    );

    expect(error).toBeDefined();
    expect(error?.message).toContain('owner');
    expect((error as Errors.CLIError).oclif.exit).toBe(2);
  });

  it('publishes and waits when commit is requested', async () => {
    const { api, repo } = createRepo();

    const { result, error } = await run(
      {
        operation: 'add',
        component: 'my-component',
        json: false,
        commit: true,
        feature: { name: 'feature_a', version: '1.0.0', args: {} },
      },
      repo,
    );

    expect(error).toBeUndefined();
    expect(result!.publishUrl).toBe(
      'https://github.com/my-org/claims/actions/runs/1',
    );
    expect(api.committed[0]).toEqual(
      expect.objectContaining({
        path: 'claims/components/my-component.yaml',
        content: result!.output,
        sha: 'claim-sha',
      }),
    );
    expect(api.dispatched[0].inputs).toEqual(
      expect.objectContaining({ claimType: 'ComponentClaim' }),
    );
  });

  it('reports a failed provisioning run as a CLI error', async () => {
    const { api, repo } = createRepo();
    api.autoCompleteConclusion = 'failure';

    const { error } = await run(
      {
        operation: 'add',
        component: 'my-component',
        json: false,
        commit: true,
        feature: { name: 'feature_a', version: '1.0.0', args: {} },
      },
      repo,
    );

    expect(error).toBeDefined();
    expect((error as Errors.CLIError).oclif.exit).toBe(2);
  });

  it('publishes a --file target to its deterministic path with the current SHA', async () => {
    const { api, repo } = createRepo();
    api.setFile(
      repo.ref,
      'claims/components/my-component.yaml',
      'old content',
      'existing-sha',
    );

    const { result, error } = await run(
      {
        operation: 'add',
        file: join(ROOT, '__tests__', 'fixtures', 'valid', 'component.yaml'),
        json: false,
        commit: true,
        feature: { name: 'feature_a', version: '1.0.0', args: {} },
      },
      repo,
    );

    expect(error).toBeUndefined();
    expect(result!.publishUrl).toBeDefined();
    expect(api.committed[0]).toEqual(
      expect.objectContaining({
        path: 'claims/components/my-component.yaml',
        sha: 'existing-sha',
      }),
    );
    expect(api.calls).toContain(
      'readFile my-org/claims:claims/components/my-component.yaml@main',
    );
  });
});
