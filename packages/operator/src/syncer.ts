import { getItemByItemPath } from './ctl';

import log from './logger';

import {
  SyncStatus,
  SyncWatcher,
  getSyncSpecs,
  getSyncStatus,
  createWatcherForItem,
  destroyWatcherForItem,
} from './syncCtl';

import { syncerDebug } from './syncer.debug';

export type SyncWatchers = { [key: string]: SyncWatcher };

const syncWatchers: SyncWatchers = {};

// in seconds
const FORCE_REVISION_TIME = 60;

export async function syncer(enqueue: Function) {
  const api = {
    addItem(itemPath: string) {
      log.info(`Added item of path '${itemPath}' for synchronization`);

      getSyncSpecs(itemPath)
        .then(async (itemSyncInfo) => {
          if (!itemSyncInfo.syncable) {
            return;
          }

          const syncCtl: SyncStatus = await getSyncStatus(
            itemPath,
            itemSyncInfo.item,
          );

          syncWatchers[itemPath] = await createWatcherForItem(
            itemPath,
            itemSyncInfo.item,
          );

          log.info(`Configured synchronization for item at path '${itemPath}'`);

          log.debug(
            `Sync information for '${itemPath}': ${JSON.stringify({ ...itemSyncInfo, item: null }, null)}`,
          );

          syncerDebug(syncWatchers).catch((err) => {
            throw `Error syncer debug: ${err}`;
          });
        })
        .catch((err) => {
          log.error(`Error on sync [add item]: ${err}`);

          throw `Error on sync [add item]: ${err}`;
        });
    },

    updateItem(itemPath: string) {
      //if (!syncWatchers[itemPath]) {
      //  log('Item %s not found, ignoring...', itemPath)
      //  return
      //}

      log.debug(`Updated item of path '${itemPath}' during synchronization`);

      return getSyncSpecs(itemPath)
        .then(async (itemSyncInfo) => {
          if (syncWatchers[itemPath]) {
            await destroyWatcherForItem(syncWatchers[itemPath]);

            delete syncWatchers[itemPath];
          }

          // we need to check if the item is not syncable anymore
          if (!itemSyncInfo.syncable) {
            log.info(`Removed item of path '${itemPath}' from synchronization`);

            return;
          }

          // if it is syncable we need to recalculate everything
          syncWatchers[itemPath] = await createWatcherForItem(itemPath);

          log.debug(
            `Configured synchronization for item at path '${itemPath}' with watcher`,
          );

          syncerDebug(syncWatchers).catch((err) => {
            throw `Error syncer debug: ${err}`;
          });
        })
        .catch((err) => {
          log.error(`Error on sync [updateItem]: ${err}`);

          throw `Error on sync [updateItem]: ${err}`;
        });
    },

    deleteItem(itemPath: string) {
      if (!syncWatchers[itemPath]) {
        log.debug(
          `Ignored deletion attempt for item at path '${itemPath}' as it was not found during synchronization`,
        );

        return;
      }

      destroyWatcherForItem(syncWatchers[itemPath])
        .then(() => {
          log.debug(
            `Deleted item of path '${itemPath}' during synchronization`,
          );

          delete syncWatchers[itemPath];

          syncerDebug(syncWatchers).catch((err) => {
            throw `Error syncer debug: ${err}`;
          });
        })
        .catch((err) => {
          log.error(
            `Error deleting item of path ${itemPath} for synchronization: ${err}`,
          );

          throw `Error deleting item of path ${itemPath} for synchronization: ${err}`;
        });
    },
  };

  // fork
  void loop(enqueue, api);

  return api;
}

export async function loop(enqueueIfNeeded: Function, api: any) {
  void loopKeeper(api);

  while (1) {
    try {
      await fWait();

      const needRevisionItems = Object.values(syncWatchers).filter(
        (watcher: SyncWatcher) => watcher.needsRevision,
      );

      for (const watcher of needRevisionItems) {
        const item: any = await getItemIfNeededSync(watcher);

        log.debug(`Item needs revision ${watcher.itemPath}`);

        if (item !== null) {
          enqueueIfNeeded(item);
        }

        watcher.needsRevision = false;
      }
    } catch (err) {
      log.error(`Error in sync loop: ${err}`);
    }
  }
}

async function loopKeeper(api: any) {
  try {
    while (1) {
      await fWait(FORCE_REVISION_TIME);

      for (const watcher of Object.values(syncWatchers)) {
        if (watcher.alreadyFired) {
          await api.updateItem(watcher.itemPath);
        }
      }
    }
  } catch (err) {
    log.error(`PANIC!: loopKeeper has failed: ${err}`);

    process.exit(1);
  }
}

export async function getItemIfNeededSync(
  watcher: any,
  watchers?: { [key: string]: SyncWatcher },
) {
  const targetWatchers = watchers ?? syncWatchers;

  try {
    const item: any = await getItemByItemPath(watcher.itemPath);

    const isDeleting = item.status?.conditions?.find(
      (condition: any) =>
        condition.type === 'DELETING' && condition.status === 'True',
    );

    if (isDeleting) return null;

    return item;
  } catch (e: any) {
    if (e.message && e.message.includes('Error on getItemByItemPath')) {
      if (e.message.includes('Not Found')) {
        log.debug(
          `Item '${watcher.itemPath}' not found, removing from sync watchers.`,
        );
        delete targetWatchers[watcher.itemPath];
      } else {
        log.warn(
          `Transient error fetching '${watcher.itemPath}', keeping sync watcher: ${e.message}`,
        );
      }

      return null;
    } else {
      log.error(e);
    }

    return null;
  }
}

function fWait(segs = 1) {
  return new Promise<void>((ok) => {
    setTimeout(() => ok(), segs * 1000);
  });
}
