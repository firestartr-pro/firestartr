import { describe, expect, it, jest } from '@jest/globals';
import { captureOutput } from '@oclif/test';

import { claimsRepo } from '../src/claims/claimsRepo';
import { publishClaimAndWait } from '../src/mutations/publish';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { ClaimsRepo } from '../src/claims/claimsRepo';
import type {
  ClaimPublishRequest,
  ClaimPublishResult,
  Pulse,
} from '../src/mutations/publish';

const CLAIM_YAML = 'kind: ComponentClaim\nname: my-component\n';
const STATE_REPO = { owner: 'my-org', repo: 'state-github' };

interface Harness {
  api: MemoryGitHubApi;
  repo: ClaimsRepo;
  pulse: Pulse;
  outputLines: string[];
  diagnosticLines: string[];
}

function createHarness(existingClaim = false): Harness {
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
      claims: existingClaim
        ? {
            'ComponentClaim-my-component': {
              filePath: 'components/my-component.yaml',
            },
          }
        : {},
    }),
    'map-file-sha',
  );

  const outputLines: string[] = [];
  const diagnosticLines: string[] = [];
  return {
    api,
    repo,
    pulse: {
      output: (line: string) => void outputLines.push(line),
      diagnostic: (line: string) => void diagnosticLines.push(line),
    },
    outputLines,
    diagnosticLines,
  };
}

function request(
  harness: Harness,
  overrides: Partial<ClaimPublishRequest> = {},
): ClaimPublishRequest {
  return {
    repo: harness.repo,
    kind: 'ComponentClaim',
    name: 'my-component',
    output: CLAIM_YAML,
    path: 'claims/components/my-component.yaml',
    noWait: false,
    waitForChecks: false,
    ...overrides,
  };
}

describe('publishClaimAndWait', () => {
  it('rejects an existing claim on create', async () => {
    const harness = createHarness(true);

    await expect(
      publishClaimAndWait(request(harness, { rejectExistingClaim: true }), harness.pulse),
    ).rejects.toThrow('Claim already exists: ComponentClaim-my-component');
    expect(harness.api.committed).toEqual([]);
    expect(harness.outputLines).toEqual([CLAIM_YAML]);
  });

  it('publishes an edit of an existing claim', async () => {
    const harness = createHarness(true);

    const result = await publishClaimAndWait(
      request(harness, { existingSha: 'claim-sha' }),
      harness.pulse,
    );

    expect(result.publishUrl).toBe(
      'https://github.com/my-org/claims/actions/runs/1',
    );
    expect(harness.api.committed[0]).toEqual(
      expect.objectContaining({
        path: 'claims/components/my-component.yaml',
        content: CLAIM_YAML,
        sha: 'claim-sha',
      }),
    );
  });

  it('skips waiting when --no-wait is passed', async () => {
    const harness = createHarness();
    const outcome = await captureOutput(() =>
      publishClaimAndWait(request(harness, { noWait: true }), harness.pulse),
    );

    expect((outcome.result as ClaimPublishResult | undefined)?.publishUrl).toBe(
      'https://github.com/my-org/claims/actions/workflows/provision-claim.yaml',
    );
    expect(outcome.stderr).toBe(
      'Provision workflow dispatched (no-wait): https://github.com/my-org/claims/actions/workflows/provision-claim.yaml\n',
    );
    expect(
      harness.api.calls.some((call) =>
        call.startsWith('listWorkflowRuns my-org/claims:provision-claim.yaml'),
      ),
    ).toBe(false);
  });

  it('reports a failing workflow run with the exact wrapped message', async () => {
    const harness = createHarness();
    harness.api.autoCompleteConclusion = 'failure';

    const outcome = await captureOutput(() =>
      publishClaimAndWait(request(harness), harness.pulse),
    );

    expect(outcome.error?.message).toBe(
      'Provision wait failed: Provision failed (failure): https://github.com/my-org/claims/actions/runs/1',
    );
    expect(outcome.stderr).toBe('Provisioning...\n');
    expect(outcome.stdout).toBe(
      `${JSON.stringify({
        status: 'error',
        runUrl: 'https://github.com/my-org/claims/actions/runs/1',
        runId: 1,
        claimType: 'ComponentClaim',
        claimName: 'my-component',
        conclusion: 'failure',
      })}\n`,
    );
  });

  it('reports a timed-out workflow run', async () => {
    const harness = createHarness();
    harness.api.listWorkflowRuns = async () => [
      {
        id: 1,
        htmlUrl: 'https://github.com/my-org/claims/actions/runs/1',
        status: 'in_progress',
        conclusion: null,
        displayTitle: String(harness.api.dispatched[0].inputs.correlationId),
      },
    ];
    jest.useFakeTimers();
    try {
      const pending = captureOutput(() =>
        publishClaimAndWait(request(harness), harness.pulse),
      );
      await jest.advanceTimersByTimeAsync(1_200_000);
      const outcome = await pending;

      expect(outcome.error?.message).toBe(
        'Provision wait failed: Workflow timed out after 1200s',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails fast on a missing dispatch workflow with the wrapped message', async () => {
    const harness = createHarness();
    harness.api.listWorkflowRuns = async () => {
      throw Object.assign(new Error('Not Found'), { status: 404 });
    };

    const outcome = await captureOutput(() =>
      publishClaimAndWait(request(harness), harness.pulse),
    );

    expect(outcome.error?.message).toBe('Provision wait failed: Not Found');
    expect(outcome.stderr).not.toContain('run_not_found');
  });

  it('watches a passing wet PR', async () => {
    const harness = createHarness();
    harness.api.setPullRequests(STATE_REPO, [
      {
        number: 42,
        htmlUrl: 'https://github.com/my-org/state-github/pull/42',
        state: 'open',
        headRef: 'automated-component-my-component',
        baseSha: 'base-sha',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    harness.api.setCheckRuns(STATE_REPO, 42, [
      {
        name: 'plan',
        conclusion: 'success',
        status: 'completed',
        output: { title: null, summary: 'ok', text: null },
        htmlUrl: null,
      },
    ]);

    const result = await publishClaimAndWait(
      request(harness, {
        waitForChecks: true,
        stateRepos: 'my-org/state-github',
      }),
      harness.pulse,
    );

    expect(result.publishUrl).toBeDefined();
    expect(harness.diagnosticLines).toEqual([
      'Watching wet PR my-org/state-github#42...\n',
      'All checks passed ✓\n',
    ]);
  });

  it('fails when the wet PR checks fail', async () => {
    const harness = createHarness();
    harness.api.setPullRequests(STATE_REPO, [
      {
        number: 42,
        htmlUrl: 'https://github.com/my-org/state-github/pull/42',
        state: 'open',
        headRef: 'automated-component-my-component',
        baseSha: 'base-sha',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    harness.api.setCheckRuns(STATE_REPO, 42, [
      {
        name: 'apply',
        conclusion: 'failure',
        status: 'completed',
        output: { title: null, summary: 'bad', text: null },
        htmlUrl: null,
      },
    ]);

    await expect(
      publishClaimAndWait(
        request(harness, {
          waitForChecks: true,
          stateRepos: 'my-org/state-github',
        }),
        harness.pulse,
      ),
    ).rejects.toThrow('Wet PR checks failed: failure');
    expect(harness.diagnosticLines[0]).toBe(
      'Watching wet PR my-org/state-github#42...\n',
    );
  });

  it('skips the check watch when no wet PR exists', async () => {
    const harness = createHarness();

    await publishClaimAndWait(
      request(harness, {
        waitForChecks: true,
        stateRepos: 'my-org/state-github',
      }),
      harness.pulse,
    );

    expect(harness.diagnosticLines).toEqual([
      'No wet PR found for this claim; skipping check watch.\n',
    ]);
  });

  it('passes --state-repos through to the wet PR search', async () => {
    const harness = createHarness();

    await publishClaimAndWait(
      request(harness, {
        waitForChecks: true,
        stateRepos: 'custom/state-one',
      }),
      harness.pulse,
    );

    expect(harness.api.calls).toContain(
      'listOpenPullRequests custom/state-one:automated',
    );
    expect(
      harness.api.calls.some((call) => call.includes('state-github')),
    ).toBe(false);
  });
});
