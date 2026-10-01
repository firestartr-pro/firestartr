jest.mock("terraform_provisioner", () => ({
  __esModule: true,
  runTerraformProvisioner: jest.fn(),
}));

jest.mock("../src/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../src/ctl", () => ({
  __esModule: true,
  addDestroyCommitStatus: jest.fn(),
  addPlanStatusCheck: jest.fn(),
}));

jest.mock("../src/user-feedback-ops/tf-checkrun", () => ({
  __esModule: true,
  TFCheckRun: jest.fn(async () => ({
    fnData: jest.fn(),
    fnEnd: jest.fn(),
    fnOnError: jest.fn(),
  })),
}));

jest.mock("../src/user-feedback-ops/user-feedback-ops", () => ({
  __esModule: true,
  tryPublishApply: jest.fn(),
  tryPublishDestroy: jest.fn(),
  tryPublishError: jest.fn(),
  tryCreateErrorSummary: jest.fn(),
}));

jest.mock("../src/utils", () => ({
  __esModule: true,
  extractErrorDetails: jest.fn((error: any) => ({
    output: error?.message || String(error),
    exitCode: 1,
  })),
  replaceConfigSecrets: jest.fn((data: any) => data),
  replaceInlineSecrets: jest.fn((data: any) => data),
}));

import { OperationType } from "../src/informer";
import { runTerraformProvisioner } from "terraform_provisioner";
import log from "../src/logger";
import {
  buildProvisionerContext,
  processOperation,
} from "../src/tfworkspaces/process-operation";

const mockRun = runTerraformProvisioner as jest.Mock;
const doApply = processOperation;

function mockItem(overrides: any = {}) {
  return {
    kind: "FirestartrTerraformWorkspace",
    metadata: {
      name: "test-workspace",
      namespace: "test-ns",
      annotations: {
        "firestartr.dev/policy": "full-control",
      },
    },
    spec: {
      source: "Inline",
      module: 'resource "test" {}',
      values: '{"key": "value"}',
      context: {
        providers: [],
        backend: { ref: { name: "test-backend" } },
      },
      firestartr: { tfStateKey: "test-key" },
      references: [],
      ...overrides,
    },
  };
}

function mockHandler(overrides: any = {}) {
  return {
    resolveReferences: jest.fn(async () => ({
      "FirestartrProviderConfig-test-backend": {
        cr: {
          metadata: { name: "test-backend" },
          spec: {
            type: "s3",
            config: "{}",
            inline: "",
            source: "test",
            version: "1.0",
          },
        },
      },
    })),
    writeConnectionSecret: jest.fn(),
    writeTerraformOutputInTfResult: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    getSlotInfo: jest.fn(() => ({ slotId: 42 })),
    recommendedTimeout: jest.fn(() => 300000),
    finalize: jest.fn(),
    pluralKind: "firestartrterraformworkspaces",
    informPlan: jest.fn(),
    deleteSecret: jest.fn(),
    resolveOwnOutputs: jest.fn(),
    ...overrides,
  };
}

async function collectGenerator(
  gen: AsyncGenerator<any, void, unknown>,
): Promise<any[]> {
  const results: any[] = [];
  for await (const val of gen) {
    results.push(val);
  }
  return results;
}

describe("buildProvisionerContext", () => {
  it("uses session-scoped projectPath when sessionId is provided", async () => {
    const item = mockItem();
    const handler = mockHandler();
    const deps = await handler.resolveReferences();
    const ctx = buildProvisionerContext(item, deps, "abc1");

    expect(ctx.projectPath).toBe(
      "/tmp/tfworkspaces/firestartrterraformworkspace-test-workspace-abc1",
    );
  });

  it("uses tfStateKey-based projectPath when sessionId is absent", async () => {
    const item = mockItem();
    const handler = mockHandler();
    const deps = await handler.resolveReferences();
    const ctx = buildProvisionerContext(item, deps);

    expect(ctx.projectPath).toBe("/tmp/tfworkspaces/test-key");
  });

  it("is backward compatible: no sessionId produces old-style path", async () => {
    const item = mockItem();
    const handler = mockHandler();
    const deps = await handler.resolveReferences();
    const ctx = buildProvisionerContext(item, deps);
    const ctxWith = buildProvisionerContext(item, deps, "xyz9");

    expect(ctx.projectPath).toContain("test-key");
    expect(ctxWith.projectPath).toContain("xyz9");
    expect(ctx.projectPath).not.toEqual(ctxWith.projectPath);
  });

  it("throws on empty tfStateKey when sessionId is absent", async () => {
    const item = mockItem({ firestartr: { tfStateKey: "" } });
    const handler = mockHandler();
    const deps = await handler.resolveReferences();

    expect(() => buildProvisionerContext(item, deps)).toThrow(
      "Invalid terraform state key",
    );
  });

  it("throws on non-string tfStateKey when sessionId is absent", async () => {
    const item = mockItem({ firestartr: { tfStateKey: null } });
    const handler = mockHandler();
    const deps = await handler.resolveReferences();

    expect(() => buildProvisionerContext(item, deps)).toThrow(
      "Invalid terraform state key",
    );
  });

  it("throws on path-traversing tfStateKey when sessionId is absent", async () => {
    const item = mockItem({
      firestartr: { tfStateKey: "../../../etc/passwd" },
    });
    const handler = mockHandler();
    const deps = await handler.resolveReferences();

    expect(() => buildProvisionerContext(item, deps)).toThrow(
      "Invalid terraform state key",
    );
  });

  it("still requires tfStateKey when sessionId is provided", async () => {
    const item = mockItem({ firestartr: { tfStateKey: "" } });
    const handler = mockHandler();
    const deps = await handler.resolveReferences();

    expect(() => buildProvisionerContext(item, deps, "abc1")).toThrow(
      "Invalid terraform state key",
    );
  });
});

describe("doApply reuse orchestration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls apply (without reuse) then output (with reuse: true)", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      if (command === "output") {
        return JSON.stringify({ test_out: { value: "ok" } });
      }
      if (command === "tear-up-project") {
        return { tornUp: true };
      }
      return "apply output";
    });

    const item = mockItem();
    const handler = mockHandler();
    const gen = doApply(item, OperationType.UPDATED, handler);
    await collectGenerator(gen);

    expect(sentContexts).toHaveLength(3);
    expect(sentContexts[0].command).toBe("apply");
    expect(sentContexts[0].ctx.reuseExistingProject).toBeUndefined();
    expect(sentContexts[1].command).toBe("output");
    expect(sentContexts[1].ctx.reuseExistingProject).toBe(true);
    expect(sentContexts[2].command).toBe("tear-up-project");
  });

  it("uses the same projectPath for apply and output", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      if (command === "output")
        return JSON.stringify({ test_out: { value: "ok" } });
      if (command === "tear-up-project") return { tornUp: true };
      return "apply output";
    });

    const item = mockItem();
    const handler = mockHandler();
    const gen = doApply(item, OperationType.UPDATED, handler);
    await collectGenerator(gen);

    expect(sentContexts).toHaveLength(3);
    expect(sentContexts[0].ctx.projectPath).toMatch(
      /^\/tmp\/tfworkspaces\/firestartrterraformworkspace-test-workspace-[a-z0-9]{4}$/,
    );
    expect(sentContexts[1].ctx.projectPath).toBe(
      sentContexts[0].ctx.projectPath,
    );
  });

  it("calls tear-up-project after apply and output complete", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      if (command === "output")
        return JSON.stringify({ test_out: { value: "ok" } });
      if (command === "tear-up-project") return { tornUp: true };
      return "apply output";
    });

    const item = mockItem();
    const handler = mockHandler();
    const gen = doApply(item, OperationType.UPDATED, handler);
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "apply",
      "output",
      "tear-up-project",
    ]);
  });

  it("tear-up failure after successful apply does not fail the operation", async () => {
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      if (command === "output")
        return JSON.stringify({ test_out: { value: "ok" } });
      if (command === "tear-up-project") throw new Error("tear-up failed");
      return "apply output";
    });

    const item = mockItem();
    const handler = mockHandler();
    const gen = doApply(item, OperationType.UPDATED, handler);

    let threw = false;
    try {
      await collectGenerator(gen);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(handler.success).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("tear-up failed"),
    );
  });

  it("tear-up failure after failed apply preserves the original error", async () => {
    let callCount = 0;
    mockRun.mockImplementation(async (_ctx: any, command: string) => {
      callCount++;
      if (callCount === 1) throw new Error("apply crashed");
      if (command === "tear-up-project") throw new Error("tear-up failed");
      return { tornUp: true };
    });

    const item = mockItem();
    const handler = mockHandler();
    const gen = doApply(item, OperationType.UPDATED, handler);

    await collectGenerator(gen);

    expect(handler.error).toHaveBeenCalled();
    expect(handler.writeTerraformOutputInTfResult).toHaveBeenCalledWith(
      item,
      expect.stringContaining("apply crashed"),
      1,
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("tear-up failed"),
    );
  });

  it("supports CREATED, UPDATED, RENAMED, and RETRY operations through doApply", () => {
    for (const op of [
      OperationType.CREATED,
      OperationType.UPDATED,
      OperationType.RENAMED,
      OperationType.RETRY,
    ] as const) {
      const item = mockItem();
      const handler = mockHandler();
      const gen = doApply(item, op, handler);
      expect(gen).toBeDefined();
    }
  });
});

describe("markedToDeletion lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("calls destroy with session-scoped path and tear-up-project", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      return "destroyed";
    });

    const item = mockItem();
    (item.metadata as any).deletionTimestamp = "2024-01-01T00:00:00Z";
    const handler = mockHandler();

    const gen = processOperation(
      item,
      OperationType.MARKED_TO_DELETION,
      handler,
    ) as any;
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "destroy",
      "tear-up-project",
    ]);
    expect(sentContexts[0].ctx.projectPath).toMatch(
      /^\/tmp\/tfworkspaces\/firestartrterraformworkspace-test-workspace-[a-z0-9]{4}$/,
    );
    expect(sentContexts[0].ctx.reuseExistingProject).toBeUndefined();
    expect(sentContexts[1].ctx.projectPath).toBe(
      sentContexts[0].ctx.projectPath,
    );
  });

  it("calls tear-up-project even when destroy fails", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      if (command === "destroy") throw new Error("destroy failed");
      return "destroyed";
    });

    const item = mockItem();
    (item.metadata as any).deletionTimestamp = "2024-01-01T00:00:00Z";
    const handler = mockHandler();

    const gen = processOperation(
      item,
      OperationType.MARKED_TO_DELETION,
      handler,
    ) as any;
    await collectGenerator(gen);

    const commands = sentContexts.map((c: any) => c.command);
    expect(commands).toContain("destroy");
    expect(commands).toContain("tear-up-project");
    const destroyIdx = commands.indexOf("destroy");
    const tearUpIdx = commands.indexOf("tear-up-project");
    expect(tearUpIdx).toBeGreaterThan(destroyIdx);
    expect(handler.error).toHaveBeenCalled();
  });

  it("calls handler.finalize and handles deletion completion on success", async () => {
    mockRun.mockImplementation(async (_ctx: any, command: string) => {
      if (command === "tear-up-project") return { tornUp: true };
      return "destroyed";
    });

    const item = mockItem();
    (item.metadata as any).deletionTimestamp = "2024-01-01T00:00:00Z";
    const handler = mockHandler();

    const gen = processOperation(
      item,
      OperationType.MARKED_TO_DELETION,
      handler,
    ) as any;
    await collectGenerator(gen);

    expect(handler.finalize).toHaveBeenCalled();
    expect(handler.writeTerraformOutputInTfResult).toHaveBeenCalledWith(
      item,
      "destroyed",
      0,
    );
    expect(handler.success).toHaveBeenCalled();
  });
});

describe("processOperation entry points for non-apply flows", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockReset();
  });

  it("CREATED with observe policy routes to plan (observe), not apply", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      return {
        summary: {
          hasChanges: () => false,
          toString: () => "No changes",
        },
        detailedBriefing: {},
      };
    });

    const item = mockItem();
    item.metadata.annotations["firestartr.dev/policy"] = "observe";
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.CREATED, handler) as any;
    await collectGenerator(gen);

    const commands = sentContexts.map((c: any) => c.command);
    expect(commands).toContain("plan-json");
    expect(commands).not.toContain("apply");
    expect(commands).toEqual(["plan-json", "tear-up-project"]);
  });

  it("observe (doPlanJSONFormat) uses session-scoped path with tear-up-project", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      return {
        summary: {
          hasChanges: () => false,
          toString: () => "No changes",
        },
        detailedBriefing: {},
      };
    });

    const item = mockItem();
    item.metadata.annotations["firestartr.dev/policy"] = "observe";
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.UPDATED, handler) as any;
    await collectGenerator(gen);

    for (const entry of sentContexts) {
      expect(entry.ctx.reuseExistingProject).toBeUndefined();
    }
    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "plan-json",
      "tear-up-project",
    ]);
    expect(sentContexts[0].ctx.projectPath).toMatch(
      /^\/tmp\/tfworkspaces\/firestartrterraformworkspace-test-workspace-[a-z0-9]{4}$/,
    );
    expect(sentContexts[1].ctx.projectPath).toBe(
      sentContexts[0].ctx.projectPath,
    );
  });

  it("observe tears up even when plan-json fails", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      if (command === "plan-json") throw new Error("plan failed");
      return "ok";
    });

    const item = mockItem();
    item.metadata.annotations["firestartr.dev/policy"] = "observe";
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.UPDATED, handler) as any;
    await collectGenerator(gen);

    const commands = sentContexts.map((c: any) => c.command);
    expect(commands).toContain("plan-json");
    expect(commands).toContain("tear-up-project");
    const planIdx = commands.indexOf("plan-json");
    const tearUpIdx = commands.indexOf("tear-up-project");
    expect(tearUpIdx).toBeGreaterThan(planIdx);
  });

  it("destroy flow uses session-scoped path and tear-up-project", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      return "destroyed";
    });

    const item = mockItem();
    (item.metadata as any).deletionTimestamp = "2024-01-01T00:00:00Z";
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.RETRY, handler) as any;
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "destroy",
      "tear-up-project",
    ]);
    expect(sentContexts[0].ctx.projectPath).toMatch(
      /^\/tmp\/tfworkspaces\/firestartrterraformworkspace-test-workspace-[a-z0-9]{4}$/,
    );
    expect(sentContexts[0].ctx.reuseExistingProject).toBeUndefined();
  });

  it("destroy teardown is independent per run", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      return "destroyed";
    });

    const item1 = mockItem();
    (item1.metadata as any).deletionTimestamp = "2024-01-01T00:00:00Z";
    const item2 = mockItem({ firestartr: { tfStateKey: "other-key" } });
    (item2.metadata as any).deletionTimestamp = "2024-01-01T00:00:00Z";

    const handler1 = mockHandler();
    const handler2 = mockHandler();

    const gen1 = processOperation(item1, OperationType.RETRY, handler1) as any;
    const gen2 = processOperation(item2, OperationType.RETRY, handler2) as any;
    await Promise.all([collectGenerator(gen1), collectGenerator(gen2)]);

    const destroyCalls = sentContexts.filter((c) => c.command === "destroy");
    const tearUpCalls = sentContexts.filter(
      (c) => c.command === "tear-up-project",
    );
    expect(destroyCalls).toHaveLength(2);
    expect(tearUpCalls).toHaveLength(2);
    expect(destroyCalls[0].ctx.projectPath).not.toEqual(
      destroyCalls[1].ctx.projectPath,
    );
    expect(tearUpCalls[0].ctx.projectPath).toEqual(
      destroyCalls[0].ctx.projectPath,
    );
    expect(tearUpCalls[1].ctx.projectPath).toEqual(
      destroyCalls[1].ctx.projectPath,
    );
  });

  it("destroy teardown runs even when destroy fails", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      if (command === "destroy") throw new Error("destroy failed");
      return "destroyed";
    });

    const item = mockItem();
    (item.metadata as any).deletionTimestamp = "2024-01-01T00:00:00Z";
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.RETRY, handler) as any;
    await collectGenerator(gen);

    const commands = sentContexts.map((c: any) => c.command);
    expect(commands).toContain("destroy");
    expect(commands).toContain("tear-up-project");
    const destroyIdx = commands.indexOf("destroy");
    const tearUpIdx = commands.indexOf("tear-up-project");
    expect(tearUpIdx).toBeGreaterThan(destroyIdx);
  });

  it("CREATED with full-control policy routes to doApply", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      if (command === "output")
        return JSON.stringify({ test_out: { value: "ok" } });
      if (command === "tear-up-project") return { tornUp: true };
      return "apply output";
    });

    const item = mockItem();
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.CREATED, handler) as any;
    await collectGenerator(gen);

    const commands = sentContexts.map((c: any) => c.command);
    expect(commands).toEqual(["apply", "output", "tear-up-project"]);
  });

  it("UPDATED with full-control policy routes to doApply", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      if (command === "output")
        return JSON.stringify({ test_out: { value: "ok" } });
      if (command === "tear-up-project") return { tornUp: true };
      return "apply output";
    });

    const item = mockItem();
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.UPDATED, handler) as any;
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "apply",
      "output",
      "tear-up-project",
    ]);
  });

  it("observe policy with UPDATED routes to plan-json, not apply", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      return {
        summary: { hasChanges: () => false, toString: () => "No changes" },
        detailedBriefing: {},
      };
    });

    const item = mockItem();
    item.metadata.annotations["firestartr.dev/policy"] = "observe";
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.UPDATED, handler) as any;
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "plan-json",
      "tear-up-project",
    ]);
  });

  it("RENAMED with full-control policy routes to doApply", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      if (command === "output")
        return JSON.stringify({ test_out: { value: "ok" } });
      if (command === "tear-up-project") return { tornUp: true };
      return "apply output";
    });

    const item = mockItem();
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.RENAMED, handler) as any;
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "apply",
      "output",
      "tear-up-project",
    ]);
  });

  it("SYNC with full-control and sync-policy=apply routes to doApply", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      if (command === "output")
        return JSON.stringify({ test_out: { value: "ok" } });
      if (command === "tear-up-project") return { tornUp: true };
      return "apply output";
    });

    const item = mockItem();
    item.metadata.annotations["firestartr.dev/sync-policy"] = "apply";
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.SYNC, handler) as any;
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "apply",
      "output",
      "tear-up-project",
    ]);
  });

  it("SYNC with no sync-policy routes to plan-json", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      return {
        summary: { hasChanges: () => false, toString: () => "No changes" },
        detailedBriefing: {},
      };
    });

    const item = mockItem();
    delete item.metadata.annotations["firestartr.dev/sync-policy"];
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.SYNC, handler) as any;
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "plan-json",
      "tear-up-project",
    ]);
  });

  it("MARKED_TO_DELETION with full-control routes to destroy with tear-up-project", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      return "destroyed";
    });

    const item = mockItem();
    item.metadata.annotations["firestartr.dev/policy"] = "full-control";
    const handler = mockHandler();

    const gen = processOperation(
      item,
      OperationType.MARKED_TO_DELETION,
      handler,
    ) as any;
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "destroy",
      "tear-up-project",
    ]);
  });

  it("NOTHING operation yields NOTHING status and does not call provisioner", async () => {
    const item = mockItem();
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.NOTHING, handler) as any;
    const results = await collectGenerator(gen);

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("NOTHING");
    expect(results[0].status).toBe("True");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("observe-only policy routes to observe (plan-json)", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      return {
        summary: { hasChanges: () => false, toString: () => "No changes" },
        detailedBriefing: {},
      };
    });

    const item = mockItem();
    item.metadata.annotations["firestartr.dev/policy"] = "observe-only";
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.UPDATED, handler) as any;
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "plan-json",
      "tear-up-project",
    ]);
  });

  it("undefined policy falls back to observe (plan-json)", async () => {
    const sentContexts: any[] = [];
    mockRun.mockImplementation(async (ctx: any, command: string) => {
      sentContexts.push({ ctx: { ...ctx }, command });
      return {
        summary: { hasChanges: () => false, toString: () => "No changes" },
        detailedBriefing: {},
      };
    });

    const item = mockItem();
    delete item.metadata.annotations["firestartr.dev/policy"];
    const handler = mockHandler();

    const gen = processOperation(item, OperationType.UPDATED, handler) as any;
    await collectGenerator(gen);

    expect(sentContexts.map((c: any) => c.command)).toEqual([
      "plan-json",
      "tear-up-project",
    ]);
  });

  it("policy that disallows the op returns errorPolicyNotAllowsOp", async () => {
    const item = mockItem();
    item.metadata.annotations["firestartr.dev/policy"] = "apply";
    const handler = mockHandler();

    const gen = processOperation(
      item,
      OperationType.MARKED_TO_DELETION,
      handler,
    ) as any;
    const results = await collectGenerator(gen);

    expect(results.length).toBeGreaterThan(0);
    expect(
      results.some((r: any) => r.type === "ERROR" && r.status === "True"),
    ).toBe(true);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
