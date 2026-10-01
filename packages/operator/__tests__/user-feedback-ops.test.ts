// Mock github inline inside the factory to avoid TDZ/hoisting problems.
jest.mock('github', () => {
  const mockFacadeAuthGetOctokitForOrg = jest.fn(async () => ({}));
  const mockFacadeFeedbackUpsert = jest.fn(async () => undefined);
  const mockFacadeFeedbackCreateCheckRun = jest.fn(async () => ({
    mdOptionsDetails: jest.fn(),
    update: jest.fn(),
    close: jest.fn(async () => undefined),
  }));

  const mockGithubDefault = {
    withProfile: jest.fn(() => ({
      auth: { getOctokitForOrg: mockFacadeAuthGetOctokitForOrg },
      feedback: {
        createCheckRun: mockFacadeFeedbackCreateCheckRun,
        upsertMultiPartStickyComments: mockFacadeFeedbackUpsert,
      },
      pulls: {
        divideCommentIntoChunks: jest.fn((comment: string) => [comment]),
        commentInPR: jest.fn(async () => undefined),
      },
    })),
    pulls: { divideCommentIntoChunks: jest.fn((comment: string) => [comment]) },
  };

  return {
    __esModule: true,
    default: mockGithubDefault,
    // expose internals so the test can assert calls
    __mocks: {
      mockFacadeAuthGetOctokitForOrg,
      mockFacadeFeedbackUpsert,
      mockFacadeFeedbackCreateCheckRun,
      mockGithubDefault,
    },
  };
});

jest.mock('catalog_common', () => ({
  __esModule: true,
  default: {
    generic: {
      getOwnerRepoPrNumberFromAnnotationValue: jest.fn((annotationValue: string) => {
        const match = annotationValue.match(/^([^/]+)\/([^#]+)#(\d+)$/);
        if (!match) throw new Error(`Incorrect format for annotation value: ${annotationValue}`);
        return { owner: match[1], repo: match[2], prNumber: Number(match[3]) };
      }),
    },
  },
}));

jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    verbose: jest.fn(),
    silly: jest.fn(),
  },
}));

// Require the module object so we can access the __mocks property exposed by
// the jest.mock factory above. Using require here returns the full module
// object (the factory return value), whereas `import github from 'github'`
// gives only the default export (mockGithubDefault) and would not expose
// the helper __mocks container.
const gh = require('github');

import log from '../src/logger';

import {
  publishPlan,
  tryPublishApply,
  tryPublishDestroy,
} from '../src/user-feedback-ops/user-feedback-ops';

import { TFCheckRun } from '../src/user-feedback-ops/tf-checkrun';

// Extract the inner mock functions for assertions from the module object
const mockFacadeAuthGetOctokitForOrg: jest.Mock = gh.__mocks.mockFacadeAuthGetOctokitForOrg;
const mockFacadeFeedbackUpsert: jest.Mock = gh.__mocks.mockFacadeFeedbackUpsert;
const mockFacadeFeedbackCreateCheckRun: jest.Mock = gh.__mocks.mockFacadeFeedbackCreateCheckRun;

describe("User feedback ops", () => {

  const item = {
    kind: "FirestartrGithubRepository",
    metadata: {
      name: "example-repo",
      annotations: {
        "firestartr.dev/last-state-pr": "prefapp/example-repo#42",
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("publishes destroy feedback using the PR info from the annotation", async () => {
    await tryPublishDestroy(item, "Destroy complete!", true);

    expect(mockFacadeAuthGetOctokitForOrg).toHaveBeenCalledWith("prefapp");
    expect(mockFacadeFeedbackUpsert).toHaveBeenCalledWith(
      {},
      {
        owner: "prefapp",
        repo: "example-repo",
        pullNumber: 42,
        baseKind: 'destroy:FirestartrGithubRepository:example-repo',
        bodies: [expect.stringContaining('Destroy Succeeded ✅')],
      },
    );
  });

  it("skips destroy feedback when the annotation is missing", async () => {
    const itemWithoutAnnotation = {
      ...item,
      metadata: {
        ...item.metadata,
        annotations: {},
      },
    };

    await expect(
      tryPublishDestroy(itemWithoutAnnotation, "Destroy complete!", true),
    ).resolves.toBeUndefined();

    expect(mockFacadeAuthGetOctokitForOrg).not.toHaveBeenCalled();
    expect(mockFacadeFeedbackUpsert).not.toHaveBeenCalled();
  });

  it("skips destroy feedback when the annotation is invalid", async () => {
    const itemWithInvalidAnnotation = {
      ...item,
      metadata: {
        ...item.metadata,
        annotations: {
          "firestartr.dev/last-state-pr": "prefapp/example-repo",
        },
      },
    };

    await expect(
      tryPublishDestroy(itemWithInvalidAnnotation, "Destroy complete!", true),
    ).resolves.toBeUndefined();

    expect(mockFacadeAuthGetOctokitForOrg).not.toHaveBeenCalled();
    expect(mockFacadeFeedbackUpsert).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("has invalid annotation"),
    );
  });

  it('publishes the apply result under the per-resource base kind', async () => {
    await tryPublishApply(item, 'Apply complete!', true, 0);

    expect(mockFacadeFeedbackUpsert).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        owner: 'prefapp',
        repo: 'example-repo',
        pullNumber: 42,
        baseKind: 'apply:FirestartrGithubRepository:example-repo',
      }),
    );
  });

  it('marks apply as failed when terraform exits non-zero', async () => {
    await tryPublishApply(item, 'Error: Missing attribute separator', true, 1);

    const upsertMock = mockFacadeFeedbackUpsert as jest.Mock;
    const [, params] = upsertMock.mock.calls[0];

    expect(params.bodies[0]).toContain("Apply Failed ❌");
  });

  it("keeps apply as succeeded when terraform exits zero", async () => {
    await tryPublishApply(item, "Apply complete!", true, 0);

    const upsertMock = mockFacadeFeedbackUpsert as jest.Mock;
    const [, params] = upsertMock.mock.calls[0];

    expect(params.bodies[0]).toContain("Apply Succeeded ✅");
  });

  it("keeps apply as succeeded when exit code is omitted", async () => {
    await tryPublishApply(item, "Apply complete!", true);

    const upsertMock = mockFacadeFeedbackUpsert as jest.Mock;
    const [, params] = upsertMock.mock.calls[0];

    expect(params.bodies[0]).toContain("Apply Succeeded ✅");
  });

  it("keeps explicit failures failed even with a zero exit code", async () => {
    await tryPublishApply(item, "apply failed", false, 0);

    const upsertMock = mockFacadeFeedbackUpsert as jest.Mock;
    const [, params] = upsertMock.mock.calls[0];

    expect(params.bodies[0]).toContain("Apply Failed ❌");
  });

  it("publishes plan feedback with resource-specific sticky comments", async () => {
    await publishPlan(item, "plan complete", 42, "example-repo", "prefapp");

    expect(mockFacadeFeedbackUpsert).toHaveBeenCalledWith(
      {},
      {
        owner: "prefapp",
        repo: "example-repo",
        pullNumber: 42,
        baseKind: "firestartrgithubrepository:example-repo:plan",
        bodies: [expect.stringContaining("FirestartrGithubRepository")],
      },
    );
  });

  it("publishes plan feedback using generateName when metadata.name is missing", async () => {
    await publishPlan(
      {
        kind: "FirestartrGithubRepository",
        metadata: {
          generateName: "generated-repo-",
        },
      },
      "plan complete",
      42,
      "example-repo",
      "prefapp",
    );

    expect(mockFacadeFeedbackUpsert).toHaveBeenCalledWith(
      {},
      {
        owner: "prefapp",
        repo: "example-repo",
        pullNumber: 42,
        baseKind: "firestartrgithubrepository:generated-repo-:plan",
        bodies: [expect.stringContaining("generated-repo-")],
      },
    );
  });

  it("can disambiguate plan feedback by operation and source", async () => {
    await publishPlan(
      item,
      "plan complete",
      42,
      "example-repo",
      "prefapp",
      true,
      "plan-destroy",
      "repo.yaml",
    );

    expect(mockFacadeFeedbackUpsert).toHaveBeenCalledWith(
      {},
      {
        owner: "prefapp",
        repo: "example-repo",
        pullNumber: 42,
        baseKind:
          "firestartrgithubrepository:example-repo:plan-destroy:repo.yaml",
        bodies: [expect.stringContaining("FirestartrGithubRepository")],
      },
    );

    const upsertMock = mockFacadeFeedbackUpsert as jest.Mock;
    const [, params] = upsertMock.mock.calls[0];

    expect(params.bodies[0]).toContain("Plan-Destroy Succeeded ✅");
  });

  it('creates the apply check run with the apply progress comment', async () => {
    await TFCheckRun('apply', item);

    expect(mockFacadeFeedbackCreateCheckRun).toHaveBeenCalledWith(
      'prefapp',
      'example-repo',
      'FirestartrGithubRepository - apply',
      expect.objectContaining({
        pullNumber: 42,
        includeCheckRunComment: true,
        checkRunComment:
          "The FirestartrGithubRepository 'example-repo' is being processed (cmd=apply). Details: ",
        stickyCommentBaseKind: 'apply:FirestartrGithubRepository:example-repo',
      }),
    );
  });

  it('creates the destroy check run with the apply progress comment', async () => {
    await TFCheckRun('destroy', item);

    expect(mockFacadeFeedbackCreateCheckRun).toHaveBeenCalledWith(
      'prefapp',
      'example-repo',
      'FirestartrGithubRepository - destroy',
      expect.objectContaining({
        pullNumber: 42,
        includeCheckRunComment: true,
        checkRunComment:
          "The FirestartrGithubRepository 'example-repo' is being processed (cmd=destroy). Details: ",
        stickyCommentBaseKind: 'destroy:FirestartrGithubRepository:example-repo',
      }),
    );
  });

  it('shares one per-resource base kind between check-run creation and result publishing', async () => {
    await TFCheckRun('apply', item);
    await tryPublishApply(item, 'Apply complete!', true, 0);

    const checkRunBaseKind = (mockFacadeFeedbackCreateCheckRun as jest.Mock)
      .mock.calls[0][3].stickyCommentBaseKind;
    const resultBaseKind = (mockFacadeFeedbackUpsert as jest.Mock).mock
      .calls[0][1].baseKind;

    expect(checkRunBaseKind).toBe('apply:FirestartrGithubRepository:example-repo');
    expect(resultBaseKind).toBe(checkRunBaseKind);

    await TFCheckRun('destroy', item);
    await tryPublishDestroy(item, 'Destroy complete!', true);

    const destroyCheckRunBaseKind = (
      mockFacadeFeedbackCreateCheckRun as jest.Mock
    ).mock.calls[1][3].stickyCommentBaseKind;
    const destroyResultBaseKind = (mockFacadeFeedbackUpsert as jest.Mock).mock
      .calls[1][1].baseKind;

    expect(destroyCheckRunBaseKind).toBe(
      'destroy:FirestartrGithubRepository:example-repo',
    );
    expect(destroyResultBaseKind).toBe(destroyCheckRunBaseKind);
  });
});
