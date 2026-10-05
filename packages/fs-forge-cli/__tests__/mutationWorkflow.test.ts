import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { createGitHubApi } from '../src/github/index';
import { claimsRepo } from '../src/claims/claimsRepo';
import { applyClaimDefaults } from '../src/defaults/applier';
import { registerValidator } from '../src/utils/ajvValidation';
import {
  runClaimCreation,
  runClaimMutation,
} from '../src/mutations/orchestrator';
import { formatUnifiedDiff } from '../src/utils/mutateClaim';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type {
  ClaimMutationOptions,
  ClaimMutationResult,
} from '../src/mutations/orchestrator';

const ROOT = process.cwd();
const emptyPresentation = {} as const;
const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;

const COMPONENT_YAML = readFileSync(
  join(ROOT, '__tests__', 'fixtures', 'valid', 'component.yaml'),
  'utf8',
);

function loadSchema(kind: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(ROOT, 'schemas', `${kind}.json`), 'utf8'),
  );
}

function createRepo(options: { existingReference?: string } = {}) {
  const api = new MemoryGitHubApi();
  api.autoCompleteDispatches = true;
  const repo = claimsRepo(api, 'example');
  api.setDefaultBranch(repo.ref, 'main');
  api.setBranchHeadSha(repo.ref, 'main', 'base-sha');
  api.setFile(
    repo.ref,
    'claims-map.json',
    JSON.stringify({
      headers: { sha: 'map-sha' },
      claims: options.existingReference
        ? {
            [options.existingReference]: {
              filePath: 'components/new-component.yaml',
            },
          }
        : {
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
    COMPONENT_YAML,
    'claim-sha',
  );
  api.setFile(
    repo.ref,
    'claims/components/new-component.yaml',
    COMPONENT_YAML,
    'claim-sha',
  );
  MockCreateGitHubApi.mockReturnValue(api);
  return { api, repo };
}

beforeAll(() => {
  registerValidator('ComponentClaim', loadSchema('ComponentClaim'));
});

beforeEach(() => {
  MockCreateGitHubApi.mockClear();
});

describe('runClaimCreation', () => {
  const claim = {
    kind: 'ComponentClaim',
    name: 'new-component',
    owner: 'group:platform',
  };

  const CREATE_COMMIT_CASES = [
    {
      kind: 'ComponentClaim',
      path: undefined,
      expectedPath: 'claims/components/new-claim.yaml',
    },
    {
      kind: 'DomainClaim',
      path: undefined,
      expectedPath: 'claims/domains/new-claim.yaml',
    },
    {
      kind: 'GroupClaim',
      path: undefined,
      expectedPath: 'claims/groups/new-claim.yaml',
    },
    {
      kind: 'OrgWebhookClaim',
      path: undefined,
      expectedPath: 'claims/orgWebhook/new-claim.yaml',
    },
    {
      kind: 'SecretsClaim',
      path: 'claims/secrets/new-claim.yaml',
      expectedPath: 'claims/secrets/new-claim.yaml',
    },
    {
      kind: 'SystemClaim',
      path: undefined,
      expectedPath: 'claims/systems/new-claim.yaml',
    },
    {
      kind: 'TFWorkspaceClaim',
      path: 'claims/workspaces/new-claim.yaml',
      expectedPath: 'claims/workspaces/new-claim.yaml',
    },
    {
      kind: 'UserClaim',
      path: undefined,
      expectedPath: 'claims/users/new-claim.yaml',
    },
    {
      kind: 'ArgoDeployClaim',
      path: undefined,
      expectedPath: 'claims/argocd/new-claim.yaml',
    },
  ] as const;

  it('keeps claim creation offline unless commit is requested', async () => {
    const { api } = createRepo();

    const result = await runClaimCreation({
      kind: 'ComponentClaim',
      name: 'new-component',
      claim,
      writeOutput: jest.fn(),
      writeDiagnostic: jest.fn(),
    });

    expect(YAML.parse(result.output)).toEqual(claim);
    expect(MockCreateGitHubApi).not.toHaveBeenCalled();
    expect(api.calls).toEqual([]);
  });

  it('publishes a new claim to its deterministic path', async () => {
    const { api } = createRepo();

    const result = await runClaimCreation({
      org: 'example',
      kind: 'ComponentClaim',
      name: 'new-component',
      claim,
      commit: true,
      writeOutput: jest.fn(),
      writeDiagnostic: jest.fn(),
    });

    expect(MockCreateGitHubApi).toHaveBeenCalledTimes(1);
    expect(result.publishUrl).toBe(
      'https://github.com/example/claims/actions/runs/1',
    );
    expect(api.committed[0]).toEqual(
      expect.objectContaining({
        path: 'claims/components/new-component.yaml',
        content: result.output,
      }),
    );
    expect(api.dispatched[0].inputs).toEqual(
      expect.objectContaining({ claimType: 'ComponentClaim' }),
    );
  });

  it('rejects an existing claim before publishing', async () => {
    const { api } = createRepo({
      existingReference: 'ComponentClaim-new-component',
    });

    await expect(
      runClaimCreation({
        org: 'example',
        kind: 'ComponentClaim',
        name: 'new-component',
        claim,
        commit: true,
        writeOutput: jest.fn(),
        writeDiagnostic: jest.fn(),
      }),
    ).rejects.toThrow('Claim already exists: ComponentClaim-new-component');
    expect(api.committed).toEqual([]);
    expect(api.dispatched).toEqual([]);
  });

  describe.each(CREATE_COMMIT_CASES)(
    'create --commit for $kind',
    ({ kind, path, expectedPath }) => {
      it('publishes a new claim to its deterministic path', async () => {
        const { api } = createRepo();

        const result = await runClaimCreation({
          org: 'example',
          kind,
          name: 'new-claim',
          claim: { kind, name: 'new-claim' },
          commit: true,
          path,
          writeOutput: jest.fn(),
          writeDiagnostic: jest.fn(),
        });

        expect(result.publishUrl).toBe(
          'https://github.com/example/claims/actions/runs/1',
        );
        expect(api.committed[0]).toEqual(
          expect.objectContaining({ path: expectedPath, content: result.output }),
        );
      });

      it('rejects an existing claim before publishing', async () => {
        const { api } = createRepo({ existingReference: `${kind}-new-claim` });

        await expect(
          runClaimCreation({
            org: 'example',
            kind,
            name: 'new-claim',
            claim: { kind, name: 'new-claim' },
            commit: true,
            path,
            writeOutput: jest.fn(),
            writeDiagnostic: jest.fn(),
          }),
        ).rejects.toThrow(`Claim already exists: ${kind}-new-claim`);
        expect(api.committed).toEqual([]);
      });
    },
  );
});

async function runSilently(
  options: ClaimMutationOptions,
): Promise<ClaimMutationResult> {
  let result: ClaimMutationResult | undefined;
  const presented = await captureOutput(async () => {
    result = await runClaimMutation(options);
    return 0;
  });
  if (presented.error) throw presented.error;
  return result as ClaimMutationResult;
}

describe('formatUnifiedDiff', () => {
  it('compares the YAML representation used for the rendered diff', () => {
    expect(formatUnifiedDiff({ value: Number.NaN }, { value: null })).toBe(
      '- value: .nan\n+ value: null',
    );
  });

  it('falls back without allocating a quadratic matrix for large changes', () => {
    const length = 1_001;
    const before = {
      items: Array.from({ length }, (_, index) =>
        index === 500 ? 'shared' : `before-${index}`,
      ),
    };
    const after = {
      items: Array.from({ length }, (_, index) =>
        index === 500 ? 'shared' : `after-${index}`,
      ),
    };

    const rendered = formatUnifiedDiff(before, after);

    expect(rendered).toContain('-   - shared');
    expect(rendered).toContain('+   - shared');
  });
});

describe('runClaimMutation', () => {
  it('presents an edit result as Claim YAML and diagnostics', async () => {
    const { api, repo } = createRepo();
    const transform = jest.fn((claim: Record<string, unknown>) => claim);
    let result: ClaimMutationResult | undefined;

    const presented = await captureOutput(async () => {
      result = await runClaimMutation({
        repo,
        root: ROOT,
        kind: 'ComponentClaim',
        sourceName: 'my-component',
        flags: { 'providers.github.visibility': 'public' },
        transform,
        presentation: {
          diff: true,
        },
      });
      return 0;
    });

    expect(transform).toHaveBeenCalledTimes(1);
    expect(result?.validation).toEqual({ valid: true, errors: [] });
    expect(YAML.parse(presented.stdout)).toMatchObject({
      name: 'my-component',
      providers: { github: { visibility: 'public' } },
    });
    expect(presented.stderr).toContain('-     visibility: private');
    expect(presented.stderr).toContain('+     visibility: public');
    expect(result?.diff).toEqual([
      {
        path: 'providers.github.visibility',
        before: 'private',
        after: 'public',
      },
    ]);
    expect(api.committed).toEqual([]);
  });

  it('presents output before publishing and reports the workflow URL', async () => {
    const { api, repo } = createRepo();
    const events: string[] = [];
    let report = '';
    const stdout = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => {
        events.push('output');
        return true;
      });
    const stderr = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk) => {
        events.push('report');
        report += String(chunk);
        return true;
      });
    const commitFile = api.commitFile.bind(api);
    api.commitFile = async (...args) => {
      events.push('publish');
      return commitFile(...args);
    };

    const result = await runClaimMutation({
      repo,
      root: ROOT,
      kind: 'ComponentClaim',
      sourceName: 'my-component',
      flags: { 'providers.github.visibility': 'public' },
      commit: true,
      presentation: {},
    });
    stdout.mockRestore();
    stderr.mockRestore();

    expect(result.validation.valid).toBe(true);
    expect(result.publishUrl).toBe(
      'https://github.com/example/claims/actions/runs/1',
    );
    expect(events).toEqual(['output', 'publish', 'report', 'output']);
    expect(report).toContain('Provisioning...');
    expect(YAML.parse(result.output)).toMatchObject({
      name: 'my-component',
    });
    expect(api.committed[0]).toEqual(
      expect.objectContaining({
        path: 'claims/components/my-component.yaml',
        content: result.output,
        sha: 'claim-sha',
      }),
    );
  });

  it('presents provenance and does not publish an invalid mutation', async () => {
    const { api, repo } = createRepo();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        repo,
        root: ROOT,
        kind: 'ComponentClaim',
        sourceName: 'my-component',
        flags: { 'providers.github.visibility': 'invalid' },
        commit: true,
        defaults: (claim) =>
          Promise.resolve(
            applyClaimDefaults(claim, {
              ComponentClaim: { platformOwner: 'group:default' },
            }),
          ),
        presentation: {
          showDefaults: true,
        },
      });
      return 0;
    });

    expect(presented.error?.message).toContain('providers/github/visibility');
    expect(presented.stdout).toBe('');
    expect(presented.stderr).toContain('-     visibility: private');
    expect(presented.stderr).toContain('+     visibility: invalid');
    expect(presented.stderr).toContain('+ platformOwner: group:default');
    expect(api.committed).toEqual([]);
  });

  it('presents invalid text changes without exposing defaults by default', async () => {
    const { repo } = createRepo();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        repo,
        root: ROOT,
        kind: 'ComponentClaim',
        sourceName: 'my-component',
        flags: { 'providers.github.visibility': 'invalid' },
        presentation: emptyPresentation,
        defaults: (claim) =>
          Promise.resolve(
            applyClaimDefaults(claim, {
              ComponentClaim: { platformOwner: 'group:default' },
            }),
          ),
      });
      return 0;
    });

    expect(presented.error).toBeDefined();
    expect(presented.stderr).toContain('-     visibility: private');
    expect(presented.stderr).toContain('+     visibility: invalid');
    expect(presented.stderr).not.toContain('platformOwner');
  });

  it('presents an invalid mutation diff as flat JSON without defaults visibility', async () => {
    const { repo } = createRepo();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        repo,
        root: ROOT,
        kind: 'ComponentClaim',
        sourceName: 'my-component',
        flags: { owner: 'group:new-owner' },
        transform: (claim) => ({
          ...claim,
          providers: { github: { visibility: 'invalid' } },
        }),
        presentation: {
          diff: true,
          json: true,
        },
        defaults: async (claim) => claim,
      });
      return 0;
    });

    expect(presented.error).toBeDefined();
    expect(JSON.parse(presented.stderr)).toEqual(
      expect.arrayContaining([
        { path: 'owner', before: 'group:my-team', after: 'group:new-owner' },
        {
          path: 'providers.github.visibility',
          before: 'private',
          after: 'invalid',
        },
      ]),
    );
  });

  it('presents invalid explicit and defaulted changes separately in JSON', async () => {
    const { repo } = createRepo();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        repo,
        root: ROOT,
        kind: 'ComponentClaim',
        sourceName: 'my-component',
        flags: { 'providers.github.visibility': 'invalid' },
        presentation: {
          json: true,
          showDefaults: true,
        },
        defaults: (claim) =>
          Promise.resolve(
            applyClaimDefaults(claim, {
              ComponentClaim: { platformOwner: 'group:default' },
            }),
          ),
      });
      return 0;
    });

    expect(presented.error).toBeDefined();
    expect(JSON.parse(presented.stderr)).toEqual({
      changes: [
        {
          path: 'providers.github.visibility',
          before: 'private',
          after: 'invalid',
        },
      ],
      defaults: { platformOwner: 'group:default' },
    });
  });

  it('reports no explicit changes and no defaults when both are empty', async () => {
    const { repo } = createRepo();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        repo,
        root: ROOT,
        kind: 'ComponentClaim',
        sourceName: 'my-component',
        flags: {},
        presentation: {
          showDefaults: true,
        },
        defaults: async (claim) => claim,
      });
      return 0;
    });

    expect(presented.error).toBeUndefined();
    expect(presented.stderr).toBe('No changes\n');
    expect(YAML.parse(presented.stdout)).toMatchObject({
      kind: 'ComponentClaim',
      name: 'my-component',
    });
  });

  it('rejects unsupported JSON flags before loading the Claim', async () => {
    const { api, repo } = createRepo();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        repo,
        root: ROOT,
        kind: 'ComponentClaim',
        sourceName: 'my-component',
        flags: {},
        presentation: { json: true },
      });
      return 0;
    });

    expect(presented.error?.message).toBe(
      '--json requires --diff or --show-defaults',
    );
    expect(api.calls).toEqual([]);
  });

  it('applies defaults after user overrides and validates the defaulted document', async () => {
    const { api, repo } = createRepo();

    const result = await runSilently({
      repo,
      root: ROOT,
      kind: 'ComponentClaim',
      sourceName: 'my-component',
      flags: { 'providers.github.visibility': 'public' },
      presentation: emptyPresentation,
      defaults: (claim) =>
        Promise.resolve(
          applyClaimDefaults(claim, {
            ComponentClaim: {
              platformOwner: 'group:firestartr-test-platform-team',
              providers: {
                github: { technology: { stack: 'node', version: '14' } },
              },
            },
          }),
        ),
    });

    expect(result.validation).toEqual({ valid: true, errors: [] });
    expect(YAML.parse(result.output)).toMatchObject({
      platformOwner: 'group:firestartr-test-platform-team',
      providers: {
        github: {
          visibility: 'public',
          technology: { stack: 'node', version: '14' },
        },
      },
    });
    // User diff stays clean: defaults never leak into it
    expect(result.diff).toEqual([
      {
        path: 'providers.github.visibility',
        before: 'private',
        after: 'public',
      },
    ]);
    expect(result.defaultsDiff).toEqual(
      expect.arrayContaining([
        {
          path: 'platformOwner',
          before: undefined,
          after: 'group:firestartr-test-platform-team',
        },
        {
          path: 'providers.github.technology',
          before: undefined,
          after: { stack: 'node', version: '14' },
        },
      ]),
    );
    expect(result.defaultsDiff).toHaveLength(2);
    expect(api.committed).toEqual([]);
  });

  it('skips defaults when the defaults hook leaves the claim unchanged', async () => {
    const { repo } = createRepo();

    const result = await runSilently({
      repo,
      root: ROOT,
      kind: 'ComponentClaim',
      sourceName: 'my-component',
      flags: { 'providers.github.visibility': 'public' },
      presentation: emptyPresentation,
      defaults: async (claim) => claim,
    });

    expect(result.defaultsDiff).toEqual([]);
    expect(result.diff).toEqual([
      {
        path: 'providers.github.visibility',
        before: 'private',
        after: 'public',
      },
    ]);
  });

  it('keeps transform changes out of the defaults diff', async () => {
    const { repo } = createRepo();

    const result = await runSilently({
      repo,
      root: ROOT,
      kind: 'ComponentClaim',
      sourceName: 'my-component',
      flags: { 'providers.github.visibility': 'public' },
      presentation: emptyPresentation,
      transform: (claim) => ({ ...claim, description: 'touched' }),
      defaults: async (claim) =>
        applyClaimDefaults(claim, {
          ComponentClaim: { platformOwner: 'group:default' },
        }),
    });

    expect(result.diff).toEqual(
      expect.arrayContaining([
        {
          path: 'providers.github.visibility',
          before: 'private',
          after: 'public',
        },
        { path: 'description', before: undefined, after: 'touched' },
      ]),
    );
    expect(result.defaultsDiff).toEqual([
      { path: 'platformOwner', before: undefined, after: 'group:default' },
    ]);
  });

  it('fails hard when the defaults hook errors', async () => {
    const { repo } = createRepo();

    await expect(
      runClaimMutation({
        repo,
        root: ROOT,
        kind: 'ComponentClaim',
        sourceName: 'my-component',
        flags: {},
        presentation: emptyPresentation,
        defaults: async () => {
          throw new Error('GitHub API exploded');
        },
      }),
    ).rejects.toThrow('GitHub API exploded');
  });
});
