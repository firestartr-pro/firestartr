import { upsertMultiPartStickyComments } from '../src/sticky_comment';

describe('#github.sticky_comment', () => {
  const pullsGet = jest.fn();
  const pullsUpdate = jest.fn();
  const issuesListComments = jest.fn();
  const issuesUpdateComment = jest.fn();
  const issuesCreateComment = jest.fn();

  const octokit: any = {
    rest: {
      pulls: {
        get: pullsGet,
        update: pullsUpdate,
      },
      issues: {
        listComments: issuesListComments,
        updateComment: issuesUpdateComment,
        createComment: issuesCreateComment,
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    pullsGet.mockResolvedValue({ data: { body: '' } });
    pullsUpdate.mockResolvedValue({ data: {} });
    issuesListComments.mockResolvedValue({ data: [] });
    issuesUpdateComment.mockResolvedValue({ data: {} });
    issuesCreateComment.mockResolvedValue({ data: { id: 456 } });
  });

  it('updates an existing sticky comment found by body marker when PR body has no id marker', async () => {
    issuesListComments.mockResolvedValue({
      data: [
        {
          id: 123,
          body: 'old body\n\n<!-- sticky:kind=plan:resource[0] -->',
        },
      ],
    });

    await upsertMultiPartStickyComments(octokit, {
      owner: 'prefapp',
      repo: 'state-github',
      pullNumber: 42,
      baseKind: 'plan:resource',
      bodies: ['new body'],
    });

    expect(issuesUpdateComment).toHaveBeenCalledWith({
      owner: 'prefapp',
      repo: 'state-github',
      comment_id: 123,
      body: 'new body\n\n<!-- sticky:kind=plan:resource[0] -->',
    });
    expect(issuesCreateComment).not.toHaveBeenCalled();
    expect(pullsUpdate).toHaveBeenCalledWith({
      owner: 'prefapp',
      repo: 'state-github',
      pull_number: 42,
      body: '<!-- sticky-id:plan:resource[0]=123 -->',
    });
  });
});
