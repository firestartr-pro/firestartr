import { observeKind } from './src/informer';

import { dummy } from './dummy';

import { processFirestartrDummies } from './fdummies';

import { processItem } from './src/processItem';
import { processOperation as processOperationTerraform } from './src/tfworkspaces/process-operation';

import { configureTFMMirrors } from './src/tfm_mirrors';

import common from 'catalog_common';
import createCrdMonitor from './src/crdMonitor';
import { acquireLease } from './src/leader_election';
import { isKubernetesNotFoundError } from './src/status';
// processOperationPlan (tfworkspaceplans) removed — deprecated
export { execTfCommand } from './src/execTfCmd';
export { pullRequestPlan } from './src/pull-request-plan';

import { processOperation as processOperationGH } from './src/gh/process-operation';

import github from 'github';

import metricsServer from './src/metricsServer';

import { getOperatorEnvSnapshot } from './src/operator-env';

import { initActivityLog } from './src/activity-log';
import log from './src/logger';

let importModeActive = false;

let withMetricsMode = false;

export * as cmd from './src/cmd';

export function isImportMode() {
  return importModeActive;
}

let importModeSkipPlanActive = false;

export function isImportModeSkipPlan() {
  return importModeSkipPlanActive;
}

let observeModeActive = false;

export function isObserveModeActive() {
  return observeModeActive;
}

// ---- TFM Mirror Startup Coordination ----
// ----------------------------------------------------------
// (warmup and legacy provisioner code replaced by TFM mirror system)

export function runOperator(opts: any) {
  const {
    ignoreLease,
    dummyExec,
    namespace,
    kindList,
    importMode,
    importModeSkipPlan,
    observeMode,
    withMetrics,
  } = opts;

  const implementedKinds = filterImplementedKinds(kindList);

  log.info(`operator kindList: ${JSON.stringify(kindList)}`);
  log.info(`operator implementedKinds: ${JSON.stringify(implementedKinds)}`);
  log.info('operator ignoring kinds:');
  log.info(
    JSON.stringify(
      kindList.filter((k: string) => !implementedKinds.includes(k)),
    ),
  );

  if (observeMode) observeModeActive = true;

  if (withMetrics) withMetricsMode = true;

  if (importMode) importModeActive = importMode;

  if (importModeSkipPlan) importModeSkipPlanActive = importModeSkipPlan;

  initActivityLog();

  log.info(`started the operator with options ${JSON.stringify(opts)}`);

  // Create the immutable operator profile from startup env snapshot
  // Must happen before any work processing or feedback machinery
  github.createProfile('operator', {
    type: 'snapshot',
    config: getOperatorEnvSnapshot(),
  });

  const run = ignoreLease
    ? async (_namespace: string, cb: Function) => {
        await configureTFMMirrors();
        await cb();
      }
    : async (namespace: string, cb: Function) => {
        // Start tfm mirror warmup and lease acquisition concurrently, then await warmup before callback
        const mirrorsPromise = configureTFMMirrors();
        const leasePromise = new Promise<void>((resolve) => {
          void acquireLease(namespace, async () => {
            await mirrorsPromise;
            resolve();
            await cb();
          });
        });
        await leasePromise;
      };

  if (withMetricsMode) {
    void metricsServer(implementedKinds, namespace);
  }

  void (async () => {
    await run(namespace, () => {
      if (dummyExec) {
        void observeKind('githubgroups', namespace, processItem, dummy);
      } else {
        for (const kind of implementedKinds) {
          observeKind(
            kind,
            namespace,
            processItem,
            getProvisionImplementation(kind),
          )
            .then((res: any) => {
              console.log('exit kind', kind);
            })
            .catch(async (e: any) => {
              console.log('exit catch kind', kind);
              console.error(e);
              log.error('CRASHED', { kind, error: e });

              // If CRD missing, start background monitor instead of exiting
              // Robust missing-CRD detection — use centralized helper
              const status = e?.response?.statusCode ?? e?.statusCode;
              const isMissingCRD =
                isKubernetesNotFoundError(e) || status === 404;

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

              if (isMissingCRD && CRD_CHECK_ENABLED) {
                // Start a CRD monitor for this kind (guarded) so we periodically
                // check for CRD availability and re-run observeKind when it appears.

                try {
                  if (!(global as any).__crdMonitors)
                    (global as any).__crdMonitors = new Map();
                  const monitors: Map<string, any> = (global as any)
                    .__crdMonitors;
                  const key = `${namespace}/${kind}`;
                  if (!monitors.has(key)) {
                    // Use top-level imported createCrdMonitor
                    // We do not reattach informers automatically; create the
                    // monitor with the expected options only.
                    const monitor = createCrdMonitor(kind, {
                      enabled: CRD_CHECK_ENABLED,
                      intervalSeconds: CRD_CHECK_INTERVAL,
                      apiGroup: 'firestartr.dev',
                      namespace,
                    });

                    monitors.set(key, monitor);
                    monitor.start();
                    log.info(`Started CRD monitor for missing kind '${kind}'`);
                  } else {
                    log.info(
                      `CRD monitor already exists for kind '${kind}', skipping monitor creation`,
                    );
                  }
                } catch (monErr) {
                  log.error(
                    `Failed to start CRD monitor for kind '${kind}': ${monErr}`,
                  );
                }
              } else {
                // Non-missing errors keep current fatal path
                common.io.writeFunctionLog(
                  'observeKind',
                  `Crashed for kind ${kind}`,
                );
                console.log('observeKind Crashed');
                process.exit(1);
              }
            });
        }
      }
    });
  })();
}

const provisionImplementations = {
  terraformworkspaces: processOperationTerraform,
  githubgroups: processOperationGH,
  githubrepositories: processOperationGH,
  githubrepositorysecretssections: processOperationGH,
  githubrepositoryfeatures: processOperationGH,
  githubmemberships: processOperationGH,
  githuborgwebhooks: processOperationGH,
  githuborganizationsettings: processOperationGH,
  githuborganizationvariablesections: processOperationGH,
  fsdummiesa: processFirestartrDummies,
  fsdummiesb: processFirestartrDummies,
  fsdummiesc: processFirestartrDummies,
};

export function filterImplementedKinds(kindList: string[]): string[] {
  return kindList.filter((kind) => {
    if (Object.prototype.hasOwnProperty.call(provisionImplementations, kind)) {
      return true;
    }

    log.warn(`Ignoring configured kind '${kind}': no implementation found`);
    return false;
  });
}

function getProvisionImplementation(plural: string) {
  const implementation =
    provisionImplementations[plural as keyof typeof provisionImplementations];

  if (!implementation) throw new Error(`No implementation found for ${plural}`);

  log.info(`Retrieved the provision implementation for the kind '${plural}'`);

  return implementation;
}
