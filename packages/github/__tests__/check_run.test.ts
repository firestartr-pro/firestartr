import { GithubCheckRun } from '../src/check_run';

describe('#github.check_run (direct)', () => {
  jest.useFakeTimers();

  const checksCreate = jest.fn();
  const checksUpdate = jest.fn();
  const issuesListComments = jest.fn()
  const issuesUpdateComment = jest.fn()
  const issuesCreateComment = jest.fn()
  const paginate = jest.fn();
  const pullsGet = jest.fn();
  const pullsUpdate = jest.fn();

  const octokit: any = {
    rest: {
      checks: {
        create: checksCreate,
        update: checksUpdate,
      },
      issues: {
        createComment: issuesCreateComment,
        listComments: issuesListComments,
        updateComment: issuesUpdateComment,
      },
      pulls: {
        get: pullsGet,
        update: pullsUpdate,
      },
    },
    paginate,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    checksCreate.mockResolvedValue({ data: { id: 12345 } });
    checksUpdate.mockResolvedValue({});

    issuesCreateComment.mockResolvedValue({ data: { id: 9001 } });
    issuesUpdateComment.mockResolvedValue({ data: { id: 9002 } });

    issuesListComments.mockResolvedValue({ data: [] });
    paginate.mockResolvedValue([] as any[]);

    pullsGet.mockResolvedValue({ data: { body: '' } });       // no marker initially
    pullsUpdate.mockResolvedValue({ data: {} });
  });

  it('should instantiate and close a check run (with PR comment)', async () => {
    const ch = new GithubCheckRun(octokit, {
      owner: 'acme',
      repo: 'repo',
      headSHA: 'abc123',
      name: 'Test Run',
      pullNumber: 42,
      includeCheckRunComment: true,
      checkRunComment: 'Check run started: ',
    });

    ch.mdOptionsDetails({ quotes: 'terraform' });
    ch.summary = 'starting';
    ch.update('hello\n', 'in_progress');

    await ch.close('\nfinal', true);

    expect(checksCreate).toHaveBeenCalledTimes(1);
    expect(checksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'repo',
        name: 'Test Run',
        head_sha: 'abc123',
        status: 'in_progress',
        output: expect.objectContaining({
          title: 'Test Run',
          summary: 'starting',
        }),
      })
    );

    expect(issuesCreateComment).toHaveBeenCalledTimes(1);
    const commentArgs = issuesCreateComment.mock.calls[0][0];
    expect(commentArgs).toMatchObject({
      owner: 'acme',
      repo: 'repo',
      issue_number: 42,
    });
    expect(commentArgs.body).toContain('Check run started: ');
    expect(commentArgs.body).toContain('/runs/12345');
    expect(commentArgs.body).toContain('sticky:kind=check-run:Test Run[0]');

    expect(checksUpdate).toHaveBeenCalled();
    const lastUpdate = checksUpdate.mock.calls[checksUpdate.mock.calls.length - 1][0];
    expect(lastUpdate).toMatchObject({
      owner: 'acme',
      repo: 'repo',
      check_run_id: 12345,
      conclusion: 'success',
      output: expect.objectContaining({
        title: 'Test Run',
        summary: 'starting',
      }),
    });
  });

  it('upserts the progress comment under the shared sticky base kind while running', async () => {
    const ch = new GithubCheckRun(octokit, {
      owner: 'acme',
      repo: 'repo',
      headSHA: 'abc123',
      name: 'FirestartrGithubRepository - apply',
      pullNumber: 42,
      includeCheckRunComment: true,
      checkRunComment:
        "The FirestartrGithubRepository 'example-repo' is being processed (cmd=apply). Details: ",
      stickyCommentBaseKind: 'apply:FirestartrGithubRepository:example-repo',
    });

    ch.update('hello\n', 'in_progress');

    // Let a periodic flush happen. We deliberately advance well past any
    // flush interval: the test asserts which comment is upserted while the
    // run is in progress, never the flush cadence itself.
    await jest.advanceTimersByTimeAsync(60000);

    expect(issuesCreateComment).toHaveBeenCalledTimes(1);
    const commentArgs = issuesCreateComment.mock.calls[0][0];
    expect(commentArgs.body).toContain(
      "The FirestartrGithubRepository 'example-repo' is being processed (cmd=apply). Details: ",
    );
    expect(commentArgs.body).toContain('/runs/12345');
    expect(commentArgs.body).toContain(
      'sticky:kind=apply:FirestartrGithubRepository:example-repo[0]',
    );

    await ch.close('\nfinal', true);

    // the check run itself still closes normally
    const lastUpdate = checksUpdate.mock.calls[checksUpdate.mock.calls.length - 1][0];
    expect(lastUpdate).toMatchObject({
      check_run_id: 12345,
      conclusion: 'success',
    });

    // but close() performs no sticky rewrite: the result publisher is the last word
    expect(issuesCreateComment).toHaveBeenCalledTimes(1);
    expect(issuesUpdateComment).not.toHaveBeenCalled();
  });

  it('performs no sticky comment write on close when a shared sticky base kind is set', async () => {
    const ch = new GithubCheckRun(octokit, {
      owner: 'acme',
      repo: 'repo',
      headSHA: 'abc123',
      name: 'FirestartrGithubRepository - destroy',
      pullNumber: 42,
      includeCheckRunComment: true,
      checkRunComment:
        "The FirestartrGithubRepository 'example-repo' is being processed (cmd=destroy). Details: ",
      stickyCommentBaseKind: 'destroy:FirestartrGithubRepository:example-repo',
    });

    ch.update('hello\n', 'in_progress');

    await ch.close('\nfinal', false);

    const lastUpdate = checksUpdate.mock.calls[checksUpdate.mock.calls.length - 1][0];
    expect(lastUpdate).toMatchObject({
      check_run_id: 12345,
      conclusion: 'failure',
    });

    expect(issuesCreateComment).not.toHaveBeenCalled();
    expect(issuesUpdateComment).not.toHaveBeenCalled();
  });
});
