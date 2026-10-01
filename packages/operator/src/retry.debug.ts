import * as fs from 'fs';
import { getItemByItemPath } from './ctl';
import { retryOpForReason } from './definitions';
import log from './logger';

const RETRY_DEBUG_INTERVAL_MS = 60 * 1000;

type RetryWatcher = {
  itemPath: string;
  retryCounter: number;
  retry: boolean;
  nextRetryAt: string | null;
};

const loggedEvents = new Set<string>();

export function writeEventIfNew(
  itemPath: string,
  counter: number,
  next: string | null,
  maxRetry = 5,
) {
  const key = `${itemPath}-retry-${counter}`;
  if (loggedEvents.has(key)) return;
  loggedEvents.add(key);

  resolveRetryType(itemPath)
    .then((type) => {
      const nextStr = next ?? 'none';
      const line = `${itemPath} - ${type} - retry ${counter + 1}/${maxRetry} - next: ${nextStr}\n`;
      return new Promise<void>((ok, ko) => {
        fs.appendFile('/tmp/retries', line, (err: any) => {
          if (err) ko(`Error appending to /tmp/retries: ${err}`);
          else ok();
        });
      });
    })
    .catch(() => {
      log.warn(`Failed to resolve retry type for ${itemPath}`);
    });
}

export function initRetryDebug(
  retryWatchers: { [key: string]: RetryWatcher },
  maxRetry: number,
) {
  loggedEvents.clear();
  try {
    fs.writeFileSync('/tmp/retries', '');
  } catch {
    log.warn('Failed to clear /tmp/retries');
  }

  let running = false;

  setInterval(() => {
    if (running) return;

    running = true;

    writeRetryDebug(retryWatchers, maxRetry)
      .then(() => {
        running = false;
      })
      .catch((err) => {
        log.error(`PANIC cannot evaluate the retry debug!!!: ${err}`);
        running = false;
      });
  }, RETRY_DEBUG_INTERVAL_MS);
}

async function writeRetryDebug(
  retryWatchers: { [key: string]: RetryWatcher },
  maxRetry: number,
) {
  let output = '';

  for (const watcher of Object.values(retryWatchers)) {
    const type = await resolveRetryType(watcher.itemPath);
    const nextStr = watcher.retry
      ? 'pending'
      : (watcher.nextRetryAt ?? 'unknown');

    output += `${watcher.itemPath} - ${type} - retry ${watcher.retryCounter + 1}/${maxRetry} - next: ${nextStr}\n`;
  }

  return new Promise<void>((ok: Function, ko: Function) => {
    fs.writeFile('/tmp/retries', output, (err: any) => {
      if (err) ko(`Error writing /tmp/retries: ${err}`);
      else ok();
    });
  });
}

async function resolveRetryType(itemPath: string): Promise<string> {
  try {
    const item: any = await getItemByItemPath(itemPath);

    const errorCondition = item.status?.conditions?.find(
      (c: any) => c.type === 'ERROR' && c.status === 'True',
    );

    return retryOpForReason(errorCondition?.reason) || 'RETRY';
  } catch {
    return 'RETRY';
  }
}
