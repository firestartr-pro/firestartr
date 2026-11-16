import { isPlanMode } from './config';

export class PlanModeWriteError extends Error {
  target: string;

  constructor(target: string) {
    super(`Plan mode is read-only: refusing to write ${target}`);

    this.name = 'PlanModeWriteError';

    this.target = target;
  }
}

/**
 * The write gateway: every cluster and GitHub write calls this first. In Plan
 * mode it throws, so a missed write path fails loudly instead of silently
 * changing a cluster.
 */
export function assertWriteAllowed(target: string): void {
  if (isPlanMode()) throw new PlanModeWriteError(target);
}
