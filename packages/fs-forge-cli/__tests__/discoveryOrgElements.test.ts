import { describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';

jest.mock('../src/claims/claimsMap', () => ({
  loadClaimsMap: jest.fn(),
}));

import { loadClaimsMap } from '../src/claims/claimsMap';
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

  it('filters by --kind, repeatable', async () => {
    const { result, stdout } = await run('--kind', 'group');

    expect(result).toBe(0);
    expect(stdout).toContain('GroupClaim');
    expect(stdout).not.toContain('ComponentClaim');
  });

  it('accepts full claim kind compatibility spellings', async () => {
    const { result, stdout } = await run('--kind', 'GroupClaim');

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
      expect.objectContaining({ repo: 'staging-claims' }),
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

  it('surfaces a stale claims map error', async () => {
    mockedLoadClaimsMap.mockRejectedValue(
      new Error('The claims map is stale; wait for generate-claims-map.yaml to recover'),
    );

    const { error } = await run();

    expect(error?.message).toContain('claims map is stale');
  });

  it('surfaces a missing claims map error', async () => {
    mockedLoadClaimsMap.mockRejectedValue(
      new Error('The claims repo does not have a claims map yet'),
    );

    const { error } = await run();

    expect(error?.message).toContain('does not have a claims map yet');
  });
});
