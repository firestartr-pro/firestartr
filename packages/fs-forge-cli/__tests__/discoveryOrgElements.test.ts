import { describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';

jest.mock('../src/claims/claimsRepo', () => ({
  claimsRepo: jest.fn(
    (_api: unknown, owner: string, repo = 'claims') => ({
      api: {},
      ref: { owner, repo },
    }),
  ),
  loadClaimsMap: jest.fn(),
}));
jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(() => ({})),
}));

import { loadClaimsMap } from '../src/claims/claimsRepo';
import OrgElements from '../src/commands/discovery/org-elements';

process.env.GITHUB_TOKEN = 'test-token';

const mockedLoadClaimsMap = loadClaimsMap as jest.MockedFunction<
  typeof loadClaimsMap
>;

const MAP = {
  headers: { sha: 'abc123def' },
  claims: {
    'ComponentClaim-my-service': { filePath: 'components/my-service.yaml' },
    'ComponentClaim-api-gateway': { filePath: 'components/api-gateway.yaml' },
    'GroupClaim-platform-team': { filePath: 'groups/platform-team.yaml' },
  },
};

async function run(...flags: string[]) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    return await captureOutput(async () => {
      await OrgElements.run(['--org', 'my-org', ...flags], {
        root: process.cwd(),
      });
      return 0;
    });
  } finally {
    process.exitCode = previousExitCode;
  }
}

describe('discovery org-elements', () => {
  beforeEach(() => {
    mockedLoadClaimsMap.mockReset();
    mockedLoadClaimsMap.mockResolvedValue(MAP as never);
  });

  it('prints a table sorted by kind then name', async () => {
    const { result, stdout } = await run();

    expect(result).toBe(0);
    expect(stdout).toMatch(/^KIND\s+NAME\s+FILE PATH$/m);
    const lines = stdout.trim().split('\n');
    expect(lines[1]).toContain('ComponentClaim');
    expect(lines[1]).toContain('api-gateway');
    expect(lines[2]).toContain('my-service');
    expect(lines[3]).toContain('GroupClaim');
    expect(lines[3]).toContain('platform-team');
  });

  it('prints json grouped by kind', async () => {
    const { result, stdout } = await run('--json');

    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      org: 'my-org',
      claimsRepo: 'claims',
      claimsMapSha: 'abc123def',
      claims: {
        ComponentClaim: [
          { name: 'api-gateway', filePath: 'components/api-gateway.yaml' },
          { name: 'my-service', filePath: 'components/my-service.yaml' },
        ],
        GroupClaim: [
          { name: 'platform-team', filePath: 'groups/platform-team.yaml' },
        ],
      },
    });
  });

  it.each(['group', 'GroupClaim'])('filters by --kind %s', async (kind) => {
    const { result, stdout } = await run('--kind', kind);

    expect(result).toBe(0);
    expect(stdout).toContain('GroupClaim');
    expect(stdout).not.toContain('ComponentClaim');
  });

  it('produces empty output when --kind matches nothing', async () => {
    mockedLoadClaimsMap.mockResolvedValue({
      headers: { sha: 'x' },
      claims: {},
    } as never);

    const { result, stdout } = await run();

    expect(result).toBe(0);
    expect(stdout).toBe('');
  });

  it('rejects an unknown --kind value', async () => {
    const { error } = await run('--kind', 'bogus');

    expect(error?.message).toContain('bogus');
  });

  it('propagates --claims-repo to the client', async () => {
    await run('--claims-repo', 'staging-claims', '--json');

    expect(mockedLoadClaimsMap).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: expect.objectContaining({ repo: 'staging-claims' }),
      }),
    );
  });

  it('errors when no org is provided', async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      const { error } = await captureOutput(async () => {
        await OrgElements.run([], { root: process.cwd() });
        return 0;
      });
      expect(error?.message).toContain('--org or FSCRT_ORG is required');
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it.each([
    [
      'The claims map is stale; wait for generate-claims-map.yaml to recover',
      'claims map is stale',
    ],
    [
      'The claims repo does not have a claims map yet',
      'does not have a claims map yet',
    ],
  ])('surfaces a claims map error: %s', async (message, expected) => {
    mockedLoadClaimsMap.mockRejectedValue(new Error(message));

    const { error } = await run();

    expect(error?.message).toContain(expected);
  });
});
