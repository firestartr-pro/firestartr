import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { createGitHubApi } from '../src/github/index';
import Delete from '../src/commands/delete';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

const ROOT = process.cwd();
const ORIGINAL_ORG = process.env.FSCRT_ORG;

const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;

const CLAIMS_MAP = {
  headers: { sha: 'map-sha' },
  claims: {
    'ComponentClaim-my-component': {
      filePath: 'components/my-component.yaml',
    },
    'TFWorkspaceClaim-my-tf': {
      filePath: 'tfworkspaces/my-tf.yaml',
    },
  },
};

function mockClient(opts?: { dispatchError?: string }) {
  const api = new MemoryGitHubApi();
  api.autoCompleteDispatches = true;
  for (const owner of ['my-org', 'env-org']) {
    const ref = { owner, repo: 'claims' };
    api.setDefaultBranch(ref, 'main');
    api.setFile(ref, 'claims-map.json', JSON.stringify(CLAIMS_MAP), 'map-file-sha');
  }
  if (opts?.dispatchError) {
    api.dispatchWorkflow = async () => {
      throw new Error(opts.dispatchError);
    };
  }
  MockCreateGitHubApi.mockReturnValue(api);
  return api;
}

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

describe('fs-forge delete', () => {
  describe('argument validation', () => {
    it('rejects an unsupported claim kind', async () => {
      const result = await captureOutput(() =>
        Delete.run(['foobar', 'my-svc', '--org', 'my-org'], {
          root: ROOT,
        }),
      );

      expect(result.error).toBeDefined();
    });

    it('accepts short kind IDs', async () => {
      mockClient();
      const result = await captureOutput(() =>
        Delete.run(
          ['component', 'my-component', '--org', 'my-org', '--commit'],
          { root: ROOT },
        ),
      );

      expect(result.error).toBeUndefined();
    });

    it('accepts full kind names', async () => {
      mockClient();
      const result = await captureOutput(() =>
        Delete.run(
          ['ComponentClaim', 'my-component', '--org', 'my-org', '--commit'],
          { root: ROOT },
        ),
      );

      expect(result.error).toBeUndefined();
    });
  });

  describe('dry run (without --commit)', () => {
    it('validates claim exists and prints planned dispatch', async () => {
      mockClient();
      const { result, stderr } = await captureOutput(async () => {
        await Delete.run(
          ['component', 'my-component', '--org', 'my-org'],
          { root: ROOT },
        );
        return 0;
      });

      expect(result).toBe(0);
      expect(stderr).toContain('Dry run');
      expect(stderr).toContain('claimType: ComponentClaim');
      expect(stderr).toContain('claimName: my-component');
      expect(stderr).toContain('includeVariants: true');
      expect(stderr).toContain('waitForClaimChecks: false');
    });

    it('fails when claim does not exist', async () => {
      mockClient();
      const result = await captureOutput(() =>
        Delete.run(
          ['component', 'nonexistent', '--org', 'my-org'],
          { root: ROOT },
        ),
      );

      expect(result.error?.message).toContain('Claim not found');
    });

    it('requires --org even in dry-run mode', async () => {
      const result = await captureOutput(() =>
        Delete.run(['component', 'my-component'], { root: ROOT }),
      );

      expect(result.error?.message).toContain('--org or FSCRT_ORG is required');
      expect(MockCreateGitHubApi).not.toHaveBeenCalled();
    });

    it('accepts FSCRT_ORG in dry-run mode', async () => {
      process.env.FSCRT_ORG = 'env-org';
      const api = mockClient();
      const { result } = await captureOutput(async () => {
        await Delete.run(['component', 'my-component'], { root: ROOT });
        return 0;
      });

      expect(result).toBe(0);
      expect(api.calls).toContain(
        'readFile env-org/claims:claims-map.json@claims-index',
      );
    });

    it('respects --no-include-variants in dry-run output', async () => {
      mockClient();
      const { stderr } = await captureOutput(async () => {
        await Delete.run(
          [
            'component',
            'my-component',
            '--org',
            'my-org',
            '--no-include-variants',
          ],
          { root: ROOT },
        );
        return 0;
      });

      expect(stderr).toContain('includeVariants: false');
    });

    it('respects --wait-for-checks in dry-run output', async () => {
      mockClient();
      const { stderr } = await captureOutput(async () => {
        await Delete.run(
          [
            'component',
            'my-component',
            '--org',
            'my-org',
            '--wait-for-checks',
          ],
          { root: ROOT },
        );
        return 0;
      });

      expect(stderr).toContain('waitForClaimChecks: true');
    });
  });

  describe('commit mode (with --commit)', () => {
    it('dispatches unprovision-claim.yaml and waits for completion', async () => {
      const api = mockClient();
      const { result, stderr } = await captureOutput(async () => {
        await Delete.run(
          ['component', 'my-component', '--org', 'my-org', '--commit'],
          { root: ROOT },
        );
        return 0;
      });

      expect(result).toBe(0);
      expect(api.calls).toContain(
        'readFile my-org/claims:claims-map.json@claims-index',
      );
      expect(api.dispatched[0]).toEqual({
        ref: { owner: 'my-org', repo: 'claims' },
        workflowId: 'unprovision-claim.yaml',
        gitRef: 'main',
        inputs: {
          claimType: 'ComponentClaim',
          claimName: 'my-component',
          correlationId: expect.any(String),
          includeVariants: true,
          waitForClaimChecks: false,
        },
      });
      expect(stderr).toContain('Unprovisioning...');
      expect(api.calls).toContain(
        'listWorkflowRuns my-org/claims:unprovision-claim.yaml@main',
      );
    });

    it('fails when claim does not exist', async () => {
      mockClient();
      const result = await captureOutput(() =>
        Delete.run(
          ['component', 'nonexistent', '--org', 'my-org', '--commit'],
          { root: ROOT },
        ),
      );

      expect(result.error?.message).toContain('Claim not found');
    });

    it('requires --org when committing', async () => {
      const result = await captureOutput(() =>
        Delete.run(
          ['component', 'my-component', '--commit'],
          { root: ROOT },
        ),
      );

      expect(result.error?.message).toContain('--org or FSCRT_ORG is required');
    });

    it('accepts FSCRT_ORG when committing', async () => {
      process.env.FSCRT_ORG = 'env-org';
      const api = mockClient();
      const { result } = await captureOutput(async () => {
        await Delete.run(
          ['component', 'my-component', '--commit'],
          { root: ROOT },
        );
        return 0;
      });

      expect(result).toBe(0);
      expect(api.calls).toContain(
        'readFile env-org/claims:claims-map.json@claims-index',
      );
      expect(api.dispatched).toHaveLength(1);
    });

    it('passes --no-include-variants to the dispatch', async () => {
      const api = mockClient();
      const { result } = await captureOutput(async () => {
        await Delete.run(
          [
            'tfworkspace',
            'my-tf',
            '--org',
            'my-org',
            '--no-include-variants',
            '--commit',
          ],
          { root: ROOT },
        );
        return 0;
      });

      expect(result).toBe(0);
      expect(api.dispatched[0].inputs).toEqual(
        expect.objectContaining({
          claimType: 'TFWorkspaceClaim',
          claimName: 'my-tf',
          includeVariants: false,
          waitForClaimChecks: false,
        }),
      );
    });

    it('passes --wait-for-checks to the dispatch', async () => {
      const api = mockClient();
      const { result } = await captureOutput(async () => {
        await Delete.run(
          [
            'component',
            'my-component',
            '--org',
            'my-org',
            '--wait-for-checks',
            '--commit',
          ],
          { root: ROOT },
        );
        return 0;
      });

      expect(result).toBe(0);
      expect(api.dispatched[0].inputs).toEqual(
        expect.objectContaining({
          claimType: 'ComponentClaim',
          claimName: 'my-component',
          includeVariants: true,
          waitForClaimChecks: true,
        }),
      );
    });

    it('propagates dispatch errors', async () => {
      mockClient({ dispatchError: 'GitHub API exploded' });
      const result = await captureOutput(() =>
        Delete.run(
          ['component', 'my-component', '--org', 'my-org', '--commit'],
          { root: ROOT },
        ),
      );

      expect(result.error?.message).toContain('GitHub API exploded');
    });

    it('skips waiting when --no-wait is passed', async () => {
      const api = mockClient();
      const { result, stderr } = await captureOutput(async () => {
        await Delete.run(
          [
            'component',
            'my-component',
            '--org',
            'my-org',
            '--commit',
            '--no-wait',
          ],
          { root: ROOT },
        );
        return 0;
      });

      expect(result).toBe(0);
      expect(stderr).toContain('(no-wait)');
      expect(
        api.calls.some((call) =>
          call.startsWith(
            'listWorkflowRuns my-org/claims:unprovision-claim.yaml',
          ),
        ),
      ).toBe(false);
    });

    it('fails when the workflow concludes with failure', async () => {
      const api = mockClient();
      api.autoCompleteConclusion = 'failure';

      const { error } = await captureOutput(() =>
        Delete.run(
          ['component', 'my-component', '--org', 'my-org', '--commit'],
          { root: ROOT },
        ),
      );

      expect(error?.message).toContain('Unprovision failed');
      expect(error?.message).toContain('failure');
    });
  });
});
