import type { K8sApiError } from './types';
import { getStatusCode } from '../errors/status-code';

// Format a Kubernetes API error into a readable string.
export function formatK8sError(error: K8sApiError): string {
  const status = getStatusCode(error);
  const message = error?.message ?? 'Unknown error';
  let body: unknown;
  if (typeof error?.body === 'string') {
    try {
      body = JSON.parse(error.body);
    } catch {
      body = error.body;
    }
  } else {
    body = error?.body;
  }
  const bodyText = body !== undefined ? ` body=${JSON.stringify(body)}` : '';

  return `status=${status ?? 'unknown'} message=${message}${bodyText}`;
}

// Check if an error indicates a resource was not found (404).
export function shouldRetryRead(error: K8sApiError): boolean {
  return getStatusCode(error) === 404;
}
