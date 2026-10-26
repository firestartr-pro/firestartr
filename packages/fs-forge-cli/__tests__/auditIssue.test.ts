import { afterEach, describe, expect, it } from '@jest/globals';

import { claimsRepo } from '../src/claims/claimsRepo';
import { createAuditTrail } from '../src/mutations/auditIssue';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { AuditIssueOptions } from '../src/mutations/auditIssue';

const HEAD = 'fs-forge/ComponentClaim-my-component';
const BASE = 'main';

function setup(
  options: AuditIssueOptions = {},
  operation: 'create' | 'edit' | 'delete' = 'create',
) {
  const api = new MemoryGitHubApi();
  const repo = claimsRepo(api, 'my-org');
  const trail = createAuditTrail(
    { repo, operation, kind: 'ComponentClaim', name: 'my-component' },
    options,
  );
  return { api, repo, trail };
}

const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = ORIGINAL_TOKEN;
  }
});

describe('createAuditTrail', () => {
  it('stays out of the way when neither --issue nor --create-issue is set', async () => {
    const { api, trail } = setup();

    await trail.begin();
    await trail.linkPullRequest({ head: HEAD, base: BASE });
    await trail.commentRunUrl('https://github.com/my-org/claims/actions/runs/1');
    await trail.closeIssue();
    await trail.fail(new Error('boom'));

    expect(api.calls).toEqual([]);
    expect(api.issues).toEqual([]);
    expect(api.createdPulls).toEqual([]);
    expect(trail.result()).toEqual({});
  });

  it('adopts the --issue number instead of opening a new issue', async () => {
    const { api, trail } = setup({ issue: 7 });

    await trail.begin();

    expect(api.calls).toEqual([]);
    expect(trail.result()).toEqual({
      issue: { number: 7, url: 'https://github.com/my-org/claims/issues/7' },
    });
  });

  it('opens the audit issue from the built-in template', async () => {
    const { api, trail } = setup({ createIssue: true });

    await trail.begin();

    expect(api.issues).toHaveLength(1);
    expect(api.issues[0].title).toBe('Create component my-component');
    expect(api.issues[0].body).toContain('## Goal');
    expect(api.issues[0].body).toContain('## Requested change');
    expect(api.issues[0].body).toContain('ComponentClaim');
    expect(api.issues[0].body).toContain('my-component');
    expect(api.issues[0].body).toContain('my-org/claims');
    expect(api.issues[0].state).toBe('open');
    expect(trail.result()).toEqual({
      issue: { number: 1, url: 'https://github.com/my-org/claims/issues/1' },
    });
  });

  it('lets --issue-title and --issue-body override the template', async () => {
    const { api, trail } = setup({
      createIssue: true,
      issueTitle: 'Ship my-component',
      issueBody: 'the client wants it',
    });

    await trail.begin();

    expect(api.issues[0].title).toBe('Ship my-component');
    expect(api.issues[0].body).toBe('the client wants it');
  });

  it('opens the claims PR with a Closes footer for the issue', async () => {
    const { api, trail } = setup({ issue: 7 });
    await trail.begin();

    await trail.linkPullRequest({ head: HEAD, base: BASE });

    expect(api.createdPulls).toHaveLength(1);
    expect(api.createdPulls[0]).toEqual(
      expect.objectContaining({
        head: HEAD,
        base: BASE,
        title: 'ci: provision claim ComponentClaim/my-component',
        body: 'Closes #7',
      }),
    );
    expect(trail.result().pr).toEqual({
      number: 1,
      url: 'https://github.com/my-org/claims/pull/1',
    });
  });

  it('appends the footer to an existing claim PR instead of opening another', async () => {
    const { api, repo, trail } = setup({ createIssue: true });
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
    await trail.begin();

    await trail.linkPullRequest({ head: HEAD, base: BASE });

    expect(api.createdPulls).toEqual([]);
    expect(api.pullBodyUpdates).toEqual([
      { ref: repo.ref, pr: 42, body: 'Provision flow\n\nCloses #1' },
    ]);
    expect(trail.result().pr).toEqual({
      number: 42,
      url: 'https://github.com/my-org/claims/pull/42',
    });
  });

  it('leaves an existing footer alone', async () => {
    const { api, repo, trail } = setup({ issue: 7 });
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
    await trail.begin();

    await trail.linkPullRequest({ head: HEAD, base: BASE });

    expect(api.pullBodyUpdates).toEqual([]);
    expect(trail.result().pr).toEqual({
      number: 42,
      url: 'https://github.com/my-org/claims/pull/42',
    });
  });

  it('comments the workflow run url on the issue', async () => {
    const { api, repo, trail } = setup({ createIssue: true });
    await trail.begin();

    await trail.commentRunUrl('https://github.com/my-org/claims/actions/runs/9');

    expect(api.issueComments).toEqual([
      {
        ref: repo.ref,
        issue: 1,
        body: 'Workflow run: https://github.com/my-org/claims/actions/runs/9',
      },
    ]);
  });

  it('closes the issue when the run concluded', async () => {
    const { api, trail } = setup({ createIssue: true });
    await trail.begin();

    await trail.closeIssue();

    expect(api.issues[0].state).toBe('closed');
  });

  it('comments a failure on a created issue and leaves it open', async () => {
    const { api, trail } = setup({ createIssue: true });
    await trail.begin();

    await trail.fail(new Error('Branch already exists: fs-forge/x'));

    expect(api.issues[0].state).toBe('open');
    expect(api.issueComments).toHaveLength(1);
    expect(api.issueComments[0].body).toContain('Branch already exists');
    expect(api.issueComments[0].body).toContain('ComponentClaim-my-component');
    expect(api.calls).not.toContain('closeIssue my-org/claims#1');
  });

  it('never writes a token into the failure comment', async () => {
    process.env.GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const { api, trail } = setup({ createIssue: true });
    await trail.begin();

    await trail.fail(
      new Error(
        `Bad credentials: ${process.env.GITHUB_TOKEN} and github_pat_11ABCDEFG0123456789`,
      ),
    );

    const comment = api.issueComments[0].body;
    expect(comment).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(comment).not.toContain('github_pat_11ABCDEFG0123456789');
    expect(comment).toContain('***');
  });

  it('does not comment a failure on an adopted issue', async () => {
    const { api, trail } = setup({ issue: 7 });
    await trail.begin();

    await trail.fail(new Error('boom'));

    expect(api.issueComments).toEqual([]);
  });

  it('does not mask the original error when the failure comment fails', async () => {
    const { api, trail } = setup({ createIssue: true });
    api.commentOnIssue = async () => {
      throw new Error('network down');
    };
    await trail.begin();

    await expect(trail.fail(new Error('original failure'))).resolves.toBeUndefined();
  });
});
