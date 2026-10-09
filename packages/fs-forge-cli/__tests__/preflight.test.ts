import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { createGitHubApi } from '../src/github/index';
import Preflight from '../src/commands/preflight';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

const ROOT = process.cwd();
const ORIGINAL_ORG = process.env.FSCRT_ORG;

const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;

beforeAll(() => {
  delete process.env.FSCRT_ORG;
});

afterEach(() => {
  MockCreateGitHubApi.mockClear();
  process.exitCode = 0;
  if (ORIGINAL_ORG === undefined) {
    delete process.env.FSCRT_ORG;
  } else {
    process.env.FSCRT_ORG = ORIGINAL_ORG;
  }
});

const CLAIMS_MAP = {
  headers: { sha: 'map-sha' },
  claims: {
    'ComponentClaim-existing-repo': {
      filePath: 'components/existing-repo.yaml',
    },
    'GroupClaim-existing-team': {
      filePath: 'groups/existing-team.yaml',
    },
    'UserClaim-existing-user': {
      filePath: 'users/existing-user.yaml',
    },
  },
};

function mockApi(opts?: {
  repoExists?: boolean;
  teamExists?: boolean;
  userIsMember?: boolean;
  providerError?: Error;
}) {
  const api = new MemoryGitHubApi();
  for (const owner of ['my-org', 'env-org']) {
    const ref = { owner, repo: 'claims' };
    api.setDefaultBranch(ref, 'main');
    api.setFile(
      ref,
      'claims-map.json',
      JSON.stringify(CLAIMS_MAP),
      'map-file-sha',
    );
  }
  if (opts?.repoExists) {
    api.repoExists = async () => true;
  }
  if (opts?.teamExists) {
    api.teamExists = async () => true;
  }
  if (opts?.userIsMember) {
    api.userIsOrgMember = async () => true;
  }
  if (opts?.providerError) {
    const error = opts.providerError;
    api.repoExists = async () => {
      throw error;
    };
    api.teamExists = async () => {
      throw error;
    };
    api.userIsOrgMember = async () => {
      throw error;
    };
  }
  MockCreateGitHubApi.mockReturnValue(api);
  return api;
}

describe('fs-forge preflight', () => {
  describe('flag validation', () => {
    it('requires --org', async () => {
      const { error } = await captureOutput(() =>
        Preflight.run(
          ['--create', '--kind', 'repo', '--name', 'my-service'],
          { root: ROOT },
        ),
      );
      expect(error?.message).toContain('--org or FSCRT_ORG is required');
    });

    it('requires one of --create, --edition, --deletion', async () => {
      const { error } = await captureOutput(() =>
        Preflight.run(
          ['--kind', 'repo', '--name', 'my-service', '--org', 'my-org'],
          { root: ROOT },
        ),
      );
      expect(error?.message).toContain(
        'One of --create, --edition, or --deletion is required',
      );
    });

    it('rejects an unsupported kind', async () => {
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--create',
            '--kind',
            'unknown',
            '--name',
            'my-service',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        ),
      );
      expect(error).toBeDefined();
    });

    it('rejects multiple subcommand flags', async () => {
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--create',
            '--edition',
            '--kind',
            'repo',
            '--name',
            'my-service',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.message).toContain('mutually exclusive');
    });

    it('accepts FSCRT_ORG fallback', async () => {
      process.env.FSCRT_ORG = 'env-org';
      const api = mockApi();
      const { result } = await captureOutput(async () => {
        await Preflight.run(
          ['--create', '--kind', 'repo', '--name', 'my-svc'],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(api.calls).toContain(
        'readFile env-org/claims:claims-map.json@claims-index',
      );
    });
  });

  describe('--create', () => {
    it('passes when claim and provider are available', async () => {
      mockApi();
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--create',
            '--kind',
            'repo',
            '--name',
            'new-service',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('new-service');
    });

    it('detects claim conflict (exit 1)', async () => {
      mockApi();
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--create',
            '--kind',
            'repo',
            '--name',
            'existing-repo',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.message).toContain('already exists in claims');
      expect(error?.oclif?.exit).toBe(1);
    });

    it('detects claim conflict with --json (exit 1)', async () => {
      mockApi();
      const { error, stdout } = await captureOutput(() =>
        Preflight.run(
          [
            '--create',
            '--kind',
            'repo',
            '--name',
            'existing-repo',
            '--org',
            'my-org',
            '--json',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.oclif?.exit).toBe(1);
      expect(stdout).toContain('"conflict":"claim"');
    });

    it('detects provider conflict (exit 2)', async () => {
      mockApi({ repoExists: true });
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--create',
            '--kind',
            'repo',
            '--name',
            'new-service',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.message).toContain('already exists in GitHub');
      expect(error?.oclif?.exit).toBe(2);
    });

    it('detects provider conflict with --json (exit 2)', async () => {
      mockApi({ repoExists: true });
      const { error, stdout } = await captureOutput(() =>
        Preflight.run(
          [
            '--create',
            '--kind',
            'repo',
            '--name',
            'new-service',
            '--org',
            'my-org',
            '--json',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.oclif?.exit).toBe(2);
      expect(stdout).toContain('"conflict":"provider"');
    });

    it('only checks claims with --scope claims', async () => {
      const api = mockApi({ repoExists: true });
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--create',
            '--kind',
            'repo',
            '--name',
            'new-service',
            '--org',
            'my-org',
            '--scope',
            'claims',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('not declared in claims');
      expect(api.calls.some((call) => call.startsWith('repoExists'))).toBe(
        false,
      );
    });

    it('only checks provider with --scope provider', async () => {
      mockApi();
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--create',
            '--kind',
            'repo',
            '--name',
            'new-service',
            '--org',
            'my-org',
            '--scope',
            'provider',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('is available');
    });

    it('handles tfworkspace (claims-only, no provider API)', async () => {
      mockApi();
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--create',
            '--kind',
            'tfworkspace',
            '--name',
            'my-workspace',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('not declared in claims');
    });

    it('handles tfworkspace --scope provider (no-op)', async () => {
      mockApi();
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--create',
            '--kind',
            'tfworkspace',
            '--name',
            'my-workspace',
            '--org',
            'my-org',
            '--scope',
            'provider',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('claims-only');
    });

    it('checks user membership', async () => {
      mockApi();
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--create',
            '--kind',
            'user',
            '--name',
            'octocat',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('user "octocat" is available');
    });

    it('detects user already a member (exit 2)', async () => {
      mockApi({ userIsMember: true });
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--create',
            '--kind',
            'user',
            '--name',
            'octocat',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.oclif?.exit).toBe(2);
    });

    it('checks team existence', async () => {
      mockApi();
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--create',
            '--kind',
            'team',
            '--name',
            'platform-team',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('team "platform-team" is available');
    });

    it('detects team already exists (exit 2)', async () => {
      mockApi({ teamExists: true });
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--create',
            '--kind',
            'team',
            '--name',
            'new-team',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.oclif?.exit).toBe(2);
    });
  });

  describe('--edition', () => {
    it('requires --old-name', async () => {
      mockApi();
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--edition',
            '--kind',
            'repo',
            '--name',
            'new-name',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.message).toContain('--old-name is required');
    });

    it('fails when old name claim does not exist (exit 3)', async () => {
      mockApi();
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--edition',
            '--kind',
            'repo',
            '--old-name',
            'ghost',
            '--name',
            'new-name',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.oclif?.exit).toBe(3);
    });

    it('passes when claim exists and no identity change', async () => {
      mockApi();
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--edition',
            '--kind',
            'repo',
            '--old-name',
            'existing-repo',
            '--name',
            'existing-repo',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('no identity change');
    });

    it('checks provider on identity change', async () => {
      mockApi();
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--edition',
            '--kind',
            'repo',
            '--old-name',
            'existing-repo',
            '--name',
            'new-name',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('exists');
      expect(stdout).toContain('is available');
    });

    it('detects provider conflict on identity change (exit 2)', async () => {
      mockApi({ repoExists: true });
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--edition',
            '--kind',
            'repo',
            '--old-name',
            'existing-repo',
            '--name',
            'taken-repo',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.oclif?.exit).toBe(2);
    });

    it('skips provider check with --scope claims', async () => {
      const api = mockApi({ repoExists: true });
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--edition',
            '--kind',
            'repo',
            '--old-name',
            'existing-repo',
            '--name',
            'new-name',
            '--org',
            'my-org',
            '--scope',
            'claims',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('exists');
      expect(api.calls.some((call) => call.startsWith('repoExists'))).toBe(
        false,
      );
    });
  });

  describe('--deletion', () => {
    it('passes when claim exists', async () => {
      mockApi();
      const { result, stdout } = await captureOutput(async () => {
        await Preflight.run(
          [
            '--deletion',
            '--kind',
            'repo',
            '--name',
            'existing-repo',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        );
        return 0;
      });
      expect(result).toBe(0);
      expect(stdout).toContain('found');
    });

    it('fails when claim does not exist (exit 3)', async () => {
      mockApi();
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--deletion',
            '--kind',
            'repo',
            '--name',
            'ghost',
            '--org',
            'my-org',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.oclif?.exit).toBe(3);
    });
  });

  describe('error handling', () => {
    it('handles auth errors (exit 4)', async () => {
      mockApi({
        providerError: Object.assign(new Error('Bad credentials'), {
          status: 401,
        }),
      });
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--create',
            '--kind',
            'repo',
            '--name',
            'my-svc',
            '--org',
            'my-org',
            '--scope',
            'provider',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.oclif?.exit).toBe(4);
    });

    it('handles API unreachable (exit 5)', async () => {
      mockApi({ providerError: new Error('connect ECONNREFUSED') });
      const { error } = await captureOutput(() =>
        Preflight.run(
          [
            '--create',
            '--kind',
            'repo',
            '--name',
            'my-svc',
            '--org',
            'my-org',
            '--scope',
            'provider',
          ],
          { root: ROOT },
        ),
      );
      expect(error?.oclif?.exit).toBe(5);
    });
  });
});
