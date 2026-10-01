jest.mock("../src/ctl", () => ({
  __esModule: true,
  getItemByItemPath: jest.fn(),
  writeStatus: jest.fn(),
}));

jest.mock("../src/logger", () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    silly: jest.fn(),
    warn: jest.fn(),
  },
}));

import { getItemByItemPath, writeStatus } from "../src/ctl";
import { updateRetryStatusInCR } from "../src/status";

const getItemByItemPathMock = getItemByItemPath as jest.MockedFunction<
  typeof getItemByItemPath
>;
const writeStatusMock = writeStatus as jest.MockedFunction<typeof writeStatus>;

describe("updateRetryStatusInCR", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes retry status when the custom resource exists", async () => {
    const item = resource({
      conditions: [],
      nextRetryTime: "2026-06-10T09:00:00.000Z",
    });

    getItemByItemPathMock.mockResolvedValue(item);
    writeStatusMock.mockResolvedValue({});

    await updateRetryStatusInCR(
      "firestartrgithubrepositories",
      "default",
      "repo-a",
      2,
    );

    expect(getItemByItemPath).toHaveBeenCalledWith(
      "default/firestartrgithubrepositories/repo-a",
    );
    expect(writeStatus).toHaveBeenCalledWith(
      "firestartrgithubrepositories",
      "default",
      expect.objectContaining({
        status: expect.objectContaining({
          highPriorityReason: "AwaitingReconciliation",
          highPriorityState: "UNKNOWN",
          retryCount: 2,
        }),
      }),
    );
    expect(item.status.nextRetryTime).toBeUndefined();
  });

  it("ignores NotFound while fetching the custom resource", async () => {
    getItemByItemPathMock.mockRejectedValue(
      new Error(
        "Error on getItemByItemPath: default/firestartrgithubrepositories/repo-a: Not Found",
      ),
    );

    await expect(
      updateRetryStatusInCR(
        "firestartrgithubrepositories",
        "default",
        "repo-a",
        1,
      ),
    ).resolves.toBeUndefined();

    expect(writeStatus).not.toHaveBeenCalled();
  });

  it("ignores NotFound while writing the custom resource status", async () => {
    getItemByItemPathMock.mockResolvedValue(resource({ conditions: [] }));
    writeStatusMock.mockRejectedValue(
      Object.assign(new Error("Not Found"), {
        statusCode: 404,
      }),
    );

    await expect(
      updateRetryStatusInCR(
        "firestartrgithubrepositories",
        "default",
        "repo-a",
        1,
        "2026-06-10T10:00:00.000Z",
      ),
    ).resolves.toBeUndefined();
  });

  it("ignores NotFound via statusCode on error object", async () => {
    getItemByItemPathMock.mockRejectedValue(
      Object.assign(new Error("some error"), { statusCode: 404 }),
    );

    await expect(
      updateRetryStatusInCR(
        "firestartrgithubrepositories",
        "default",
        "repo-a",
        1,
      ),
    ).resolves.toBeUndefined();
  });

  it("ignores NotFound via JSON string body with code 404", async () => {
    getItemByItemPathMock.mockResolvedValue(resource({ conditions: [] }));
    writeStatusMock.mockRejectedValue(
      Object.assign(new Error("some error"), {
        body: JSON.stringify({ code: 404, reason: "NotFound" }),
      }),
    );

    await expect(
      updateRetryStatusInCR(
        "firestartrgithubrepositories",
        "default",
        "repo-a",
        1,
      ),
    ).resolves.toBeUndefined();
  });

  it("ignores NotFound via JSON string body with reason NotFound", async () => {
    getItemByItemPathMock.mockResolvedValue(resource({ conditions: [] }));
    writeStatusMock.mockRejectedValue(
      Object.assign(new Error("some error"), {
        body: JSON.stringify({ reason: "NotFound" }),
      }),
    );

    await expect(
      updateRetryStatusInCR(
        "firestartrgithubrepositories",
        "default",
        "repo-a",
        1,
      ),
    ).resolves.toBeUndefined();
  });

  it("ignores NotFound when error body is invalid JSON (graceful fallback)", async () => {
    getItemByItemPathMock.mockResolvedValue(resource({ conditions: [] }));
    writeStatusMock.mockRejectedValue(
      Object.assign(new Error("Not Found"), {
        body: "not valid json",
      }),
    );

    await expect(
      updateRetryStatusInCR(
        "firestartrgithubrepositories",
        "default",
        "repo-a",
        1,
      ),
    ).resolves.toBeUndefined();
  });

  it("rethrows non-NotFound errors while fetching the custom resource", async () => {
    const error = new Error("API unavailable");

    getItemByItemPathMock.mockRejectedValue(error);

    await expect(
      updateRetryStatusInCR(
        "firestartrgithubrepositories",
        "default",
        "repo-a",
        1,
      ),
    ).rejects.toBe(error);
  });

  it("rethrows non-NotFound errors while writing the custom resource status", async () => {
    const error = new Error("status conflict");

    getItemByItemPathMock.mockResolvedValue(resource({ conditions: [] }));
    writeStatusMock.mockRejectedValue(error);

    await expect(
      updateRetryStatusInCR(
        "firestartrgithubrepositories",
        "default",
        "repo-a",
        1,
      ),
    ).rejects.toBe(error);
  });

  it("detects NotFound when response.status is 404", async () => {
    getItemByItemPathMock.mockRejectedValue(
      Object.assign(new Error("some error"), { response: { status: 404 } }),
    );

    await expect(
      updateRetryStatusInCR(
        "firestartrgithubrepositories",
        "default",
        "repo-a",
        1,
      ),
    ).resolves.toBeUndefined();
  });
});

function resource(status: Record<string, unknown>) {
  return {
    kind: "FirestartrGithubRepository",
    metadata: {
      name: "repo-a",
      namespace: "default",
    },
    status,
  };
}
