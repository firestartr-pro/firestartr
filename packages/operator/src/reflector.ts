import * as k8s from '@kubernetes/client-node';
import { Store } from './store';
import { getConnection } from './ctl';
import log from './logger';
import { isKubernetesNotFoundError } from './status';
import createCrdMonitor from './crdMonitor';
import { logActivity } from './activity-log';

/**
 * Execute the callbacks for each item in the store
 * @param {string} plural - Kind to observe
 * @param {string} namespace - Namespace to observe
 * @param {Function} onAdd - Function to call when an item is added
 * @param {Function} onChange - Function to call when an item is modified
 * @param {Function} onDelete - Function to call when an item is deleted
 * @param {Function} onRename - Function to call when an item is renamed
 */
export async function observe(
  plural: string,
  namespace: string,
  onAdd: Function,
  onChange: Function,
  onDelete: Function,
  _onRename: Function,
) {
  const store = new Store(plural);

  const { kc } = await getConnection();

  try {
    const k8sApi = kc.makeApiClient(k8s.CustomObjectsApi);

    const apiGroup = 'firestartr.dev';

    // Attempt to read the CRD to determine the served version and scope so
    // we build the informer against the correct custom-objects endpoint.
    let apiVersion = 'v1';
    let scope = 'Namespaced';
    try {
      const apix = kc.makeApiClient(k8s.ApiextensionsV1Api);
      const name = `${plural}.${apiGroup}`;
      const crdResp = await (apix as any).readCustomResourceDefinition(name);
      const crdBody = crdResp?.body ?? crdResp;
      const versions: Array<any> = crdBody?.spec?.versions || [];
      apiVersion =
        versions.find((v: any) => v?.served)?.name ||
        crdBody?.spec?.version ||
        apiVersion;
      scope = crdBody?.spec?.scope || scope;
    } catch (e) {
      // If reading the CRD fails, keep the conservative fallback (v1,
      // Namespaced). The existing error handling around informer start will
      // treat 404s/missing CRD as missing and schedule the monitor.
      log.debug(
        `Reflector: failed to read CRD for '${plural}': ${e} — falling back to apiVersion='${apiVersion}', scope='${scope}'`,
      );
    }

    // Build apiPaths and list function depending on scope.
    const apiPaths =
      scope === 'Cluster'
        ? `/apis/${apiGroup}/${apiVersion}/${plural}`
        : `/apis/${apiGroup}/${apiVersion}/namespaces/${namespace}/${plural}`;

    const listFn = () => {
      if (scope === 'Cluster') {
        return k8sApi.listClusterCustomObject({
          group: apiGroup,
          version: apiVersion,
          plural,
        } as any);
      }

      return k8sApi.listNamespacedCustomObject({
        group: apiGroup,
        version: apiVersion,
        namespace,
        plural,
      } as any);
    };

    const informer = k8s.makeInformer(kc, apiPaths, listFn as any);

    informer.on('add', (obj: any) => {
      store.add(obj);

      if (store.hasDeletionTimestamp(obj)) {
        logActivity(
          'DELETE',
          obj.kind,
          obj.metadata.name,
          obj.metadata.namespace,
          obj.metadata.resourceVersion,
        );
        log.info(
          `Reflector has marked item '${obj.kind}/${obj.metadata.name}' for deletion.`,
        );
        store.markToDelete(obj);

        onDelete(obj);
      } else {
        log.info(
          `Reflector has added item '${obj.kind}/${obj.metadata.name}'.`,
        );
        onAdd(obj);
      }
    });

    informer.on('update', (obj: any) => {
      logActivity(
        'UPDATE',
        obj.kind,
        obj.metadata.name,
        obj.metadata.namespace,
        obj.metadata.resourceVersion,
      );
      log.info(
        `Reflector has updated item '${obj.kind}/${obj.metadata.name}' to a new resource version: '${obj.metadata.resourceVersion}'.`,
      );

      if (
        !store.getItem(obj).markedToDelete &&
        store.hasDeletionTimestamp(obj) &&
        (store.hasBeenMarkedToDelete(obj) || store.modified(obj))
      ) {
        log.info(
          `Reflector has updated item '${obj.kind}/${obj.metadata.name}' and marked it for deletion.`,
        );
        store.markToDelete(obj);

        onDelete(obj);
      } else if (store.modified(obj)) {
        log.info(
          `Reflector has updated and modified item '${obj.kind}/${obj.metadata.name}'.`,
        );
        onChange(obj);
      }
    });

    informer.on('delete', (obj: any) => {
      logActivity(
        'DELETE',
        obj.kind,
        obj.metadata.name,
        obj.metadata.namespace,
        obj.metadata.resourceVersion,
      );
      // deleted from the etcd
      log.info(
        `Reflector has deleted item '${obj.kind}/${obj.metadata.name}' from the etcd.`,
      );
      store.remove(obj);
    });

    informer.on('error', (err: any) => {
      // Determine whether this is a NotFound/404 and emit our concise
      // custom missing-CRD message. Keep the full raw error at debug level.
      try {
        const statusCode =
          err?.response?.statusCode ?? err?.status ?? err?.statusCode;
        const missing = isKubernetesNotFoundError(err) || statusCode === 404;

        if (missing) {
          const key = `${namespace}/${plural}`;
          if (!(global as any).__missingCrdLogged)
            (global as any).__missingCrdLogged = new Set();
          const set: Set<string> = (global as any).__missingCrdLogged;

          if (!set.has(key)) {
            log.error(
              `Missing CRD detected for kind '${plural}'; skipping informer startup for this kind.`,
            );
            // record that we've logged this missing-CRD to avoid log spam
            set.add(key);
          }

          // Start CRD monitor if configured — unchanged behaviour.
          const CRD_CHECK_ENABLED =
            process.env.FIRESTARTR_CRD_CHECK_ENABLED !== 'false';
          // Parse interval env with validation — fall back to a sane default (60s)
          // Empty string -> 0, non-numeric -> NaN. Treat any non-positive or
          // non-finite value as invalid and use the default.
          const DEFAULT_CRD_CHECK_INTERVAL = 60;
          const parsedInterval = Number(
            process.env.FIRESTARTR_CRD_CHECK_INTERVAL_SECONDS,
          );
          const CRD_CHECK_INTERVAL =
            Number.isFinite(parsedInterval) && parsedInterval > 0
              ? Math.round(parsedInterval)
              : DEFAULT_CRD_CHECK_INTERVAL;

          if (CRD_CHECK_ENABLED) {
            try {
              if (!(global as any).__crdMonitors)
                (global as any).__crdMonitors = new Map();
              const monitors: Map<string, any> = (global as any).__crdMonitors;
              if (!monitors.has(key)) {
                const monitor = createCrdMonitor(plural, {
                  enabled: true,
                  intervalSeconds: CRD_CHECK_INTERVAL,
                  apiGroup: 'firestartr.dev',
                  namespace,
                });

                monitors.set(key, monitor);
                monitor.start();
                log.info(`Started CRD monitor for missing kind '${plural}'`);
              }
            } catch (sErr) {
              log.error(
                `Failed to schedule CRD monitor for '${plural}': ${sErr}`,
              );
            }
          }

          log.debug(
            `Reflector raw error for '${plural}' in '${namespace}': ${err}`,
          );
          return;
        }
      } catch (inspectErr) {
        log.error(
          `Failed to inspect reflector error for missing CRD: ${inspectErr}`,
        );
        // fall through to retry logic
      }

      // Non-missing errors -> concise error at error level, full details at debug
      log.error(
        `Reflector error for '${plural}' in namespace '${namespace}': ${err?.message ?? err}`,
      );
      log.debug(`Reflector full error: ${err}`);

      setTimeout(async () => {
        try {
          log.warn(
            `Trying to recover from reflector error for '${plural}' in '${namespace}'`,
          );
          await informer.start();
          log.warn(
            `Recovered from reflector error for '${plural}' in '${namespace}'`,
          );
        } catch (startErr) {
          log.error(
            `Failed to start the reflector informer for '${plural}' in namespace '${namespace}': '${startErr}'.`,
          );
        }
      }, 5000);
    });

    await informer.start();
  } catch (err) {
    log.error(`Observing: ${plural}: ${err}`);

    throw new Error(`Observing: ${plural}: ${err}`);
  }
}
