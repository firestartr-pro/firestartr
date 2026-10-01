import * as k8s from '@kubernetes/client-node';
import log from './logger';
import { getConnection } from './ctl';
import { isKubernetesNotFoundError } from './status';

export interface CrdMonitorOpts {
  enabled?: boolean;
  intervalSeconds?: number;
  apiGroup?: string;
  namespace?: string;
}

export function createCrdMonitor(plural: string, opts: CrdMonitorOpts = {}) {
  const apiGroup = opts.apiGroup ?? 'firestartr.dev';
  const intervalSeconds = opts.intervalSeconds ?? 60;
  const enabled = opts.enabled !== undefined ? opts.enabled : true;

  let timer: NodeJS.Timeout | null = null;
  let started = false;

  async function checkOnce() {
    try {
      const { kc } = await getConnection();
      const api = kc.makeApiClient(k8s.ApiextensionsV1Api);
      const name = `${plural}.${apiGroup}`;

      // Defensive check: some runtime environments / client versions may surface
      // a RequiredError if the name parameter is undefined. Guard and emit a
      // clear log entry instead of calling the client with an invalid value.
      if (!name) {
        log.error(
          `CRD monitor: computed CRD name is empty for plural='${plural}' apiGroup='${apiGroup}'. Skipping check.`,
        );
        return;
      }

      // Call through `any` to accept varying client signatures across different
      // @kubernetes/client-node versions. Try a few plausible signatures so
      // runtime RequiredError / signature mismatches are handled gracefully.
      let crdResp: any;
      try {
        crdResp = await (api as any).readCustomResourceDefinition(name);
      } catch (firstErr) {
        // Some client versions expect a parameter object rather than a raw
        // string. Try the alternative form and log the original error at
        // debug level for diagnosis.
        log.debug(
          `CRD monitor: readCustomResourceDefinition first attempt failed: ${firstErr}`,
        );
        try {
          crdResp = await (api as any).readCustomResourceDefinition({ name });
        } catch (secondErr) {
          log.debug(
            `CRD monitor: readCustomResourceDefinition second attempt failed: ${secondErr}`,
          );
          // Re-throw the second error to be handled by outer catch
          throw secondErr;
        }
      }

      // Normalize response body across client versions
      const crdBody = crdResp?.body ?? crdResp;

      // Determine served version to probe and whether the resource is namespaced
      const versions: Array<any> = crdBody?.spec?.versions || [];
      const servedVersion =
        versions.find((v: any) => v?.served)?.name ||
        crdBody?.spec?.version ||
        'v1';
      const scope = crdBody?.spec?.scope || 'Namespaced';

      // Additional verification: some k8s API servers will report the CRD as
      // present via the apiextensions endpoint before the custom objects
      // list/watch endpoints for the new resource are available. To avoid a
      // race where informer.start() still fails with 404, perform a light
      // probe against the custom objects API for the appropriate scope and
      // version and only proceed after that probe succeeds.
      try {
        const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
        // If the CRD is cluster-scoped, probe the cluster endpoint; otherwise
        // probe the namespaced endpoint. Client signatures vary between
        // @kubernetes/client-node versions: some accept positional params and
        // others expect a single request object. Try both forms.
        if (scope === 'Cluster') {
          try {
            await (customApi as any).listClusterCustomObject(
              apiGroup,
              servedVersion,
              plural,
            );
          } catch (firstErr) {
            log.debug(
              `CRD monitor: listClusterCustomObject first attempt failed: ${firstErr}`,
            );
            // Try object form
            await (customApi as any).listClusterCustomObject({
              group: apiGroup,
              version: servedVersion,
              plural,
            });
          }
        } else {
          // Require a namespace to probe namespaced resources; if not
          // provided, attempt cluster probe as conservative fallback.
          if (opts.namespace) {
            try {
              await (customApi as any).listNamespacedCustomObject(
                apiGroup,
                servedVersion,
                opts.namespace,
                plural,
              );
            } catch (firstErr) {
              log.debug(
                `CRD monitor: listNamespacedCustomObject first attempt failed: ${firstErr}`,
              );
              // Try object form
              await (customApi as any).listNamespacedCustomObject({
                group: apiGroup,
                version: servedVersion,
                namespace: opts.namespace,
                plural,
              });
            }
          } else {
            try {
              await (customApi as any).listClusterCustomObject(
                apiGroup,
                servedVersion,
                plural,
              );
            } catch (firstErr) {
              log.debug(
                `CRD monitor: listClusterCustomObject first attempt failed (fallback path): ${firstErr}`,
              );
              await (customApi as any).listClusterCustomObject({
                group: apiGroup,
                version: servedVersion,
                plural,
              });
            }
          }
        }
      } catch (probeErr: any) {
        // If the probe fails with NotFound/404, treat as still missing and
        // return early so the monitor will retry on next tick. Other
        // transient errors are logged and will also be retried.
        const probeStatus =
          probeErr?.response?.statusCode ??
          probeErr?.status ??
          probeErr?.statusCode;
        if (isKubernetesNotFoundError(probeErr) || probeStatus === 404) {
          log.error(
            `CRD monitor: custom objects endpoint for '${plural}.${apiGroup}' not yet available (version=${servedVersion}, scope=${scope}) in namespace '${opts.namespace}'`,
          );
          return;
        }

        log.error(
          `CRD monitor: error probing custom objects endpoint for '${plural}.${apiGroup}' (version=${servedVersion}, scope=${scope}) in namespace '${opts.namespace}': ${probeErr}`,
        );
        return;
      }

      // At this point the CRD exists and (if namespace provided) the
      // custom-objects endpoint responded. Per policy we DO NOT attempt to
      // reattach informers automatically. Instead emit a single availability
      // alert and stop the monitor so we do not spam logs.
      try {
        const key = `${opts.namespace ?? 'cluster'}/${plural}`;
        if (!(global as any).__crdAvailableAlerted)
          (global as any).__crdAvailableAlerted = new Set();
        const alerted: Set<string> = (global as any).__crdAvailableAlerted;
        if (!alerted.has(key)) {
          alerted.add(key);
          log.warn(
            `CRD monitor: CRD '${name}' is now available in namespace '${opts.namespace ?? 'cluster-wide'}'. Operator must be restarted to resume watching '${plural}'. No automatic reattach will be performed.`,
          );

          // Mark the missing-CRD as alerted so upstream reflectors can stop
          // logging the repeated missing-CRD messages for this plural+namespace.
          if (!(global as any).__missingCrdLogged)
            (global as any).__missingCrdLogged = new Set();
          const missingSet: Set<string> = (global as any).__missingCrdLogged;
          missingSet.add(key);
        }

        // Stop the monitor after emitting the one-shot alert.
        stop();
        return;
      } catch (alertErr) {
        log.error(
          `CRD monitor: error while handling availability for '${name}': ${alertErr}`,
        );
        // Even if alerting fails, stop to avoid repeated log noise.
        stop();
        return;
      }
    } catch (err: any) {
      // Treat 404 / NotFound as missing; anything else is transient and retried next tick
      const status = err?.response?.statusCode ?? err?.statusCode;
      // Use the centralized helper for robust detection
      if (isKubernetesNotFoundError(err) || status === 404) {
        log.error(
          `CRD monitor: CRD '${plural}.${apiGroup}' is missing (checked).`,
        );
        return;
      }

      // Other errors — log and retry next tick
      log.error(
        `CRD monitor: error checking CRD '${plural}.${apiGroup}': ${err}`,
      );
    }
  }

  function start() {
    if (!enabled) return;
    if (timer) return;

    // Mark started before scheduling so isStarted() reflects lifecycle
    // immediately for callers that check synchronously.
    started = true;

    // Run immediately, then every interval (schedule immediately so Jest's
    // fake timers can drive the repeated calls predictably).
    void checkOnce();
    timer = setInterval(() => {
      void checkOnce();
    }, intervalSeconds * 1000) as unknown as NodeJS.Timeout;
    log.info(
      `CRD monitor: started for '${plural}' (interval ${intervalSeconds}s)`,
    );
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    // Reflect that the monitor has stopped so isStarted() is accurate.
    started = false;
  }

  return {
    start,
    stop,
    isStarted: () => started,
  };
}

export default createCrdMonitor;
