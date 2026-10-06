import common from 'catalog_common';
import { formatResourceLabel } from './manifests';
import { formatK8sError } from './errors';
import { getStatusCode, type StatusCodeError } from '../errors/status-code';
import { waitForResourceDeletion } from './wait';

import type { CrHandle } from './cr-handle';

// Two-phase force-delete for a custom resource:
//   delete → ignore 404/410 → clear finalizers → re-delete → wait for gone.
//
// Idempotent at every step: 404/410 is tolerated so callers are safe to call
// on resources that are already absent or partially deleted.
//
// Use when resources may be stuck in Terminating during e2e teardown.
export async function forceDeleteCr(
  handle: CrHandle,
  namespace: string,
  name: string,
  timeoutSeconds: number,
): Promise<void> {
  const label = formatResourceLabel(handle.kind, name, namespace);

  // Swallow 404/410; warn on any other failure.
  const ignoreAbsent = async (
    verb: string,
    op: () => Promise<void>,
  ): Promise<void> => {
    try {
      await op();
    } catch (err) {
      const code = getStatusCode(err as StatusCodeError);
      if (code !== 404 && code !== 410) {
        common.logger.warn(
          `Failed to ${verb} ${label}: ${formatK8sError(err as Error)}`,
        );
      }
    }
  };

  await ignoreAbsent('delete', () => handle.delete(namespace, name));
  await ignoreAbsent('clear finalizers for', () =>
    handle.clearFinalizers(namespace, name),
  );
  await ignoreAbsent('delete', () => handle.delete(namespace, name));

  await waitForResourceDeletion(
    handle.provider,
    namespace,
    {
      apiVersion: handle.apiVersion,
      kind: handle.kind,
      metadata: { name, namespace },
    },
    timeoutSeconds,
  );
}
