import { afterEach, describe, expect, it } from '@jest/globals';

import { claimsRepo } from '../src/claims/claimsRepo';
import { withAuditTrail } from '../src/mutations/auditIssue';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { AuditTrail, AuditTrailOptions } from '../src/mutations/auditIssue';

const HEAD = 'fs-forge/ComponentClaim-my-component';
const BASE = 'main';
const RUN_URL = 'https://github.com/my-org/claims/actions/runs/9';

function open(options: AuditTrailOptions = {}) {
  const api = new MemoryGitHubApi();
  const repo = claimsRepo(api, 'my-org');
  const run = <T>(step: (trail: AuditTrail) => Promise<T>) =>
    withAuditTrail(
      {
        repo,
        operation: 'create',
        kind: 'ComponentClaim',
        name: 'my-component',
      },
      options,
      step,
    );
  return { api, repo, run };
}

const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = ORIGINAL_TOKEN;
  }
});

describe('withAuditTrail', () => {
  it('stays out of the way when neither --issue nor --create-issue is set', async () => {
    const { api, run } = open();

    const result = await run(async (trail) => {
      await trail.linkPullRequest({ head: HEAD, base: BASE });
      await trail.commentRunUrl(RUN_URL);
      await trail.closeIssue();
      return trail.result();
    });

    expect(result).toEqual({});
    expect(api.calls).toEqual([]);
    expect(api.issues).toEqual([]);
    expect(api.createdPulls).toEqual([]);
  });

  it('adopts the --issue number instead of opening a new issue', async () => {
    const { api, run } = open({ issue: 7 });

    const result = await run(async (trail) => trail.result());

    expect(api.calls).toEqual([]);
    expect(result).toEqual({
      issue: { number: 7, url: 'https://github.com/my-org/claims/issues/7' },
    });
  });

  it('rejects an --issue number that cannot exist before the step runs', async () => {
    const { api, run } = open({ issue: 0 });
    let stepped = false;

    await expect(
      run(async () => {
        stepped = true;
      }),
    ).rejects.toThrow('--issue must be a positive issue number');
    expect(stepped).toBe(false);
    expect(api.calls).toEqual([]);
  });

  it('opens the audit issue before the step starts', async () => {
    const { api, run } = open({ createIssue: true });

    await run(async () => {
      expect(api.issues).toHaveLength(1);
    });

    expect(api.issues[0].state).toBe('open');
  });

  it('opens the audit issue from the built-in template', async () => {
    const { api, run } = open({ createIssue: true });

    const result = await run(async (trail) => trail.result());

    expect(api.issues[0].title).toBe('Create component my-component');
    expect(api.issues[0].body).toContain('## Goal');
    expect(api.issues[0].body).toContain('## Requested change');
    expect(api.issues[0].body).toContain('ComponentClaim');
    expect(api.issues[0].body).toContain('my-component');
    expect(api.issues[0].body).toContain('my-org/claims');
    expect(result).toEqual({
      issue: { number: 1, url: 'https://github.com/my-org/claims/issues/1' },
    });
  });

  it('opens the claims PR with a Closes footer for the issue', async () => {
    const { api, run } = open({ issue: 7 });

    const result = await run(async (trail) => {
      await trail.linkPullRequest({ head: HEAD, base: BASE });
      return trail.result();
    });

    expect(api.createdPulls).toEqual([
      expect.objectContaining({
        head: HEAD,
        base: BASE,
        title: 'ci: provision claim ComponentClaim/my-component',
        body: 'Closes #7',
      }),
    ]);
    expect(result.pr).toEqual({
      number: 1,
      url: 'https://github.com/my-org/claims/pull/1',
    });
  });

  it('appends the footer to an existing claim PR instead of opening another', async () => {
    const { api, repo, run } = open({ createIssue: true });
    api.setPullRequests(repo.ref, [
      {
        number: 42,
        htmlUrl: 'https://github.com/my-org/claims/pull/42',
        state: 'open',
        headRef: HEAD,
        baseSha: BASE,
        updatedAt: '2026-01-01T00:00:00Z',
        body: 'Provision flow',
      },
    ]);

    const result = await run(async (trail) => {
      await trail.linkPullRequest({ head: HEAD, base: BASE });
      return trail.result();
    });

    expect(api.createdPulls).toEqual([]);
    expect(api.pullBodyUpdates).toEqual([
      { ref: repo.ref, pr: 42, body: 'Provision flow\n\nCloses #1' },
    ]);
    expect(result.pr).toEqual({
      number: 42,
      url: 'https://github.com/my-org/claims/pull/42',
    });
  });

  it('leaves an existing footer alone', async () => {
    const { api, repo, run } = open({ issue: 7 });
    api.setPullRequests(repo.ref, [
      {
        number: 42,
        htmlUrl: 'https://github.com/my-org/claims/pull/42',
        state: 'open',
        headRef: HEAD,
        baseSha: BASE,
        updatedAt: '2026-01-01T00:00:00Z',
        body: 'Provision flow\n\nCloses #7',
      },
    ]);

    await run(async (trail) => trail.linkPullRequest({ head: HEAD, base: BASE }));

    expect(api.pullBodyUpdates).toEqual([]);
  });

  it('comments the workflow run url on the issue', async () => {
    const { api, repo, run } = open({ createIssue: true });

    await run(async (trail) => {
      await trail.commentRunUrl(RUN_URL);
    });

    expect(api.issueComments).toEqual([
      { ref: repo.ref, issue: 1, body: `Workflow run: ${RUN_URL}` },
    ]);
  });

  it('closes the issue when the run concluded', async () => {
    const { api, run } = open({ createIssue: true });

    await run(async (trail) => {
      await trail.closeIssue();
    });

    expect(api.issues[0].state).toBe('closed');
  });

  it('comments a failure on a created issue and leaves it open', async () => {
    const { api, run } = open({ createIssue: true });

    await expect(
      run(async () => {
        throw new Error('Branch already exists: fs-forge/x');
      }),
    ).rejects.toThrow('Branch already exists');

    expect(api.issues[0].state).toBe('open');
    expect(api.issueComments).toHaveLength(1);
    expect(api.issueComments[0].body).toContain('Branch already exists');
    expect(api.issueComments[0].body).toContain('ComponentClaim-my-component');
    expect(api.calls).not.toContain('closeIssue my-org/claims#1');
  });

  it('reopens a closed audit issue after commenting the failure', async () => {
    const { api, repo, run } = open({ createIssue: true });

    await expect(
      run(async () => {
        await api.closeIssue(repo.ref, 1);
        throw new Error('wet checks failed');
      }),
    ).rejects.toThrow('wet checks failed');

    expect(api.issueComments[0].body).toContain('wet checks failed');
    expect(api.issues[0].state).toBe('open');
    expect(api.calls.indexOf('reopenIssue my-org/claims#1')).toBeGreaterThan(
      api.calls.indexOf('commentOnIssue my-org/claims#1'),
    );
  });

  it('never writes a token into the failure comment', async () => {
    process.env.GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const { api, run } = open({ createIssue: true });

    await expect(
      run(async () => {
        throw new Error(
          `Bad credentials: ${process.env.GITHUB_TOKEN} and github_pat_11ABCDEFG0123456789`,
        );
      }),
    ).rejects.toThrow('Bad credentials');

    const comment = api.issueComments[0].body;
    expect(comment).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(comment).not.toContain('github_pat_11ABCDEFG0123456789');
    expect(comment).toContain('***');
  });

  it('comments a failure on an adopted issue and leaves it open', async () => {
    const { api, repo, run } = open({ issue: 1 });
    await api.createIssue(repo.ref, { title: 'Existing issue', body: '' });

    await expect(
      run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(api.issueComments).toEqual([
      expect.objectContaining({
        issue: 1,
        body: 'The create of ComponentClaim-my-component failed.\n\nboom',
      }),
    ]);
    expect(api.issues[0].state).toBe('open');
  });

  it('does not mask the original error when reopening fails', async () => {
    const { api, run } = open({ createIssue: true });
    api.reopenIssue = async () => {
      throw new Error('network down');
    };

    const original = new Error('original failure');
    await expect(run(async () => { throw original; })).rejects.toBe(original);
    expect(api.issueComments[0].body).toContain('original failure');
  });

  it('does not mask the original error when the failure comment fails', async () => {
    const { api, repo, run } = open({ createIssue: true });
    api.commentOnIssue = async () => {
      throw new Error('network down');
    };

    await expect(
      run(async () => {
        await api.closeIssue(repo.ref, 1);
        throw new Error('original failure');
      }),
    ).rejects.toThrow('original failure');
    expect(api.issues[0].state).toBe('open');
  });
});
