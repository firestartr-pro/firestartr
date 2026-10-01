import { Semaphore } from './semaphore';

const DEFAULT_MAX_CONCURRENT_API_CALLS = 50;

const MIN_CONCURRENT_API_CALLS_PER_SLOT = 4;

function parseMaxSlots(value: string | undefined): number {
  if (value === undefined) return 1;

  const parsed = Number(value);
  const floored = Math.floor(parsed);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || floored < 1) return 1;

  return floored;
}

export function computeMaxConcurrentApiCalls(
  rawMaxConcurrent: string | undefined,
  rawMaxSlots: string | undefined,
): number {
  const maxSlots = parseMaxSlots(rawMaxSlots);
  const minRequired = maxSlots * MIN_CONCURRENT_API_CALLS_PER_SLOT;

  if (rawMaxConcurrent === undefined) {
    return Math.max(DEFAULT_MAX_CONCURRENT_API_CALLS, minRequired);
  }

  const parsed = Number(rawMaxConcurrent);
  const floored = Math.floor(parsed);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || floored < 1) {
    return Math.max(DEFAULT_MAX_CONCURRENT_API_CALLS, minRequired);
  }

  return Math.max(floored, minRequired);
}

export const apiReadSemaphore = new Semaphore(
  computeMaxConcurrentApiCalls(
    process.env.OPERATOR_MAX_CONCURRENT_API_CALLS,
    process.env.OPERATOR_NUMBER_OF_MAX_SLOTS,
  ),
);

let _peakConcurrentApiCalls = 0;

export async function withApiReadSlot<T>(read: () => Promise<T>): Promise<T> {
  await apiReadSemaphore.acquire();

  const current = apiReadSemaphore.current;
  if (current > _peakConcurrentApiCalls) {
    _peakConcurrentApiCalls = current;
  }

  try {
    return await read();
  } finally {
    apiReadSemaphore.release();
  }
}

export function getPeakConcurrentApiCalls(): number {
  return _peakConcurrentApiCalls;
}

export function getCurrentConcurrentApiCalls(): number {
  return apiReadSemaphore.current;
}

export function getPendingApiCalls(): number {
  return apiReadSemaphore.waiting;
}

export function getMaxConcurrentApiCalls(): number {
  return apiReadSemaphore.max;
}

export function getTotalApiAcquisitions(): number {
  return apiReadSemaphore.totalAcquisitions;
}

export function getTimesSemaphoreSaturated(): number {
  return apiReadSemaphore.timesSaturated;
}
