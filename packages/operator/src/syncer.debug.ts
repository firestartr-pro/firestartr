import * as fs from 'fs';

import log from './logger';

import { SyncWatchers } from './syncer';

let running = false;
let waitingF = null;

export async function syncerDebug(syncWatchers: SyncWatchers) {
  if (running) return waitUntilDone(syncWatchers);

  running = true;

  try {
    await writeDownSyncer(syncWatchers);

    running = false;
  } catch (err) {
    log.error(`PANIC!!! sync debug could not be written ${err}`);

    running = false;
  }
}

async function waitUntilDone(syncWatchers: SyncWatchers) {
  if (waitingF) return;

  waitingF = setTimeout(() => {
    syncerDebug(syncWatchers).catch((err) => {
      log.error(`Caught error: ${err}`);

      throw `Caught error: ${err}`;
    });

    clearTimeout(waitingF);

    waitingF = null;
  }, 300);
}

async function writeDownSyncer(syncWatchers: SyncWatchers) {
  let output = '';

  for (const watcher of Object.values(syncWatchers)) {
    output += `${watcher.itemPath} - (${watcher.syncMode}) - next: ${watcher.nextSync} \n`;
  }

  return new Promise((ok: Function, ko: Function) => {
    fs.writeFile('/tmp/syncs', output, (err: any) => {
      if (err) return ko(`Error writing the /tmp/syncs: ${err}`);
      else return ok();
    });
  });
}
