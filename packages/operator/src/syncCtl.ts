// Machinery for syncing

import { getConditionByType, updateSyncTransition } from './status';

import { getItemByItemPath } from './ctl';

import common from 'catalog_common';

import log from './logger';

import { SYNC_DEFAULT_ERROR_MESSAGE } from './utils/operationErrorMessages';

const DEFAULT_REVISION_TIME = '1m';

export type SyncMode = 'Scheduled' | 'Period' | 'NotSyncable';

export type Condition = {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason: string;
  message: string;
  lastSyncTime?: string;
  nextSyncTime?: string;
};

export type SyncStatus = {
  itemPath?: string;

  conditions?: Condition[];

  nextTimeoutInMS?: number;

  syncStatusPresent?: boolean;

  intervalLapsed?: boolean;

  syncMode?: SyncMode;

  hasSyncFailed?: boolean;
};

export type SyncWatcher = {
  itemPath: string;

  lastRevision: any;

  needsRevision: boolean;

  nextSync?: string;

  lastSync?: string;

  syncMode?: SyncMode;

  alreadyFired?: boolean;
};

type SyncProcessFunction = (
  item: any,
  reason: string,
  status: 'True' | 'False' | 'Unknown',
  message: string,
) => Promise<SyncStatus>;

export async function createWatcherForItem(
  itemPath: string,
  itemCR?: any,
): Promise<SyncWatcher> {
  const item: any = itemCR ?? (await getItemByItemPath(itemPath));

  const syncStatus: SyncStatus = await getSyncStatus(itemPath, item);

  let nextTimeoutInMS = syncStatus.nextTimeoutInMS;

  // we have lapsed last interval
  // we calculate from the lastSyncTime
  if (syncStatus.intervalLapsed) {
    log.debug(`Next sync interval have been lapsed for ${itemPath}`);

    if (syncStatus.syncMode === 'Period') {
      log.debug(
        `Next sync interval have been lapsed for ${itemPath} the sync will start now`,
      );

      nextTimeoutInMS = -1;
    }
  }

  const syncInfo: Condition = syncStatus.conditions?.[0] ?? null;

  const watcher: SyncWatcher = {
    itemPath,

    lastRevision: setTimeout(
      () => {
        log.debug(`Item ${itemPath} needs revision`);

        watcher.needsRevision = true;

        watcher.alreadyFired = true;
      },

      nextTimeoutInMS,
    ),

    needsRevision: false,

    nextSync: syncInfo ? syncInfo?.nextSyncTime : undefined,

    syncMode: syncStatus.syncMode,

    alreadyFired: false,
  };

  return watcher;
}

export async function destroyWatcherForItem(watcher: SyncWatcher) {
  clearTimeout(watcher.lastRevision);

  log.debug(`Disabled SyncWatcher for ${watcher.itemPath}`);
}

export async function getSyncSpecs(
  itemPath: string,
  itemCR?: any,
): Promise<any> {
  const item: any = itemCR ?? (await getItemByItemPath(itemPath));

  return {
    item,

    syncable: helperIsSyncable(item),

    period:
      item.metadata.annotations?.['firestartr.dev/sync-period'] ||
      DEFAULT_REVISION_TIME,

    schedule:
      item.metadata.annotations?.['firestartr.dev/sync-schedule'] || false,

    scheduleTZ:
      item.metadata.annotations?.['firestartr.dev/sync-schedule-timezone'] ||
      'Europe/Madrid',
  };
}

export async function getSyncStatus(
  itemPath: string,
  itemCR?: any,
): Promise<SyncStatus> {
  const item: any = itemCR ?? (await getItemByItemPath(itemPath));

  const syncCondition = getConditionByType(
    item.status?.conditions ?? [],
    'SYNCHRONIZED',
  );

  // no sync condition present
  if (!syncCondition) {
    return {
      syncStatusPresent: false,
    };
  } else {
    const nextSyncDate = new Date(syncCondition.nextSyncTime);

    const isLapsed = Date.now() >= nextSyncDate.getTime();

    const mode = !helperIsSyncable(item)
      ? 'NotSyncable'
      : (await getSyncSpecs(itemPath, item)).schedule
        ? 'Scheduled'
        : 'Period';

    const syncStatus: SyncStatus = {
      itemPath,
      syncMode: mode,
      conditions: [syncCondition],
      syncStatusPresent: true,
      nextTimeoutInMS: isLapsed ? -1 : nextSyncDate.getTime() - Date.now(),
      intervalLapsed: isLapsed,
    };

    if (syncCondition) {
      syncStatus.hasSyncFailed =
        syncCondition.message === SYNC_DEFAULT_ERROR_MESSAGE;
    }

    return syncStatus;
  }
}

export async function setSyncStatus(
  itemPath: string,
  reason: string,
  status: 'True' | 'False' | 'Unknown',
  message: string,
): Promise<SyncStatus> {
  const item = await getItemByItemPath(itemPath);

  const machinery = assessSyncCalculationMachinery(item);

  const syncStatus = await machinery(item, reason, status, message);

  syncStatus.itemPath = itemPath;
  syncStatus.syncStatusPresent = true;

  log.info(
    `Setting sync status for ${itemPath}: ${JSON.stringify(syncStatus)}`,
  );

  const syncTransition = syncStatus.conditions[0];

  await updateSyncTransition(
    itemPath,
    syncTransition.reason,
    syncTransition.lastSyncTime,
    syncTransition.nextSyncTime,
    syncTransition.message,
    syncTransition.status,
  );

  return syncStatus;
}

function assessSyncCalculationMachinery(item: any): SyncProcessFunction {
  if (!helperIsSyncable(item)) {
    return processNotSyncable;
  } else if (
    item.metadata.annotations?.['firestartr.dev/sync-schedule'] ??
    false
  ) {
    return processScheduledSync;
  } else {
    return processPeriodSync;
  }
}

function helperIsSyncable(item: any): boolean {
  return (
    item.metadata.annotations &&
    item.metadata.annotations['firestartr.dev/sync-enabled'] &&
    item.metadata.annotations['firestartr.dev/sync-enabled'] === 'true'
  );
}

async function processNotSyncable(
  item: any,
  reason: string,
  status: 'True' | 'False' | 'Unknown',
  message: string,
): Promise<SyncStatus> {
  return {
    syncMode: 'NotSyncable',
    conditions: [
      {
        reason,
        type: 'SYNCHRONIZED',
        message,
        status,
        lastSyncTime: new Date().toISOString(),
        nextSyncTime: new Date().toISOString(),
      },
    ],
  };
}

async function processPeriodSync(
  item: any,
  reason: string,
  status: 'True' | 'False' | 'Unknown',
  message: string,
): Promise<SyncStatus> {
  const period =
    item.metadata.annotations?.['firestartr.dev/sync-period'] ||
    DEFAULT_REVISION_TIME;

  const periodMS = helperCalculateRevisionTime(period);

  return {
    syncMode: 'Period',
    conditions: [
      {
        reason,
        type: 'SYNCHRONIZED',
        message,
        status,
        lastSyncTime: new Date().toISOString(),
        nextSyncTime: new Date(Date.now() + periodMS).toISOString(),
      },
    ],
  };
}

function helperCalculateRevisionTime(period: string): number {
  const [_, scalar, dimension] = period.split(/(\d+)/);

  const multiplier =
    dimension === 's'
      ? 1
      : dimension === 'm'
        ? 60
        : dimension === 'h'
          ? 60 * 60
          : dimension === 'd'
            ? 60 * 60 * 24
            : 1;

  return Number(scalar) * multiplier * 1000;
}

async function processScheduledSync(
  item: any,
  reason: string,
  status: 'True' | 'False' | 'Unknown',
  message: string,
): Promise<SyncStatus> {
  const nextPeriod = common.cron.getCronNextInterval(
    item.metadata.annotations?.['firestartr.dev/sync-schedule'],

    item.metadata.annotations?.['firestartr.dev/sync-schedule-timezone'] ||
      undefined,
  );

  const nextPeriodDate = new Date(nextPeriod);

  return {
    syncMode: 'Scheduled',
    conditions: [
      {
        reason,
        type: 'SYNCHRONIZED',
        message,
        status,
        lastSyncTime: new Date().toISOString(),
        nextSyncTime: nextPeriodDate.toISOString(),
      },
    ],
  };
}
