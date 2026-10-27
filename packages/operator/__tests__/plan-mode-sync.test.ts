jest.mock('../src/ctl', () => ({
  getItemByItemPath: jest.fn(),
}));

jest.mock('../src/status', () => ({
  ...jest.requireActual('../src/status'),
  updateSyncTransition: jest.fn(),
}));

import { getItemByItemPath } from '../src/ctl';
import { OperationType } from '../src/definitions';
import { initPlanMode } from '../src/plan-mode/config';
import { planStartupOperation } from '../src/plan-mode/startup';
import {
  planRecordsSync,
  planRetryOperation,
} from '../src/plan-mode/work-items';
import { updateSyncTransition } from '../src/status';
import {
  createWatcherForItem,
  destroyWatcherForItem,
  getSyncStatus,
  setSyncStatus,
} from '../src/syncCtl';

const ITEM_PATH = 'default/firestartrterraformworkspaces/ws';
const OTHER_ITEM_PATH = 'default/firestartrterraformworkspaces/ws-2';

const overdueHourlyCr = {
  kind: 'FirestartrTerraformWorkspace',
  metadata: {
    name: 'ws',
    annotations: {
      'firestartr.dev/sync-enabled': 'true',
      'firestartr.dev/sync-period': '1h',
    },
  },
  status: {
    conditions: [
      {
        type: 'SYNCHRONIZED',
        status: 'True',
        reason: 'SYNC',
        message: 'Sync process finished',
        lastSyncTime: new Date(Date.now() - 3 * 3600_000).toISOString(),
        nextSyncTime: new Date(Date.now() - 2 * 3600_000).toISOString(),
      },
    ],
  },
};

describe('Plan mode synchronization', () => {
  beforeAll(() => {
    initPlanMode({ flag: true });
  });

  beforeEach(() => {
    jest.mocked(getItemByItemPath).mockResolvedValue(overdueHourlyCr);
  });

  it('rearms from the in-memory sync, not the overdue CR status', async () => {
    expect((await getSyncStatus(ITEM_PATH)).intervalLapsed).toBe(true);

    await setSyncStatus(ITEM_PATH, 'SYNC', 'True', 'Plan process finished');

    expect(updateSyncTransition).not.toHaveBeenCalled();

    const status = await getSyncStatus(ITEM_PATH);

    expect(status.intervalLapsed).toBe(false);
    expect(status.nextTimeoutInMS).toBeGreaterThan(3500_000);

    const watcher = await createWatcherForItem(ITEM_PATH);

    expect(watcher.alreadyFired).toBe(false);
    expect(Date.parse(watcher.nextSync!)).toBeGreaterThan(
      Date.now() + 3500_000,
    );

    await destroyWatcherForItem(watcher);
  });

  it('keeps an overdue sync due when startup only writes a NOTHING artifact', async () => {
    const operation = planStartupOperation(overdueHourlyCr);

    expect(operation).toBe(OperationType.NOTHING);
    expect(planRecordsSync(operation, overdueHourlyCr)).toBe(false);

    expect((await getSyncStatus(OTHER_ITEM_PATH)).intervalLapsed).toBe(true);
  });

  it('records a sync for every other finished plan except deletions', () => {
    const live = { metadata: {} };

    expect(planRecordsSync(OperationType.SYNC, live)).toBe(true);
    expect(planRecordsSync(OperationType.UPDATED, live)).toBe(true);
    expect(planRecordsSync(OperationType.MARKED_TO_DELETION, live)).toBe(false);
  });

  it('never rearms sync after a retried deletion plan', () => {
    const deleting = {
      metadata: { deletionTimestamp: '2026-01-01T00:00:00Z' },
    };

    expect(planRecordsSync(OperationType.RETRY, deleting)).toBe(false);
    expect(planRecordsSync(OperationType.RETRY_SYNC, deleting)).toBe(false);
  });

  it('retries a failed sync plan as RETRY_SYNC and anything else as RETRY', () => {
    expect(planRetryOperation(OperationType.SYNC)).toBe(
      OperationType.RETRY_SYNC,
    );
    expect(planRetryOperation(OperationType.RETRY_SYNC)).toBe(
      OperationType.RETRY_SYNC,
    );
    expect(planRetryOperation(OperationType.UPDATED)).toBe(OperationType.RETRY);
    expect(planRetryOperation(undefined)).toBe(OperationType.RETRY);
  });
});
