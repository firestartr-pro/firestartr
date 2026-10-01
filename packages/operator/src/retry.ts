import { getItemByItemPath } from './ctl';
import { initRetryDebug, writeEventIfNew } from './retry.debug';
import log from './logger';

type RetryWatcher = {
  itemPath: string;

  retryCounter: number;

  nextRetry: any;

  retry: boolean;

  nextRetryAt: string | null;
};

// Retries now use exponential backoff, starting at 5 minutes
// and doubling each time, up to the maximum number of retries
// configured by OPERATOR_MAX_RETRY (getMaxRetry()).
//
// Both values can be overridden via environment variables for testing:
//   OPERATOR_NEXT_RETRY_MS  — base delay in ms (default: 300000 = 5 min)
//   OPERATOR_MAX_RETRY      — max retry attempts (default: 5)
function getNextRetryMs(): number {
  const env = process.env.OPERATOR_NEXT_RETRY_MS;
  if (env) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1000 * 60 * 5;
}

export function getMaxRetry(): number {
  const env = process.env.OPERATOR_MAX_RETRY;
  if (env) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 5;
}

export function nextRetryMs(currCounter: number): number {
  return getNextRetryMs() * Math.pow(2, currCounter);
}

type RetryWatchers = { [key: string]: RetryWatcher };

const retryWatchers: RetryWatchers = {};

export async function initRetry(enqueue: Function) {
  initRetryDebug(retryWatchers, getMaxRetry());

  void loop(enqueue);

  return {
    errorReconciling(itemPath: string) {
      retry(itemPath);
    },

    successReconciling(itemPath: string) {
      removeFromRetry(itemPath);
    },

    deleteReconciling(itemPath: string) {
      removeFromRetry(itemPath);
    },
  };
}

export function retry(itemPath: string) {
  if (retryWatchers[itemPath]) {
    retryWatchers[itemPath].retryCounter++;
  } else {
    retryWatchers[itemPath] = {
      itemPath,
      retry: false,
      retryCounter: 0,
      nextRetry: null,
      nextRetryAt: null,
    };
  }

  const currCounter = retryWatchers[itemPath].retryCounter;
  const maxRetry = getMaxRetry();
  const delayMs = nextRetryMs(currCounter);

  if (currCounter >= maxRetry) {
    writeEventIfNew(itemPath, currCounter, null, maxRetry);

    log.debug(
      `Failed to process item '${itemPath}'. Retry limit (${maxRetry}) reached. No further retries will be attempted.`,
    );
    removeFromRetry(itemPath);
    return;
  }

  log.debug(
    `Failed to process item '${itemPath}'. Retrying in '${delayMs / 1000 / 60}' minutes. Remaining retries: '${maxRetry - currCounter - 1}'.`,
  );
  retryWatchers[itemPath].retry = false;

  if (retryWatchers[itemPath].nextRetry) {
    clearTimeout(retryWatchers[itemPath].nextRetry);
  }

  retryWatchers[itemPath].nextRetryAt = new Date(
    Date.now() + delayMs,
  ).toISOString();

  retryWatchers[itemPath].nextRetry = setTimeout(() => {
    if (itemPath in retryWatchers) {
      retryWatchers[itemPath].retry = true;
      retryWatchers[itemPath].nextRetryAt = null;
    }
  }, delayMs);
}

export function removeFromRetry(itemPath: string) {
  if (retryWatchers[itemPath]) {
    clearTimeout(retryWatchers[itemPath].nextRetry);

    delete retryWatchers[itemPath];
  }
}

export async function loop(enqueueIfNeeded: Function) {
  while (1) {
    await fWait();

    const maxRetry = getMaxRetry();
    const needRetryWatchItem = Object.values(retryWatchers).filter(
      (watcher: RetryWatcher) =>
        watcher.retryCounter < maxRetry && watcher.retry,
    );

    for (const watcher of needRetryWatchItem) {
      const item: any = await getItemIfNeededRetry(watcher);

      if (item !== null) {
        enqueueIfNeeded(item);
      }
    }
  }
}

async function getItemIfNeededRetry(watcher: any) {
  try {
    const item: any = await getItemByItemPath(watcher.itemPath);

    const isProvisioning = item.status?.conditions?.find(
      (condition: any) =>
        condition.type === 'PROVISIONING' && condition.status === 'True',
    );

    if (isProvisioning) return null;

    const errorCondition = item.status?.conditions?.find(
      (condition: any) =>
        condition.type === 'ERROR' && condition.status === 'True',
    );

    if (errorCondition) return item;

    return null;
  } catch (e: any) {
    if (e.message && e.message.includes('Error on getItemByItemPath')) {
      log.debug(
        `Item '${watcher.itemPath}' not found, so it has been removed from the retry process.`,
      );
      removeFromRetry(watcher.itemPath);

      return null;
    } else {
      log.warn(
        `Unexpected error in retry check for '${watcher.itemPath}': ${e}`,
      );
    }

    return null;
  }
}

function fWait(segs = 1) {
  return new Promise<void>((ok) => {
    setTimeout(() => ok(), segs * 1000);
  });
}
