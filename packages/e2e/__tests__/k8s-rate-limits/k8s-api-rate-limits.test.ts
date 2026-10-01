import * as k8s from '@kubernetes/client-node';
import common from 'catalog_common';
import { createKubeConfigProvider } from '../../src/k8s/config';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
  retryAsync,
} from '../../src/utils/async-control';
import { isTransientError } from '../../src/utils/transient-errors';
import { Writable } from 'stream';

// ---------------------------------------------------------------------------
// Suite guard — skipped unless E2E_RUN_K8S_RATE_LIMITS=true
// ---------------------------------------------------------------------------

const K8S_RATE_LIMITS_ENV_VAR = 'E2E_RUN_K8S_RATE_LIMITS';

const describeK8sRateLimits =
  process.env[K8S_RATE_LIMITS_ENV_VAR] === 'true' ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACE = process.env.E2E_NAMESPACE ?? 'default';
const CR_COUNT = 100;
const SLEEP_SECONDS = 1;
const MAX_CONCURRENT_API_CALLS = 5;
const MAX_SLOTS = 2;
const PROGRESS_LOG_INTERVAL_MS = 50000; // Log progress every 50 seconds

const SETUP_TIMEOUT_MS = 3 * 60 * 1000;
const TEST_TIMEOUT_MS = 15 * 60 * 1000;
const CLEANUP_TIMEOUT_MS = 3 * 60 * 1000;

const DUMMY_API_GROUP = 'firestartr.dev';
const DUMMY_API_VERSION = 'v1';
const DUMMY_PLURAL = 'fsdummiesa';
const DUMMY_KIND = 'FirestartrDummyA';

const CONTROLLER_LABELS = 'app=firestartr-controller,concern=controller';
const CONTROLLER_LABEL_SELECTOR = {
  app: 'firestartr-controller',
  concern: 'controller',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function crName(index: number): string {
  return `k8s-rl-dummy-${index}`;
}

function buildDummyCr(name: string): object {
  return {
    apiVersion: `${DUMMY_API_GROUP}/${DUMMY_API_VERSION}`,
    kind: DUMMY_KIND,
    metadata: { name, namespace: NAMESPACE },
    spec: {
      computation: {
        numberOfSeconds: SLEEP_SECONDS,
        numberOfSecondsToDestroy: 1,
      },
    },
  };
}

async function findOperatorDeploymentName(
  appsApi: k8s.AppsV1Api,
): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const list = await appsApi.listNamespacedDeployment({
      namespace: NAMESPACE,
    });
    for (const dep of list.items) {
      const labels = dep.spec?.template?.metadata?.labels ?? {};
      if (
        labels['app'] === CONTROLLER_LABEL_SELECTOR['app'] &&
        labels['concern'] === CONTROLLER_LABEL_SELECTOR['concern']
      ) {
        const name = dep.metadata?.name;
        if (name) return name;
      }
    }
    await common.generic.sleep(1000);
  }
  throw new Error('firestartr controller deployment not found after 120s');
}

async function scaleDeployment(
  appsApi: k8s.AppsV1Api,
  name: string,
  replicas: number,
): Promise<void> {
  common.logger.info(
    `[k8s-rate-limits] scaling deployment ${name} to ${replicas}`,
  );
  await appsApi.patchNamespacedDeployment({
    name,
    namespace: NAMESPACE,
    body: [{ op: 'replace', path: '/spec/replicas', value: replicas }],
  });
}

async function waitForDeploymentReplicas(
  appsApi: k8s.AppsV1Api,
  name: string,
  expected: number,
): Promise<void> {
  await pollUntil(
    async () => {
      const dep = await appsApi.readNamespacedDeployment({
        name,
        namespace: NAMESPACE,
      });
      return dep.status?.readyReplicas ?? 0;
    },
    {
      timeoutMs: 120_000,
      intervalMs: 2000,
      isDone: (ready) => ready === expected,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for deployment ${name} to reach ${expected} ready replicas`,
        ),
    },
  );
}

async function setDeploymentEnvVars(
  appsApi: k8s.AppsV1Api,
  name: string,
  envVars: Record<string, string>,
): Promise<void> {
  const dep = await appsApi.readNamespacedDeployment({
    name,
    namespace: NAMESPACE,
  });
  const containers = dep.spec?.template?.spec?.containers ?? [];
  if (containers.length === 0) {
    throw new Error(`No containers found in deployment ${name}`);
  }

  const existingEnv: k8s.V1EnvVar[] = containers[0].env ?? [];
  const envKeys = Object.keys(envVars);
  const filteredEnv = existingEnv.filter(
    (e) => !envKeys.includes(e.name ?? ''),
  );
  const newEnv = [
    ...filteredEnv,
    ...envKeys.map((key) => ({ name: key, value: envVars[key] })),
  ];

  const patch = [
    {
      op: 'replace',
      path: '/spec/template/spec/containers/0/env',
      value: newEnv,
    },
  ];

  await appsApi.patchNamespacedDeployment({
    name,
    namespace: NAMESPACE,
    body: patch,
  });
}

async function createDummyCr(
  customObjectsApi: k8s.CustomObjectsApi,
  name: string,
): Promise<void> {
  try {
    await customObjectsApi.createNamespacedCustomObject({
      group: DUMMY_API_GROUP,
      version: DUMMY_API_VERSION,
      namespace: NAMESPACE,
      plural: DUMMY_PLURAL,
      body: buildDummyCr(name),
    });
  } catch (err: unknown) {
    const status = (err as { response?: { statusCode?: number } })?.response
      ?.statusCode;
    if (status !== 409) throw err;
  }
}

async function deleteDummyCr(
  customObjectsApi: k8s.CustomObjectsApi,
  name: string,
): Promise<void> {
  try {
    await customObjectsApi.deleteNamespacedCustomObject({
      group: DUMMY_API_GROUP,
      version: DUMMY_API_VERSION,
      namespace: NAMESPACE,
      plural: DUMMY_PLURAL,
      name,
    });
  } catch (err: unknown) {
    const status =
      (err as { code?: number; response?: { statusCode?: number } })?.code ??
      (err as { response?: { statusCode?: number } })?.response?.statusCode;
    if (status !== 404 && status !== 409) throw err;
  }
}

async function deleteDummyCrs(
  customObjectsApi: k8s.CustomObjectsApi,
  names: string[],
): Promise<void> {
  for (const name of names) {
    await retryAsync(() => deleteDummyCr(customObjectsApi, name), {
      attempts: 20,
      shouldRetry: (err) => isTransientError(err),
      getDelayMs: (_err, attempt) => Math.min(250 * attempt, 2000),
    });
  }
}

async function waitForAllCrsProvisioned(
  customObjectsApi: k8s.CustomObjectsApi,
  coreApi: k8s.CoreV1Api,
  kc: k8s.KubeConfig,
  names: string[],
  timeoutMs: number,
): Promise<void> {
  const startTime = Date.now();
  let lastProgressLogTime = startTime;
  let debugDumped = false;

  const allDone = { current: false };

  const progressLoggingPromise = (async () => {
    while (true) {
      const now = Date.now();
      const elapsed = now - startTime;
      const remaining = timeoutMs - elapsed;

      if (remaining <= 0 || allDone.current) break;

      const nextLogTime = lastProgressLogTime + PROGRESS_LOG_INTERVAL_MS;
      const waitTime = Math.min(nextLogTime - now, remaining);

      if (waitTime > 0) {
        await common.generic.sleep(waitTime);
      }

      const now2 = Date.now();
      if (now2 - lastProgressLogTime >= PROGRESS_LOG_INTERVAL_MS) {
        const elapsed2 = now2 - startTime;
        const elapsedSeconds = Math.round(elapsed2 / 1000);

        let histogram: Record<string, number> = {};
        let stateLine = '';
        let diagnosticLine = '';
        try {
          histogram = await getCrStateHistogram(customObjectsApi);
          stateLine = ` | ${formatHistogram(histogram)}`;
        } catch (err) {
          stateLine = ` | [state list failed: ${err instanceof Error ? err.message : String(err)}]`;
        }
        try {
          const diag = await getOperatorDiagnostic(coreApi, kc);
          if (diag) diagnosticLine = diag;
        } catch (err) {
          common.logger.warn(
            `[k8s-rate-limits] diagnostic unavailable: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        const provisioned = histogram['PROVISIONED'] ?? 0;

        common.logger.info(
          `[k8s-rate-limits] ${elapsedSeconds}s | ${provisioned}/${CR_COUNT} provisioned${stateLine}${diagnosticLine}`,
        );
        lastProgressLogTime = now2;

        if (provisioned >= CR_COUNT) {
          allDone.current = true;
          break;
        }

        // One-time deep dump when the operator appears to be doing nothing:
        // nothing provisioned yet. Pulls the operator pod-log tail (informer /
        // processor / reflector / 429 lines) so a stuck reconcile or a
        // rate-limit storm is visible in CI instead of guessed at.
        if (!debugDumped && provisioned === 0) {
          debugDumped = true;
          try {
            await dumpOperatorDebugState(coreApi, kc);
          } catch (err) {
            common.logger.warn(
              `[k8s-rate-limits] debug dump failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }
  })();

  try {
    await Promise.all([
      progressLoggingPromise,
      Promise.all(
        names.map((name) =>
          pollUntil(
            async () => {
              try {
                const response =
                  await customObjectsApi.getNamespacedCustomObject({
                    group: DUMMY_API_GROUP,
                    version: DUMMY_API_VERSION,
                    namespace: NAMESPACE,
                    plural: DUMMY_PLURAL,
                    name,
                  });
                const obj = response as {
                  status?: { highPriorityState?: string };
                };
                return obj.status?.highPriorityState ?? null;
              } catch (err) {
                if (isTransientError(err)) {
                  throw createRetryableError(err);
                }
                throw err;
              }
            },
            {
              timeoutMs,
              intervalMs: 3000,
              isDone: (state) => state === 'PROVISIONED',
              shouldRetryError: isRetryableError,
              createTimeoutError: () =>
                new Error(
                  `Timed out waiting for ${DUMMY_KIND}/${name} to reach PROVISIONED`,
                ),
            },
          ),
        ),
      ),
    ]);
  } finally {
    allDone.current = true;
    progressLoggingPromise.catch(() => {
      // Ignore errors from the logging loop
    });
  }
}

const OPERATOR_POD_LABELS = 'app=firestartr,concern=dev';

async function getOperatorPodName(coreApi: k8s.CoreV1Api): Promise<string> {
  const pods = await coreApi.listNamespacedPod({
    namespace: NAMESPACE,
    labelSelector: CONTROLLER_LABELS,
  });
  const running = pods.items.find(
    (p) => !p.metadata?.deletionTimestamp && p.status?.phase === 'Running',
  );
  if (!running?.metadata?.name) {
    throw new Error('No running firestartr controller pod found');
  }
  return running.metadata.name;
}

async function getOperatorDevPodName(coreApi: k8s.CoreV1Api): Promise<string> {
  const pods = await coreApi.listNamespacedPod({
    namespace: NAMESPACE,
    labelSelector: OPERATOR_POD_LABELS,
  });
  const running = pods.items.find(
    (p) => !p.metadata?.deletionTimestamp && p.status?.phase === 'Running',
  );
  if (!running?.metadata?.name) {
    throw new Error('No running firestartr dev pod found');
  }
  return running.metadata.name;
}

async function getOperatorLogs(
  coreApi: k8s.CoreV1Api,
  podName: string,
): Promise<string> {
  const response = await coreApi.readNamespacedPodLog({
    name: podName,
    namespace: NAMESPACE,
  });
  return response;
}

/**
 * Returns a histogram of the dummy CRs' `status.highPriorityState` using a
 * single LIST call. CRs with no status yet are bucketed under `<none>`.
 *
 * This is the reliable progress signal: pod `exec` does not work in the
 * CI/Dagger environment (so the operator's `/tmp/diagnostic` file cannot be
 * read), but LIST over the k8s API does. The histogram distinguishes the
 * failure modes that matter: stuck in `PROVISIONING` (operator is working but
 * not finishing), stuck at `<none>` (CRs never picked up), or `ERROR`.
 */
async function getCrStateHistogram(
  customObjectsApi: k8s.CustomObjectsApi,
): Promise<Record<string, number>> {
  const histogram: Record<string, number> = {};
  const response = await customObjectsApi.listNamespacedCustomObject({
    group: DUMMY_API_GROUP,
    version: DUMMY_API_VERSION,
    namespace: NAMESPACE,
    plural: DUMMY_PLURAL,
  });
  const items = (response as { items?: unknown[] }).items ?? [];
  for (const item of items) {
    const state =
      (item as { status?: { highPriorityState?: string } }).status
        ?.highPriorityState ?? '<none>';
    histogram[state] = (histogram[state] ?? 0) + 1;
  }
  return histogram;
}

function formatHistogram(histogram: Record<string, number>): string {
  const entries = Object.entries(histogram).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return 'states(none)';
  return `states(${entries.map(([state, count]) => `${state}=${count}`).join(' ')})`;
}

/**
 * Emits a one-time deep snapshot of the operator's runtime from its pod logs
 * when it looks stuck (nothing provisioned). Pod `exec` does not work in this
 * environment, so this relies solely on `readNamespacedPodLog` (plain HTTP,
 * confirmed working). The filtered tail reveals whether the informer is
 * receiving items, whether work items are being processed, whether the
 * reflector is erroring, and whether any 429 / rate-limit responses appear.
 */
/**
 * Reads the operator's in-pod /tmp/diagnostic file via the Kubernetes API
 * (k8s.Exec). Falls back to extracting available info from the operator pod
 * logs when the file doesn't exist (e.g., image built without diagnostic
 * code). Returns a compact one-liner suitable for appending to the progress
 * log message, or empty string if unavailable.
 */
async function getOperatorDiagnostic(
  coreApi: k8s.CoreV1Api,
  kc: k8s.KubeConfig,
): Promise<string> {
  let podName: string;
  try {
    podName = await getOperatorDevPodName(coreApi);
  } catch {
    podName = await getOperatorPodName(coreApi);
  }

  // Try reading /tmp/diagnostic via exec (only works if the image has the diagnostic code)
  try {
    const exec = new k8s.Exec(kc);
    let output = '';

    const stdout = new Writable({
      write(
        chunk: any,
        _encoding: string,
        callback: (error?: Error | null) => void,
      ) {
        output += chunk.toString();
        callback();
      },
    });

    await new Promise<void>((resolve, reject) => {
      exec
        .exec(
          NAMESPACE,
          podName,
          undefined,
          ['cat', '/tmp/diagnostic'],
          stdout,
          null,
          null,
          false,
          () => resolve(),
        )
        .catch(reject);
    });

    const content = output.trim();
    if (content) {
      const lines = content.split('\n');
      const parts: string[] = [];
      let currentSection = '';
      for (const line of lines) {
        const sectionMatch = line.match(/^(\w+):$/);
        if (sectionMatch) {
          currentSection = sectionMatch[1];
          continue;
        }
        const kvMatch = line.match(/^\s{2}(\w[\w/]+):\s(.+)$/);
        if (kvMatch) {
          const [, key, value] = kvMatch;
          if (
            currentSection === 'env' ||
            currentSection === 'semaphore' ||
            currentSection === 'queue' ||
            currentSection === 'slots'
          ) {
            parts.push(`${key}=${value}`);
          }
        }
      }
      if (parts.length > 0) {
        return ` | diag: ${parts.join('; ')}`;
      }
    }
  } catch {
    // exec failed — fall through to log-based approach
  }

  // Fallback: extract available info from operator pod logs or /tmp/operator.log
  try {
    let logContent = '';
    try {
      const exec = new k8s.Exec(kc);
      const stdout = new Writable({
        write(
          chunk: any,
          _encoding: string,
          callback: (error?: Error | null) => void,
        ) {
          logContent += chunk.toString();
          callback();
        },
      });
      await new Promise<void>((resolve, reject) => {
        exec
          .exec(
            NAMESPACE,
            podName,
            undefined,
            ['cat', '/tmp/operator.log'],
            stdout,
            null,
            null,
            false,
            () => resolve(),
          )
          .catch(() => {
            /* fall through to pod logs */
          });
      });
    } catch {
      // exec failed — fall through to pod logs
    }
    if (!logContent) {
      logContent = await getOperatorLogs(coreApi, podName);
    }
    const logLines = logContent.split('\n');

    const parts: string[] = [];

    // Detect rate-limiting
    const rateLimited = logLines.filter((line) =>
      /\b429\b|Too Many Requests/i.test(line),
    );
    if (rateLimited.length > 0) {
      parts.push(`rate_limited_ops=${rateLimited.length}`);
    }

    // Count items detected by the informer
    const detected = logLines.filter((line) =>
      /Added item of path/.test(line),
    ).length;
    if (detected > 0) {
      parts.push(`crs_detected=${detected}`);
    }

    // Count items removed from sync
    const removed = logLines.filter((line) =>
      /Removed item of path/.test(line),
    ).length;
    if (removed > 0) {
      parts.push(`crs_removed=${removed}`);
    }

    // Count items being processed
    const processing = logLines.filter((line) =>
      /is currently handling/.test(line),
    ).length;
    if (processing > 0) {
      parts.push(`crs_processing=${processing}`);
    }

    // Count items that reached PROVISIONED
    const provisioned = logLines.filter((line) =>
      /type: 'PROVISIONED'/.test(line),
    ).length;
    if (provisioned > 0) {
      parts.push(`crs_provisioned=${provisioned}`);
    }

    // Count errors
    const errors = logLines.filter((line) => /\berror\b/i.test(line)).length;
    if (errors > 0) {
      parts.push(`errors=${errors}`);
    }

    return parts.length > 0 ? ` | diag(fallback): ${parts.join('; ')}` : '';
  } catch {
    return '';
  }
}

async function dumpOperatorDebugState(
  coreApi: k8s.CoreV1Api,
  kc: k8s.KubeConfig,
): Promise<void> {
  let podName: string;
  try {
    podName = await getOperatorDevPodName(coreApi);
  } catch {
    podName = await getOperatorPodName(coreApi);
  }

  try {
    let logs = '';
    try {
      const exec = new k8s.Exec(kc);
      const stdout = new Writable({
        write(
          chunk: any,
          _encoding: string,
          callback: (error?: Error | null) => void,
        ) {
          logs += chunk.toString();
          callback();
        },
      });
      await new Promise<void>((resolve, reject) => {
        exec
          .exec(
            NAMESPACE,
            podName,
            undefined,
            ['cat', '/tmp/operator.log'],
            stdout,
            null,
            null,
            false,
            () => resolve(),
          )
          .catch(() => {});
      });
    } catch {
      // ignore
    }
    if (!logs) {
      logs = await getOperatorLogs(coreApi, podName);
    }
    const lines = logs.split('\n');

    const rateLimited = lines.filter((line) =>
      /\b429\b|Too Many Requests|rate limit/i.test(line),
    );
    if (rateLimited.length > 0) {
      common.logger.warn(
        `[k8s-rate-limits] operator log shows ${rateLimited.length} rate-limit line(s); last:\n${rateLimited.slice(-5).join('\n')}`,
      );
    }

    const interesting = lines
      .filter((line) =>
        /processor received|slot|reflector|Reflector|informer|Ignoring configured kind|error|Error|CRASHED|lease|Lease|429|Too Many/i.test(
          line,
        ),
      )
      .slice(-50);
    common.logger.info(
      `[k8s-rate-limits] operator log tail (${interesting.length} lines):\n${interesting.join('\n')}`,
    );
  } catch (err) {
    common.logger.info(
      `[k8s-rate-limits] operator log read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describeK8sRateLimits(
  'K8s API rate limits — operator reconciles under constrained cluster',
  () => {
    const kubeConfigProvider = createKubeConfigProvider({});
    let kc: k8s.KubeConfig;
    let customObjectsApi: k8s.CustomObjectsApi;
    let appsApi: k8s.AppsV1Api;
    let coreApi: k8s.CoreV1Api;
    let operatorDeploymentName: string;

    const crNames = Array.from({ length: CR_COUNT }, (_, i) => crName(i));

    beforeAll(async () => {
      kc = kubeConfigProvider();
      customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi);
      appsApi = kc.makeApiClient(k8s.AppsV1Api);
      coreApi = kc.makeApiClient(k8s.CoreV1Api);

      operatorDeploymentName = await findOperatorDeploymentName(appsApi);
      common.logger.info(
        `[k8s-rate-limits] found operator deployment: ${operatorDeploymentName}`,
      );

      // Stop the operator before flooding so CRs queue up unprocessed
      await scaleDeployment(appsApi, operatorDeploymentName, 0);
      await waitForDeploymentReplicas(appsApi, operatorDeploymentName, 0);
      common.logger.info('[k8s-rate-limits] operator stopped');

      // Clean up any leftover CRs from a previous run
      await deleteDummyCrs(customObjectsApi, crNames);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      // Always clean up dummy CRs (best-effort)
      if (customObjectsApi) {
        try {
          await deleteDummyCrs(customObjectsApi, crNames);
        } catch (err) {
          common.logger.warn(`[k8s-rate-limits] cleanup error: ${err}`);
        }
      }

      if (!appsApi || !operatorDeploymentName) return;

      // Remove env var overrides we applied during the test run (best-effort)
      try {
        const dep = await appsApi.readNamespacedDeployment({
          name: operatorDeploymentName,
          namespace: NAMESPACE,
        });
        const containers = dep.spec?.template?.spec?.containers ?? [];
        if (containers.length > 0) {
          const existingEnv: k8s.V1EnvVar[] = containers[0].env ?? [];
          const filteredEnv = existingEnv.filter(
            (e) =>
              ![
                'OPERATOR_MAX_CONCURRENT_API_CALLS',
                'OPERATOR_NUMBER_OF_MAX_SLOTS',
                'OPERATOR_KIND_LIST',
              ].includes(e.name ?? ''),
          );
          const patch = [
            {
              op: 'replace',
              path: '/spec/template/spec/containers/0/env',
              value: filteredEnv,
            },
          ];
          await appsApi.patchNamespacedDeployment({
            name: operatorDeploymentName,
            namespace: NAMESPACE,
            body: patch,
          });
        }
      } catch (err) {
        common.logger.warn(
          `[k8s-rate-limits] restore operator env error: ${err}`,
        );
      }

      try {
        await scaleDeployment(appsApi, operatorDeploymentName, 1);
        await waitForDeploymentReplicas(appsApi, operatorDeploymentName, 1);
      } catch (err) {
        common.logger.warn(`[k8s-rate-limits] restore operator error: ${err}`);
      }
    }, CLEANUP_TIMEOUT_MS);

    it(
      `reconciles ${CR_COUNT} dummy CRs under max-requests-inflight=10 without 429 errors`,
      async () => {
        // 1. Flood namespace with CR_COUNT dummy CRs while operator is stopped
        common.logger.info(
          `[k8s-rate-limits] creating ${CR_COUNT} ${DUMMY_KIND} CRs`,
        );
        for (const name of crNames) {
          await retryAsync(() => createDummyCr(customObjectsApi, name), {
            attempts: 20,
            shouldRetry: (err) => isTransientError(err),
            getDelayMs: (_err, attempt) => Math.min(250 * attempt, 2000),
          });
        }
        common.logger.info('[k8s-rate-limits] all CRs created');

        // 2. Start operator with explicit concurrency limits
        // OPERATOR_MAX_CONCURRENT_API_CALLS: caps concurrent K8s API reads via the shared semaphore
        // OPERATOR_NUMBER_OF_MAX_SLOTS: caps concurrent work items processed by the operator
        // OPERATOR_KIND_LIST: ensure the operator watches dummy CRs
        await setDeploymentEnvVars(appsApi, operatorDeploymentName, {
          OPERATOR_MAX_CONCURRENT_API_CALLS: String(MAX_CONCURRENT_API_CALLS),
          OPERATOR_NUMBER_OF_MAX_SLOTS: String(MAX_SLOTS),
          OPERATOR_KIND_LIST: 'fsdummiesa,fsdummiesb,fsdummiesc',
        });
        await scaleDeployment(appsApi, operatorDeploymentName, 1);
        await waitForDeploymentReplicas(appsApi, operatorDeploymentName, 1);
        common.logger.info(
          `[k8s-rate-limits] operator started with MAX_CONCURRENT_API_CALLS=${MAX_CONCURRENT_API_CALLS} MAX_SLOTS=${MAX_SLOTS}`,
        );

        // 3. Wait for all CRs to reach PROVISIONED
        common.logger.info(
          `[k8s-rate-limits] waiting for ${CR_COUNT} CRs to reach PROVISIONED`,
        );
        await waitForAllCrsProvisioned(
          customObjectsApi,
          coreApi,
          kc,
          crNames,
          TEST_TIMEOUT_MS,
        );
        common.logger.info('[k8s-rate-limits] all CRs provisioned');

        // 4. Assert no 429 errors in operator logs
        let logs = '';
        try {
          const devPod = await getOperatorDevPodName(coreApi);
          const exec = new k8s.Exec(kc);
          const stdout = new Writable({
            write(
              chunk: any,
              _encoding: string,
              callback: (error?: Error | null) => void,
            ) {
              logs += chunk.toString();
              callback();
            },
          });
          await new Promise<void>((resolve, reject) => {
            exec
              .exec(
                NAMESPACE,
                devPod,
                undefined,
                ['cat', '/tmp/operator.log'],
                stdout,
                null,
                null,
                false,
                () => resolve(),
              )
              .catch(() => {});
          });
        } catch {
          // fallback to pod logs
          const podName = await getOperatorPodName(coreApi);
          logs = await getOperatorLogs(coreApi, podName);
        }
        expect(logs).not.toMatch(/\b429\b|Too Many Requests/i);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
