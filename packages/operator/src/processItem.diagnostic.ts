import * as fs from 'fs';

import log from './logger';

import {
  getCurrentConcurrentApiCalls,
  getMaxConcurrentApiCalls,
  getPeakConcurrentApiCalls,
  getPendingApiCalls,
  getTotalApiAcquisitions,
  getTimesSemaphoreSaturated,
} from './utils/api-read-limiter';

import { getDiagnosticErrorCount } from './diagnosticErrors';

const DIAGNOSTIC_FILE = '/tmp/diagnostic';
const DEFAULT_DIAGNOSTIC_INTERVAL_SECONDS = 30;
// setTimeout/setInterval clamp any delay above 2^31-1 ms to 1 ms, which would
// turn a large configured interval into a tight write loop.
const MAX_DIAGNOSTIC_INTERVAL_SECONDS = Math.floor((2 ** 31 - 1) / 1000);

/**
 * Queue state the diagnostic file needs. Producers own the queue and expose it
 * through this seam, so this module never reaches into queue internals.
 */
export interface DiagnosticQueueSnapshot {
  total: number;
  pending: number;
  processing: number;
  finished: number;
  blocked: number;
  deadLetter: number;
  /** `slot-<id>` -> `"<kind>/<name>"` for the work item that slot is running. */
  slots: Record<string, string>;
}

let _diagnosticTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Reads `OPERATOR_DIAGNOSTIC_INTERVAL_SECONDS`, falling back to the default for
 * absent or unusable values so a typo cannot disable diagnostics.
 */
export function getDiagnosticIntervalSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.OPERATOR_DIAGNOSTIC_INTERVAL_SECONDS;

  if (raw === undefined) return DEFAULT_DIAGNOSTIC_INTERVAL_SECONDS;

  const parsed = Number(raw.trim());

  if (
    !Number.isFinite(parsed) ||
    parsed < 1 ||
    parsed > MAX_DIAGNOSTIC_INTERVAL_SECONDS
  ) {
    return DEFAULT_DIAGNOSTIC_INTERVAL_SECONDS;
  }

  return Math.round(parsed);
}

/**
 * Starts the periodic diagnostic writer and writes the first snapshot right
 * away, so the file exists before any work item arrives.
 *
 * Idempotent: a second call while a writer is running is a no-op, so the
 * startup path and the in-loop call never race on the same file.
 *
 * @returns whether this call started the writer.
 */
export function startDiagnosticFile(
  source: () => DiagnosticQueueSnapshot,
  maxSlots: number,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (_diagnosticTimer !== undefined) {
    log.info('Diagnostic file writer already running, keeping the active one');
    return false;
  }

  if (env.DISABLE_DIAGNOSTIC_FILE) {
    log.info('Diagnostic file disabled by DISABLE_DIAGNOSTIC_FILE');
    return false;
  }

  const intervalSeconds = getDiagnosticIntervalSeconds(env);
  let running = false;

  const writeSnapshot = () => {
    if (running) return;

    running = true;

    // The source is read inside the snapshot builder, so a throwing seam becomes
    // a logged rejection instead of escaping into the caller.
    writeDiagnosticSnapshot(source, maxSlots)
      .then(() => {
        running = false;
      })
      .catch((err) => {
        // Best-effort: a failed snapshot never crashes the operator; the next
        // tick retries with a fresh snapshot.
        running = false;
        log.error(`Error writing diagnostic file: ${err}`);
      });
  };

  writeSnapshot();

  _diagnosticTimer = setInterval(writeSnapshot, intervalSeconds * 1000);

  // Diagnostics must never keep the process alive nor change termination
  // behaviour: an unref'd timer cannot hold the process open, so shutting down
  // is left entirely to the operator's own signal handlers.
  if (typeof _diagnosticTimer.unref === 'function') _diagnosticTimer.unref();

  log.info(`Diagnostic file writer started (every ${intervalSeconds}s)`);

  return true;
}

export function stopDiagnosticFile(): void {
  if (_diagnosticTimer !== undefined) {
    clearInterval(_diagnosticTimer);
    _diagnosticTimer = undefined;
  }
}

/** @internal for testing */
export function getDiagnosticTimer(): NodeJS.Timeout | undefined {
  return _diagnosticTimer;
}

async function writeDiagnosticSnapshot(
  source: () => DiagnosticQueueSnapshot,
  maxSlots: number,
): Promise<void> {
  const snapshot = source();
  const now = new Date().toISOString();

  const { pending, processing, finished, blocked, deadLetter } = snapshot;

  // Per-slot items
  const slotsMap: Record<string, string> = {};

  for (let i = 0; i < maxSlots; i++) {
    const key = `slot-${i}`;
    slotsMap[key] = snapshot.slots[key] ?? 'null';
  }

  // Semaphore stats
  const semaphoreCurrent = getCurrentConcurrentApiCalls();
  const semaphoreMax = getMaxConcurrentApiCalls();
  const semaphorePeak = getPeakConcurrentApiCalls();
  const semaphorePending = getPendingApiCalls();
  const semaphoreTotalAcquisitions = getTotalApiAcquisitions();
  const semaphoreTimesSaturated = getTimesSemaphoreSaturated();

  // Environment
  const envMaxSlots = process.env.OPERATOR_NUMBER_OF_MAX_SLOTS || '1';
  const envMaxConcurrentApi =
    process.env.OPERATOR_MAX_CONCURRENT_API_CALLS || '25';
  const envKindList = process.env.OPERATOR_KIND_LIST || '';
  const envTfmMirrorDisable = process.env.TFM_MIRROR_DISABLE || '0';
  const envTfmMirrorList = process.env.TFM_MIRROR_LIST || '';
  const envTfmMirrorRefreshInterval =
    process.env.TFM_MIRROR_REFRESH_INTERVAL || '900';
  const envBackendProvider =
    process.env.BACKEND_PROVIDER_NAME || 'kubernetes-provider';
  const envGithubAppId = process.env.GITHUB_APP_ID || '';
  const envTfmSkipGitConfig = process.env.TFM_SKIP_GIT_CONFIG || 'false';

  // CRD diagnostics: observed kinds (from OPERATOR_KIND_LIST) and missing CRDs.
  // `__crdMonitors` keeps one registration per kind whose CRD was absent when
  // observeKind ran, and a stopped monitor stays registered (crdMonitor only
  // flips isStarted). Such a kind has no informer attached until the operator is
  // restarted, so it must never be reported as observed. Deriving the
  // exclusions from the retained registrations - not from a sampled isStarted()
  // state - keeps a kind excluded when its monitor starts and stops between two
  // ticks, or registers after the first snapshot.
  const observedKindsRaw = envKindList
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const missingCrds: string[] = [];
  const registeredPlurals = new Set<string>();
  try {
    const monitors = (global as any).__crdMonitors as
      Map<string, any> | undefined;
    if (monitors && typeof monitors === 'object') {
      for (const [key, monitor] of monitors) {
        // key shape is namespace/plural (reflector uses `${namespace}/${plural}`)
        const plural = String(key).split('/').pop()?.toLowerCase();
        if (plural) registeredPlurals.add(plural);

        try {
          if (
            monitor &&
            typeof monitor.isStarted === 'function' &&
            monitor.isStarted()
          ) {
            missingCrds.push(String(key));
          }
        } catch (e) {
          // ignore individual monitor failures
        }
      }
    }
  } catch (e) {
    // defensive: do not fail diagnostic writing if globals are not present
  }

  const observedKinds = observedKindsRaw.filter(
    (k) => !registeredPlurals.has(k.toLowerCase()),
  );

  // Build YAML output
  let output = '';
  output += `timestamp: "${now}"\n`;
  output += 'env:\n';
  output += `  OPERATOR_NUMBER_OF_MAX_SLOTS: ${envMaxSlots}\n`;
  output += `  OPERATOR_MAX_CONCURRENT_API_CALLS: ${envMaxConcurrentApi}\n`;
  output += `  OPERATOR_KIND_LIST: ${envKindList}\n`;
  output += `  TFM_MIRROR_DISABLE: ${envTfmMirrorDisable}\n`;
  output += `  TFM_MIRROR_LIST: ${envTfmMirrorList}\n`;
  output += `  TFM_MIRROR_REFRESH_INTERVAL: ${envTfmMirrorRefreshInterval}\n`;
  output += `  BACKEND_PROVIDER_NAME: ${envBackendProvider}\n`;
  output += `  GITHUB_APP_ID: ${envGithubAppId}\n`;
  output += `  TFM_SKIP_GIT_CONFIG: ${envTfmSkipGitConfig}\n`;
  output += 'queue:\n';
  output += `  total: ${snapshot.total}\n`;
  output += `  pending: ${pending}\n`;
  output += `  processing: ${processing}\n`;
  output += `  finished: ${finished}\n`;
  output += `  blocked: ${blocked}\n`;
  output += `  dead_letter: ${deadLetter}\n`;
  output += 'slots:\n';
  output += `  max: ${maxSlots}\n`;
  output += `  active: ${processing}\n`;
  output += '  items_per_slot:\n';
  for (let i = 0; i < maxSlots; i++) {
    const key = `slot-${i}`;
    const val = slotsMap[key];
    output += `    ${key}: ${val === 'null' ? 'null' : `"${val}"`}\n`;
  }
  output += 'semaphore:\n';
  output += `  max: ${semaphoreMax}\n`;
  output += `  in_use: ${semaphoreCurrent}\n`;
  output += `  available: ${semaphoreMax - semaphoreCurrent}\n`;
  output += `  pending: ${semaphorePending}\n`;
  output += `  peak: ${semaphorePeak}\n`;
  output += `  total_acquisitions: ${semaphoreTotalAcquisitions}\n`;
  output += `  times_saturated: ${semaphoreTimesSaturated}\n`;
  output += 'errors:\n';
  output += `  total: ${getDiagnosticErrorCount()}\n`;
  // CRD view
  output += 'crds:\n';
  output += '  observed:\n';
  for (const k of observedKinds) {
    output += `    - "${k}"\n`;
  }
  output += '  missing:\n';
  for (const m of missingCrds) {
    output += `    - "${m}"\n`;
  }

  return new Promise((resolve, reject) => {
    fs.writeFile(DIAGNOSTIC_FILE, output, (err) => {
      if (err) reject(`Writing ${DIAGNOSTIC_FILE}: ${err}`);
      else resolve();
    });
  });
}
