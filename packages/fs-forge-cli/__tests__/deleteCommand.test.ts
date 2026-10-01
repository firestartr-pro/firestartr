import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';

jest.mock('../src/claims/client', () => ({
  ClaimsClient: jest.fn(),
}));

import { ClaimsClient } from '../src/claims/client';
import Delete from '../src/commands/delete';

const ROOT = process.cwd();
const ORIGINAL_ORG = process.env.FSCRT_ORG;

const MockClaimsClient = ClaimsClient as unknown as jest.Mock;

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
  const dispatchUnprovision = jest.fn(async () => ({
    url: 'https://example.test/workflow',
    correlationId: 'corr-1',
    workflowId: 'unprovision-claim.yaml',
    branch: 'main',
  }));
  if (opts?.dispatchError) {
    dispatchUnprovision.mockRejectedValue(new Error(opts.dispatchError));
  }

  const client = {
    hasInFlightClaimsMapWorkflow: jest.fn(async () => false),
    getDefaultBranch: jest.fn(async () => 'main'),
    getFile: jest.fn(async (path: string) => {
      if (path === 'claims-map.json') {
        return {
          content: JSON.stringify(CLAIMS_MAP),
          path,
          sha: 'map-file-sha',
        };
      }
      return null;
    }),
    dispatchUnprovision,
    waitForWorkflow: jest.fn(async () => ({
      runUrl: 'https://github.com/example/claims/actions/runs/1',
      runId: 1,
      conclusion: 'success',
    })),
    owner: 'example',
  };
  MockClaimsClient.mockImplementation(() => client);
  return client;
}

beforeAll(() => {
  delete process.env.FSCRT_ORG;
});

afterEach(() => {
  MockClaimsClient.mockClear();
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
      expect(MockClaimsClient).not.toHaveBeenCalled();
    });

    it('accepts FSCRT_ORG in dry-run mode', async () => {
      process.env.FSCRT_ORG = 'env-org';
      mockClient();
      const { result } = await captureOutput(async () => {
        await Delete.run(['component', 'my-component'], { root: ROOT });
        return 0;
      });

      expect(result).toBe(0);
      expect(MockClaimsClient).toHaveBeenCalledWith('env-org');
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
      const client = mockClient();
      const { result, stderr } = await captureOutput(async () => {
        await Delete.run(
          ['component', 'my-component', '--org', 'my-org', '--commit'],
          { root: ROOT },
        );
        return 0;
      });

      expect(result).toBe(0);
      expect(MockClaimsClient).toHaveBeenCalledWith('my-org');
      expect(client.dispatchUnprovision).toHaveBeenCalledWith(
        'ComponentClaim',
        'my-component',
        {
          includeVariants: true,
          waitForClaimChecks: false,
        },
      );
      expect(stderr).toContain('Unprovisioning...');
      expect(client.waitForWorkflow).toHaveBeenCalledWith(
        'corr-1',
        'unprovision-claim.yaml',
        'ComponentClaim',
        'my-component',
        'main',
        'Unprovisioning',
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
      const client = mockClient();
      const { result } = await captureOutput(async () => {
        await Delete.run(
          ['component', 'my-component', '--commit'],
          { root: ROOT },
        );
        return 0;
      });

      expect(result).toBe(0);
      expect(MockClaimsClient).toHaveBeenCalledWith('env-org');
      expect(client.dispatchUnprovision).toHaveBeenCalled();
    });

    it('passes --no-include-variants to the dispatch', async () => {
      const client = mockClient();
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
      expect(client.dispatchUnprovision).toHaveBeenCalledWith(
        'TFWorkspaceClaim',
        'my-tf',
        { includeVariants: false, waitForClaimChecks: false },
      );
    });

    it('passes --wait-for-checks to the dispatch', async () => {
      const client = mockClient();
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
      expect(client.dispatchUnprovision).toHaveBeenCalledWith(
        'ComponentClaim',
        'my-component',
        { includeVariants: true, waitForClaimChecks: true },
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
      const client = mockClient();
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
      expect(client.waitForWorkflow).not.toHaveBeenCalled();
    });

    it('fails when the workflow concludes with failure', async () => {
      const client = mockClient();
      client.waitForWorkflow = jest.fn(async () => ({
        runUrl: 'https://example.test/run/1',
        runId: 1,
        conclusion: 'failure',
      }));

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
