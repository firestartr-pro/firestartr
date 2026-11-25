import type { AuditTrailOptions } from '../../mutations/auditIssue.js';
import type { Pulse } from '../../mutations/publish.js';

export type ApplyRepoState =
  'merged' | 'provisioned' | 'open' | 'skipped' | 'failed';

export type ApplyOutcome = 'done' | 'pending' | 'failed' | 'not_ready';

export interface ApplyPrRef {
  number: number;
  url: string;
}

export interface ApplyRepoResult {
  repo: string;
  branch: string;
  pr?: ApplyPrRef;
  state: ApplyRepoState;
  reason?: string;
}

export interface ApplyStepResult {
  step: 1 | 2 | 3;
  repos: ApplyRepoResult[];
}

export interface ApplyAppResult {
  outcome: ApplyOutcome;
  steps: ApplyStepResult[];
  auditIssue?: ApplyPrRef;
  reason?: string;
}

export interface ApplyAppOptions {
  noWait?: boolean;
  /** Per-step timeout in milliseconds (default: 30 minutes). */
  timeoutMs?: number;
  /** Poll interval for PR merge checks in milliseconds (default: 5000). */
  pollIntervalMs?: number;
  audit?: AuditTrailOptions;
  pulse?: Pulse;
  stateRepos?: string[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
