import common from 'catalog_common';
import { getStatusCode as getHttpStatusCode } from '../errors/status-code';
import { WAIT_FOR_CR_TIMEOUT_SECONDS } from '../test-constants';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
} from '../utils/async-control';
import { isTransientError } from '../utils/transient-errors';

import type { E2EApi } from '../types';

const DEFAULT_GITHUB_POLL_INTERVAL_MS = 5000;
// 409/423 are GitHub-specific transient codes; 408/429/5xx are covered by
// isTransientError. 403 with a secondary-rate-limit message is also retried.
const EXTRA_RETRYABLE_STATUS_CODES = new Set([409, 423]);
const RETRYABLE_403_MESSAGE =
  /(secondary rate limit|please wait a few minutes before you try again|abuse detection)/i;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }

  return String(error);
}

export function isRetryableGitHubError(error: unknown): boolean {
  if (isTransientError(error)) return true;
  const statusCode = getHttpStatusCode(error as { status?: number });
  if (statusCode !== undefined && EXTRA_RETRYABLE_STATUS_CODES.has(statusCode))
    return true;
  const message = getErrorMessage(error);
  return statusCode === 403 && RETRYABLE_403_MESSAGE.test(message);
}

export async function waitForOrgWebhookState(
  client: E2EApi,
  url: string,
  exists: boolean,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<void> {
  await pollUntil(
    async () => {
      try {
        return await client.gh.orgWebhookExists(url);
      } catch (error) {
        if (isRetryableGitHubError(error)) {
          throw createRetryableError(error);
        }

        throw error;
      }
    },
    {
      timeoutMs: options.timeoutMs ?? WAIT_FOR_CR_TIMEOUT_SECONDS * 1000,
      intervalMs: options.intervalMs ?? DEFAULT_GITHUB_POLL_INTERVAL_MS,
      isDone: (value) => value === exists,
      shouldRetryError: isRetryableError,
      onRetryError: (error, intervalMs) => {
        common.logger.warn(
          `Retrying org webhook wait after ${intervalMs}ms due to: ${getErrorMessage(error)}`,
        );
      },
      createTimeoutError: (lastValue) =>
        new Error(
          `Timed out waiting for org webhook '${url}' to ${
            exists ? 'exist' : 'be deleted'
          }. Last observed exists=${String(lastValue)}.`,
        ),
    },
  );
}
