import log from '../logger';

export const DEPENDENCY_CHECK_INTERVAL_MS = 60 * 1000;

/** `ready` requeues the CR, `gone` forgets it, `waiting` checks again later. */
export type DependencyState = 'ready' | 'waiting' | 'gone';

const waits = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Keeps checking in memory, for a CR whose plan was SKIPPED because a
 * dependency is missing, until that dependency is available, and then
 * requeues the CR. Nothing requeues it otherwise: a parent becoming ready
 * only changes its status. The SKIPPED artifact stays until the next plan.
 */
export function waitForDependencies(
  itemPath: string,
  check: () => Promise<DependencyState>,
  requeue: () => void,
  intervalMs: number = DEPENDENCY_CHECK_INTERVAL_MS,
): void {
  cancelDependencyWait(itemPath);

  const schedule = () => {
    const timer = setTimeout(async () => {
      let state: DependencyState;

      try {
        state = await check();
      } catch (e) {
        log.warn(`Dependency check failed for '${itemPath}': ${e}`);

        state = 'waiting';
      }

      // A newer plan of the same CR replaced or cancelled this wait
      if (waits.get(itemPath) !== timer) return;

      if (state === 'waiting') {
        schedule();

        return;
      }

      waits.delete(itemPath);

      if (state === 'ready') {
        log.info(
          `The dependencies of '${itemPath}' are available: planning it again`,
        );

        requeue();
      }
    }, intervalMs);

    waits.set(itemPath, timer);
  };

  schedule();
}

export function cancelDependencyWait(itemPath: string): void {
  const timer = waits.get(itemPath);

  if (timer === undefined) return;

  clearTimeout(timer);

  waits.delete(itemPath);
}

export function isWaitingForDependencies(itemPath: string): boolean {
  return waits.has(itemPath);
}
