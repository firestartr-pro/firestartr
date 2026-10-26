import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { claimsRepo } from '../src/claims/claimsRepo';
import CreateComponent from '../src/commands/create/component';
import Delete from '../src/commands/delete';
import Edit from '../src/commands/edit';
import { runFeatureMutation } from '../src/features/mutation';
import { createGitHubApi } from '../src/github/index';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { ClaimsRepo } from '../src/claims/claimsRepo';
import type { FeatureMutationRequest } from '../src/features/mutation';
import type { FeatureReference } from '../src/utils/features';
import type { RepoRef } from '../src/github/api';

const ROOT = process.cwd();
const ORIGINAL_ORG = process.env.FSCRT_ORG;
const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;

const CLAIMS_MAP = {
  headers: { sha: 'map-sha' },
  claims: {
    'ComponentClaim-my-component': {
      filePath: 'components/my-component.yaml',
    },
  },
};

const CLAIM_YAML = readFileSync(
  join(ROOT, '__tests__', 'fixtures', 'valid', 'component.yaml'),
  'utf8',
);

function mockClient(): MemoryGitHubApi {
  const api = new MemoryGitHubApi();
  api.autoCompleteDispatches = true;
  const ref: RepoRef = { owner: 'my-org', repo: 'claims' };
  api.setDefaultBranch(ref, 'main');
  api.setBranchHeadSha(ref, 'main', 'base-sha');
  api.setFile(ref, 'claims-map.json', JSON.stringify(CLAIMS_MAP), 'map-file-sha');
  api.setFile(
    ref,
    'claims/components/my-component.yaml',
    CLAIM_YAML,
    'claim-sha',
  );
  MockCreateGitHubApi.mockReturnValue(api);
  return api;
}

type CommandClass = typeof CreateComponent;

async function run(
  command: {
    run(
      argv: string[],
      config: { root: string },
    ): Promise<unknown>;
  },
  ...flags: string[]
): Promise<{ result?: unknown; error?: Error; stdout: string; stderr: string }> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    return await captureOutput(async () => {
      await command.run(flags, { root: ROOT });
      return 0;
    });
  } finally {
    process.exitCode = previousExitCode;
  }
}

function createArgs(...extra: string[]): string[] {
  const args = CreateComponent.examples[0]
    .replace('<%= config.bin %> <%= command.id %> ', '')
    .split(' ');
  return [...args, ...extra];
}

function lastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

function indexOfCall(api: MemoryGitHubApi, prefix: string): number {
  return api.calls.findIndex((call) => call.startsWith(prefix));
}

beforeAll(() => {
  delete process.env.FSCRT_ORG;
});

afterEach(() => {
  MockCreateGitHubApi.mockClear();
  if (ORIGINAL_ORG === undefined) {
    delete process.env.FSCRT_ORG;
  } else {
    process.env.FSCRT_ORG = ORIGINAL_ORG;
  }
});

describe('--issue', () => {
  it('links the claim PR created by create --commit', async () => {
    const api = mockClient();

    const { result, stdout } = await run(
      CreateComponent as unknown as CommandClass,
      ...createArgs('--commit', '--org', 'my-org', '--issue', '7'),
    );

    expect(result).toBe(0);
    expect(api.createdPulls).toEqual([
      expect.objectContaining({
        head: 'fs-forge/ComponentClaim-example',
        base: 'main',
        title: 'ci: provision claim ComponentClaim/example',
        body: 'Closes #7',
      }),
    ]);
    expect(indexOfCall(api, 'commitFile')).toBeLessThan(
      indexOfCall(api, 'createPullRequest'),
    );
    expect(indexOfCall(api, 'createPullRequest')).toBeLessThan(
      indexOfCall(api, 'dispatchWorkflow'),
    );
    expect(lastJsonLine(stdout)).toEqual(
      expect.objectContaining({
        status: 'ok',
        issue: { number: 7, url: 'https://github.com/my-org/claims/issues/7' },
        pr: { number: 1, url: 'https://github.com/my-org/claims/pull/1' },
      }),
    );
  });

  it('links the claim PR created by edit --commit', async () => {
    const api = mockClient();

    const { result } = await run(
      Edit,
      'ComponentClaim-my-component',
      '--commit',
      '--org',
      'my-org',
      '--providers.github.visibility',
      'public',
      '--issue',
      '9',
    );

    expect(result).toBe(0);
    expect(api.committed[0]).toEqual(
      expect.objectContaining({
        branch: 'fs-forge/ComponentClaim-my-component',
      }),
    );
    expect(api.createdPulls).toEqual([
      expect.objectContaining({
        head: 'fs-forge/ComponentClaim-my-component',
        base: 'main',
        body: 'Closes #9',
      }),
    ]);
  });
});

describe('--create-issue', () => {
  it('creates the issue before the branch and links it from the claim PR', async () => {
    const api = mockClient();

    const { result, stdout } = await run(
      CreateComponent as unknown as CommandClass,
      ...createArgs('--commit', '--org', 'my-org', '--create-issue'),
    );

    expect(result).toBe(0);
    expect(api.issues).toEqual([
      expect.objectContaining({
        title: 'Create component example',
        state: 'open',
      }),
    ]);
    expect(indexOfCall(api, 'createIssue')).toBeLessThan(
      indexOfCall(api, 'createBranch'),
    );
    expect(api.createdPulls[0].body).toBe('Closes #1');
    expect(lastJsonLine(stdout)).toEqual(
      expect.objectContaining({
        issue: { number: 1, url: 'https://github.com/my-org/claims/issues/1' },
        pr: { number: 1, url: 'https://github.com/my-org/claims/pull/1' },
      }),
    );
  });

  it('honours --issue-title and --issue-body', async () => {
    const api = mockClient();

    const { result } = await run(
      CreateComponent as unknown as CommandClass,
      ...createArgs(
        '--commit',
        '--org',
        'my-org',
        '--create-issue',
        '--issue-title',
        'Ship example',
        '--issue-body',
        'the client wants it',
      ),
    );

    expect(result).toBe(0);
    expect(api.issues[0]).toEqual(
      expect.objectContaining({
        title: 'Ship example',
        body: 'the client wants it',
      }),
    );
    expect(api.createdPulls[0].body).toBe('Closes #1');
  });

  it('comments the failure on the issue, leaves it open and exits non-zero', async () => {
    const api = mockClient();
    api.commitFile = async () => {
      throw new Error('Resource not accessible by integration');
    };

    const { error } = await run(
      CreateComponent as unknown as CommandClass,
      ...createArgs('--commit', '--org', 'my-org', '--create-issue'),
    );

    expect(error?.message).toContain('Resource not accessible by integration');
    expect(api.issues[0].state).toBe('open');
    expect(api.issueComments).toEqual([
      expect.objectContaining({
        issue: 1,
        body: expect.stringContaining('Resource not accessible by integration'),
      }),
    ]);
    expect(api.createdPulls).toEqual([]);
  });
});

const FEATURE_CLAIM_YAML = `${CLAIM_YAML}    features:
      - name: feature_a
        version: 1.0.0
`;

function featureRepo(): { api: MemoryGitHubApi; repo: ClaimsRepo } {
  const api = new MemoryGitHubApi();
  api.autoCompleteDispatches = true;
  const repo = claimsRepo(api, 'my-org');
  api.setDefaultBranch(repo.ref, 'main');
  api.setBranchHeadSha(repo.ref, 'main', 'base-sha');
  api.setFile(
    repo.ref,
    'claims-map.json',
    JSON.stringify(CLAIMS_MAP),
    'map-file-sha',
  );
  api.setFile(
    repo.ref,
    'claims/components/my-component.yaml',
    FEATURE_CLAIM_YAML,
    'claim-sha',
  );
  return { api, repo };
}

type FeatureAuditCase = [
  FeatureMutationRequest['operation'],
  FeatureReference,
  string,
  string,
];

describe('features audit trail', () => {
  const cases: FeatureAuditCase[] = [
    [
      'add',
      { name: 'feature_b', version: '1.0.0' },
      'Add feature feature_b to component my-component',
      'Audit trail for adding feature `feature_b` to `ComponentClaim-my-component`.',
    ],
    [
      'edit',
      { name: 'feature_a', version: '2.0.0' },
      'Edit feature feature_a in component my-component',
      'Audit trail for editing feature `feature_a` in `ComponentClaim-my-component`.',
    ],
    [
      'remove',
      { name: 'feature_a' },
      'Remove feature feature_a from component my-component',
      'Audit trail for removing feature `feature_a` from `ComponentClaim-my-component`.',
    ],
  ];

  it.each(cases)(
    'states the %s feature change in the default issue',
    async (operation, feature, title, goal) => {
      const { api, repo } = featureRepo();

      await captureOutput(async () => {
        await runFeatureMutation(
          {
            operation,
            component: 'my-component',
            json: false,
            commit: true,
            createIssue: true,
            feature,
          },
          { repo, schemasDir: join(ROOT, 'schemas') },
        );
        return 0;
      });

      expect(api.issues[0].title).toBe(title);
      expect(api.issues[0].body).toContain('## Goal');
      expect(api.issues[0].body).toContain(goal);
      expect(api.issues[0].body).toContain('## Requested change');
      expect(api.issues[0].body).toContain('- **Kind:** `ComponentClaim`');
      expect(api.issues[0].body).toContain('- **Name:** `my-component`');
    },
  );

  it('names the feature when a committed feature change fails', async () => {
    const { api, repo } = featureRepo();
    api.commitFile = async () => {
      throw new Error('Resource not accessible by integration');
    };

    await expect(
      captureOutput(async () => {
        await runFeatureMutation(
          {
            operation: 'remove',
            component: 'my-component',
            json: false,
            commit: true,
            createIssue: true,
            feature: { name: 'feature_a' },
          },
          { repo, schemasDir: join(ROOT, 'schemas') },
        );
        return 0;
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining('Resource not accessible'),
        }),
      }),
    );
    expect(api.issueComments[0].body).toMatch(
      /^Remove feature feature_a from component my-component failed; this issue stays open\./,
    );
  });

  it('links the claims PR opened by a committed feature add', async () => {
    const api = new MemoryGitHubApi();
    api.autoCompleteDispatches = true;
    const repo = claimsRepo(api, 'my-org');
    api.setDefaultBranch(repo.ref, 'main');
    api.setBranchHeadSha(repo.ref, 'main', 'base-sha');
    api.setFile(
      repo.ref,
      'claims-map.json',
      JSON.stringify(CLAIMS_MAP),
      'map-file-sha',
    );
    api.setFile(
      repo.ref,
      'claims/components/my-component.yaml',
      CLAIM_YAML,
      'claim-sha',
    );

    const outcome = await captureOutput(async () => {
      await runFeatureMutation(
        {
          operation: 'add',
          component: 'my-component',
          json: false,
          commit: true,
          issue: 8,
          feature: { name: 'feature_a', version: '1.0.0', args: {} },
        },
        { repo, schemasDir: join(ROOT, 'schemas') },
      );
      return 0;
    });

    expect(outcome.error).toBeUndefined();
    expect(api.createdPulls).toEqual([
      expect.objectContaining({
        head: 'fs-forge/ComponentClaim-my-component',
        base: 'main',
        body: 'Closes #8',
      }),
    ]);
    expect(lastJsonLine(outcome.stdout)).toEqual(
      expect.objectContaining({
        issue: { number: 8, url: 'https://github.com/my-org/claims/issues/8' },
        pr: { number: 1, url: 'https://github.com/my-org/claims/pull/1' },
      }),
    );
  });
});

describe('delete audit trail', () => {
  it('closes the issue and comments the run once the delete concludes', async () => {
    const api = mockClient();

    const { result, stdout } = await run(
      Delete,
      'component',
      'my-component',
      '--commit',
      '--org',
      'my-org',
      '--create-issue',
    );

    expect(result).toBe(0);
    expect(api.issues[0].state).toBe('closed');
    expect(api.issueComments).toEqual([
      expect.objectContaining({ issue: 1, body: expect.stringContaining('Workflow run: ') }),
    ]);
    expect(lastJsonLine(stdout)).toEqual(
      expect.objectContaining({
        issue: { number: 1, url: 'https://github.com/my-org/claims/issues/1' },
      }),
    );
    expect(api.createdPulls).toEqual([]);
  });

  it('comments the failure on the issue, leaves it open and exits non-zero', async () => {
    const api = mockClient();
    api.dispatchWorkflow = async () => {
      throw new Error('workflow dispatch failed');
    };

    const { error } = await run(
      Delete,
      'component',
      'my-component',
      '--commit',
      '--org',
      'my-org',
      '--create-issue',
    );

    expect(error?.message).toContain('workflow dispatch failed');
    expect(api.issues[0].state).toBe('open');
    expect(api.issueComments).toEqual([
      expect.objectContaining({
        body: expect.stringContaining('workflow dispatch failed'),
      }),
    ]);
  });

  it('does not close the issue in --no-wait mode', async () => {
    const api = mockClient();

    const { result } = await run(
      Delete,
      'component',
      'my-component',
      '--commit',
      '--org',
      'my-org',
      '--create-issue',
      '--no-wait',
    );

    expect(result).toBe(0);
    expect(api.issues[0].state).toBe('open');
    expect(api.issueComments).toEqual([]);
  });
});
