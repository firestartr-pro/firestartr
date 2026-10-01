import { WorkItem, WorkStatus } from './definitions';

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
const DIAGNOSTIC_INTERVAL_MS = 10 * 1000;

let _diagnosticTimer: ReturnType<typeof setInterval> | undefined;
// Capture the set of CRD plurals that were missing when diagnostics began.
// Once recorded, observedKinds will permanently exclude kinds whose plural
// was missing at startup so that CRDs applied later while the operator is
// running do not retroactively appear in the observed list.
let _initialMissingPlurals: Set<string> | undefined;

function clearTimer(): void {
  if (_diagnosticTimer !== undefined) {
    clearInterval(_diagnosticTimer);
    _diagnosticTimer = undefined;
  }
}

export function loopDiagnosticFile(queue: WorkItem[], maxSlots: number): void {
  if (process.env.DISABLE_DIAGNOSTIC_FILE) {
    log.info('Diagnostic file disabled by DISABLE_DIAGNOSTIC_FILE');
    return;
  }

  let running = false;

  _diagnosticTimer = setInterval(() => {
    if (running) return;

    running = true;

    writeDiagnosticSnapshot(queue, maxSlots)
      .then(() => {
        running = false;
      })
      .catch((err) => {
        running = false;
        log.error(`Error writing diagnostic file: ${err}`);
      });
  }, DIAGNOSTIC_INTERVAL_MS);

  // Clear the interval on termination signals so the process can exit cleanly
  const onSignal = () => clearTimer();
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

/** @internal for testing */
export function getDiagnosticTimer(): NodeJS.Timeout | undefined {
  return _diagnosticTimer;
}

async function writeDiagnosticSnapshot(
  queue: WorkItem[],
  maxSlots: number,
): Promise<void> {
  const now = new Date().toISOString();

  // Queue counts
  let pending = 0;
  let processing = 0;
  let finished = 0;
  let blocked = 0;
  let deadLetter = 0;

  // Per-slot items
  const slotsMap: Record<string, string> = {};

  for (const wi of queue) {
    switch (wi.workStatus) {
      case WorkStatus.PENDING:
        pending++;
        break;
      case WorkStatus.PROCESSING:
        processing++;
        break;
      case WorkStatus.FINISHED:
        finished++;
        break;
    }

    if (wi.isBlocked) {
      blocked++;
    }
    if (wi.isDeadLetter) {
      deadLetter++;
    }

    if (wi.workStatus === WorkStatus.PROCESSING && wi.slotId !== undefined) {
      slotsMap[`slot-${wi.slotId}`] =
        `${wi.item.kind}/${wi.item.metadata.name}`;
    }
  }

  // Fill empty slots with null
  for (let i = 0; i < maxSlots; i++) {
    if (!slotsMap[`slot-${i}`]) {
      slotsMap[`slot-${i}`] = 'null';
    }
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

  // CRD diagnostics: observed kinds (from OPERATOR_KIND_LIST) and missing CRDs
  // missing CRDs are derived from the runtime __crdMonitors map; any monitor
  // that is started indicates an actively-missing CRD that is being watched.
  const observedKindsRaw = envKindList
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const missingCrds: string[] = [];
  try {
    const monitors = (global as any).__crdMonitors as
      | Map<string, any>
      | undefined;
    if (monitors && typeof monitors === 'object') {
      for (const [key, monitor] of monitors) {
        try {
          if (
            monitor &&
            typeof monitor.isStarted === 'function' &&
            monitor.isStarted()
          ) {
            // key shape is namespace/plural (reflector uses `${namespace}/${plural}`)
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

  // Compute the set of plurals that were missing when diagnostics started.
  // We only capture this once so that CRDs installed while the operator
  // is running do not cause previously-missing kinds to become observed.
  if (!_initialMissingPlurals) {
    _initialMissingPlurals = new Set(
      missingCrds.map((k) => String(k).split('/').pop()?.toLowerCase() || ''),
    );
  }

  const observedKinds = observedKindsRaw.filter(
    (k) => !_initialMissingPlurals!.has(k.toLowerCase()),
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
  output += `  total: ${queue.length}\n`;
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
