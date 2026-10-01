import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

jest.mock('../src/claims/client', () => ({
  ClaimsClient: jest.fn(),
}));

import { ClaimsClient } from '../src/claims/client';
import { applyClaimDefaults } from '../src/defaults/applier';
import { registerValidator } from '../src/utils/ajvValidation';
import {
  runClaimCreation,
  runClaimMutation,
} from '../src/mutations/orchestrator';
import { formatUnifiedDiff } from '../src/utils/mutateClaim';

import type {
  ClaimMutationOptions,
  ClaimMutationResult,
} from '../src/mutations/orchestrator';

const ROOT = process.cwd();
const emptyPresentation = {} as const;
const MockClaimsClient = ClaimsClient as unknown as jest.Mock;

function loadSchema(kind: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(ROOT, 'schemas', `${kind}.json`), 'utf8'),
  );
}

function createClient() {
  const publishClaim = jest.fn(async () => ({
    url: 'workflow-url',
    correlationId: 'corr-1',
    workflowId: 'provision-claim.yaml',
    branch: 'fs-forge/ComponentClaim-example',
  }));
  const getFile = jest.fn(async (path: string) => {
    if (path === 'claims-map.json') {
      return {
        content: JSON.stringify({
          headers: { sha: 'map-sha' },
          claims: {
            'ComponentClaim-my-component': {
              filePath: 'components/my-component.yaml',
            },
          },
        }),
        path,
        sha: 'map-file-sha',
      };
    }
    return {
      content: readFileSync(
        join(ROOT, '__tests__', 'fixtures', 'valid', 'component.yaml'),
        'utf8',
      ),
      path,
      sha: 'claim-sha',
    };
  });
  const client = {
    hasInFlightClaimsMapWorkflow: jest.fn(async () => false),
    getDefaultBranch: jest.fn(async () => 'main'),
    getFile,
    getRawFile: jest.fn(async () => null),
    listFilesRecursive: jest.fn(async () => []),
    owner: 'example',
    publishClaim,
    waitForWorkflow: jest.fn(async () => ({
      runUrl: 'https://github.com/example/claims/actions/runs/1',
      runId: 1,
      conclusion: 'success',
    })),
  } as unknown as ClaimsClient;

  return { client, getFile, publishClaim };
}

beforeAll(() => {
  registerValidator('ComponentClaim', loadSchema('ComponentClaim'));
});

beforeEach(() => {
  MockClaimsClient.mockClear();
});

describe('runClaimCreation', () => {
  function createCreationClient(existingReference?: string) {
    const publishClaim = jest.fn(async () => ({
      url: 'workflow-url',
      correlationId: 'corr-1',
      workflowId: 'provision-claim.yaml',
      branch: 'fs-forge/ComponentClaim-new-component',
    }));
    const client = {
      hasInFlightClaimsMapWorkflow: jest.fn(async () => false),
      getFile: jest.fn(async (path: string) => {
        if (path !== 'claims-map.json') return null;
        return {
          content: JSON.stringify({
            headers: { sha: 'map-sha' },
            claims: existingReference
              ? {
                  [existingReference]: {
                    filePath: 'components/new-component.yaml',
                  },
                }
              : {},
          }),
          path,
          sha: 'map-file-sha',
        };
      }),
      publishClaim,
      waitForWorkflow: jest.fn(async () => ({
        runUrl: 'https://github.com/example/claims/actions/runs/1',
        runId: 1,
        conclusion: 'success',
      })),
    } as unknown as ClaimsClient;
    MockClaimsClient.mockImplementation(() => client);
    return { client, publishClaim };
  }

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
    const { client, publishClaim } = createCreationClient();

    const result = await runClaimCreation({
      kind: 'ComponentClaim',
      name: 'new-component',
      claim,
      writeOutput: jest.fn(),
      writeDiagnostic: jest.fn(),
    });

    expect(YAML.parse(result.output)).toEqual(claim);
    expect(MockClaimsClient).not.toHaveBeenCalled();
    expect(client.hasInFlightClaimsMapWorkflow).not.toHaveBeenCalled();
    expect(publishClaim).not.toHaveBeenCalled();
  });

  it('publishes a new claim to its deterministic path', async () => {
    const { publishClaim } = createCreationClient();

    const result = await runClaimCreation({
      org: 'example',
      kind: 'ComponentClaim',
      name: 'new-component',
      claim,
      commit: true,
      writeOutput: jest.fn(),
      writeDiagnostic: jest.fn(),
    });

    expect(MockClaimsClient).toHaveBeenCalledWith('example');
    expect(result.publishUrl).toBe(
      'https://github.com/example/claims/actions/runs/1',
    );
    expect(publishClaim).toHaveBeenCalledWith(
      'ComponentClaim',
      'new-component',
      'claims/components/new-component.yaml',
      result.output,
    );
  });

  it('rejects an existing claim before publishing', async () => {
    const { publishClaim } = createCreationClient(
      'ComponentClaim-new-component',
    );

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
    expect(publishClaim).not.toHaveBeenCalled();
  });

  describe.each(CREATE_COMMIT_CASES)(
    'create --commit for $kind',
    ({ kind, path, expectedPath }) => {
      it('publishes a new claim to its deterministic path', async () => {
        const { publishClaim } = createCreationClient();

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
        expect(publishClaim).toHaveBeenCalledWith(
          kind,
          'new-claim',
          expectedPath,
          result.output,
        );
      });

      it('rejects an existing claim before publishing', async () => {
        const { publishClaim } = createCreationClient(`${kind}-new-claim`);

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
        expect(publishClaim).not.toHaveBeenCalled();
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
    expect(
      formatUnifiedDiff({ value: Number.NaN }, { value: null }),
    ).toBe('- value: .nan\n+ value: null');
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
    const { client, publishClaim } = createClient();
    const transform = jest.fn((claim: Record<string, unknown>) => claim);
    let result: ClaimMutationResult | undefined;

    const presented = await captureOutput(async () => {
      result = await runClaimMutation({
        client,
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
    expect(publishClaim).not.toHaveBeenCalled();
  });

  it('presents output before publishing and reports the workflow URL', async () => {
    const { client, publishClaim } = createClient();
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
    publishClaim.mockImplementation(async () => {
      events.push('publish');
      return {
        url: 'workflow-url',
        correlationId: 'corr-1',
        workflowId: 'provision-claim.yaml',
        branch: 'fs-forge/ComponentClaim-my-component',
      };
    });

    const result = await runClaimMutation({
      client,
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
    expect(events).toEqual(['output', 'publish', 'report']);
    expect(report).toContain('Provisioning...');
    expect(YAML.parse(result.output)).toMatchObject({
      name: 'my-component',
    });
    expect(publishClaim).toHaveBeenCalledWith(
      'ComponentClaim',
      'my-component',
      'claims/components/my-component.yaml',
      result.output,
      'claim-sha',
    );
  });

  it('presents provenance and does not publish an invalid mutation', async () => {
    const { client, publishClaim } = createClient();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        client,
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
    expect(publishClaim).not.toHaveBeenCalled();
  });

  it('presents invalid text changes without exposing defaults by default', async () => {
    const { client } = createClient();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        client,
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
    const { client } = createClient();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        client,
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
    const { client } = createClient();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        client,
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
    const { client } = createClient();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        client,
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
    const { client, getFile } = createClient();

    const presented = await captureOutput(async () => {
      await runClaimMutation({
        client,
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
    expect(getFile).not.toHaveBeenCalled();
  });

  it('applies defaults after user overrides and validates the defaulted document', async () => {
    const { client, publishClaim } = createClient();

    const result = await runSilently({
      client,
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
    expect(publishClaim).not.toHaveBeenCalled();
  });

  it('skips defaults when the defaults hook leaves the claim unchanged', async () => {
    const { client } = createClient();

    const result = await runSilently({
      client,
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
    const { client } = createClient();

    const result = await runSilently({
      client,
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
        { path: 'providers.github.visibility', before: 'private', after: 'public' },
        { path: 'description', before: undefined, after: 'touched' },
      ]),
    );
    expect(result.defaultsDiff).toEqual([
      { path: 'platformOwner', before: undefined, after: 'group:default' },
    ]);
  });

  it('fails hard when the defaults hook errors', async () => {
    const { client } = createClient();

    await expect(
      runClaimMutation({
        client,
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
