jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    silly: jest.fn(),
  },
}));

jest.mock('../src/ctl', () => ({
  __esModule: true,
  getItemByItemPath: jest.fn(),
  upsertFinalizer: jest.fn(),
  writePlanInGithubPR: jest.fn(),
  writeTerraformOutputInTFResult: jest.fn(),
  unsetFinalizer: jest.fn(),
  writeConnectionSecret: jest.fn(),
  getSecret: jest.fn(),
  deleteSecret: jest.fn(),
}));

jest.mock('../src/reflector', () => ({
  __esModule: true,
  observe: jest.fn(),
}));

jest.mock('../src/syncCtl', () => ({
  __esModule: true,
  setSyncStatus: jest.fn(),
  getSyncStatus: jest.fn(),
}));

jest.mock('../src/syncer', () => ({
  __esModule: true,
  syncer: jest.fn(),
}));

jest.mock('../src/retry', () => ({
  __esModule: true,
  initRetry: jest.fn(),
  nextRetryMs: jest.fn(),
  getMaxRetry: jest.fn(() => 5),
}));

import { OperationType, WorkItem } from '../src/definitions';
import { observeKind } from '../src/informer';
import { initPlanMode } from '../src/plan-mode/config';
import { observe } from '../src/reflector';
import { initRetry } from '../src/retry';
import { setSyncStatus } from '../src/syncCtl';
import { syncer } from '../src/syncer';

const ITEM_PATH = 'default/terraformworkspaces/ws';

const item = {
  kind: 'FirestartrTerraformWorkspace',
  metadata: { name: 'ws', namespace: 'default' },
  spec: {},
};

const retryCtl = {
  errorReconciling: jest.fn(),
  successReconciling: jest.fn(),
  deleteReconciling: jest.fn(),
};

const syncCtl = {
  addItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
};

let queued: WorkItem[] = [];

let onAdd: Function = () => {};

// The plan handlers report their outcome through the work item handler
let outcome: 'success' | 'error' | 'throw' = 'success';

async function* compute(_item: any, _op: OperationType, handler: any) {
  if (outcome === 'throw') throw new Error('plan write failed');

  if (outcome === 'error') handler.error();
  else handler.success();

  yield* [];
}

async function runProcess(operation: OperationType) {
  const workItem = queued[queued.length - 1];

  for await (const _ of workItem.process(item, operation, workItem.handler)) {
    // plan mode yields no transitions
  }
}

beforeAll(async () => {
  initPlanMode({ flag: true });

  jest.mocked(initRetry).mockResolvedValue(retryCtl as any);
  jest.mocked(syncer).mockResolvedValue(syncCtl as any);

  // The informer blocks on the watch for as long as it runs
  jest.mocked(observe).mockImplementation(async (...args: any[]) => {
    onAdd = args[2];

    return new Promise<void>(() => {});
  });

  void observeKind(
    'terraformworkspaces',
    'default',
    (workItem: WorkItem) => queued.push(workItem),
    compute,
  );

  await new Promise((resolve) => setImmediate(resolve));
});

beforeEach(async () => {
  jest.clearAllMocks();

  queued = [];

  outcome = 'success';

  await onAdd(item);
});

describe('Plan mode informer: failed plans', () => {
  it('records the sync and rearms it after a successful plan', async () => {
    await runProcess(OperationType.SYNC);

    expect(setSyncStatus).toHaveBeenCalledWith(
      ITEM_PATH,
      OperationType.SYNC,
      'True',
      'Plan process finished',
    );
    expect(syncCtl.updateItem).toHaveBeenCalledWith(ITEM_PATH);
    expect(syncCtl.deleteItem).not.toHaveBeenCalled();
  });

  it('suspends periodic sync instead of rearming it after a failed plan', async () => {
    outcome = 'error';

    await runProcess(OperationType.SYNC);

    expect(retryCtl.errorReconciling).toHaveBeenCalledWith(ITEM_PATH);
    expect(setSyncStatus).not.toHaveBeenCalled();
    expect(syncCtl.updateItem).not.toHaveBeenCalled();
    expect(syncCtl.deleteItem).toHaveBeenCalledWith(ITEM_PATH);
  });

  it('never rearms sync across repeated failures, so the retry budget keeps counting', async () => {
    outcome = 'error';

    for (const operation of [
      OperationType.SYNC,
      OperationType.RETRY_SYNC,
      OperationType.RETRY_SYNC,
    ]) {
      await runProcess(operation);
    }

    expect(retryCtl.errorReconciling).toHaveBeenCalledTimes(3);
    expect(setSyncStatus).not.toHaveBeenCalled();
    expect(syncCtl.updateItem).not.toHaveBeenCalled();
    expect(syncCtl.deleteItem).toHaveBeenCalledTimes(3);
  });

  it('rearms sync once a retried plan succeeds', async () => {
    outcome = 'error';

    await runProcess(OperationType.SYNC);

    outcome = 'success';

    await runProcess(OperationType.RETRY_SYNC);

    expect(setSyncStatus).toHaveBeenCalledTimes(1);
    expect(syncCtl.updateItem).toHaveBeenCalledWith(ITEM_PATH);
  });

  it('suspends periodic sync when the plan outcome cannot be recorded', async () => {
    outcome = 'throw';

    await expect(runProcess(OperationType.SYNC)).rejects.toThrow(
      'plan write failed',
    );

    expect(setSyncStatus).not.toHaveBeenCalled();
    expect(syncCtl.deleteItem).toHaveBeenCalledWith(ITEM_PATH);
  });
});
