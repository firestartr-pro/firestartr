import * as k8s from '@kubernetes/client-node';
import {
  CleanupRunner,
  cleanupRenderedArtifacts,
  destroyFixtureResources,
  initE2e,
  type E2EApi,
} from '../..';
import { createKubeConfigProvider } from '../../src/k8s/config';
import {
  MERGE_PATCH_HEADERS,
  STRATEGIC_MERGE_PATCH_HEADERS,
} from '../../src/k8s/constants';
import { getPrimaryManifestResource } from '../../src/k8s/manifests';
import { LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS } from '../../src/test-constants';
import { pollUntil } from '../../src/utils/async-control';
import common from 'catalog_common';

const RETRY_LIFECYCLE_ENV_VAR = 'E2E_RUN_RETRY_LIFECYCLE';

const describeRetryLifecycle =
  process.env[RETRY_LIFECYCLE_ENV_VAR] === 'true' ? describe : describe.skip;

const BAD_MODULE_SOURCE =
  'git::https://github.com/prefapp/tfm.git//packages/dummy?ref=nonexistent-branch';

const TF_PLURAL = 'terraformworkspaces';
const TF_KIND = 'FirestartrTerraformWorkspace';
const API_GROUP = 'firestartr.dev';

const APPLY_ERROR_FRAGMENT = 'Terraform apply operation';
const PLAN_ERROR_FRAGMENT = 'Terraform plan operation';
const SYNC_ERROR_FRAGMENT = 'Sync operation';

const LOG_PREFIX = 'retry-lifecycle';

const CONTROLLER_LABEL_SELECTOR = {
  app: 'firestartr-controller',
  concern: 'controller',
};

const RETRY_CONFIG_ENV_VARS: Record<string, string> = {
  OPERATOR_NEXT_RETRY_MS: '5000',
  OPERATOR_MAX_RETRY: '3',
};

async function findOperatorDeploymentName(
  appsApi: k8s.AppsV1Api,
  ns: string,
): Promise<string> {
  const list = await appsApi.listNamespacedDeployment({ namespace: ns });
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
  throw new Error('firestartr controller deployment not found');
}

async function setDeploymentEnvVars(
  appsApi: k8s.AppsV1Api,
  name: string,
  ns: string,
  envVars: Record<string, string>,
): Promise<void> {
  const dep = await appsApi.readNamespacedDeployment({ name, namespace: ns });
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

  const patch = {
    spec: {
      template: {
        spec: {
          containers: [{ name: containers[0].name, env: newEnv }],
        },
      },
    },
  };

  await appsApi.patchNamespacedDeployment(
    { name, namespace: ns, body: patch },
    STRATEGIC_MERGE_PATCH_HEADERS,
  );
}

async function removeDeploymentEnvVars(
  appsApi: k8s.AppsV1Api,
  name: string,
  ns: string,
  envVarKeys: string[],
): Promise<void> {
  const dep = await appsApi.readNamespacedDeployment({ name, namespace: ns });
  const containers = dep.spec?.template?.spec?.containers ?? [];
  if (containers.length === 0) return;

  const existingEnv: k8s.V1EnvVar[] = containers[0].env ?? [];
  const filteredEnv = existingEnv.filter(
    (e) => !envVarKeys.includes(e.name ?? ''),
  );

  const patch = {
    spec: {
      template: {
        spec: {
          containers: [{ name: containers[0].name, env: filteredEnv }],
        },
      },
    },
  };

  await appsApi.patchNamespacedDeployment(
    { name, namespace: ns, body: patch },
    STRATEGIC_MERGE_PATCH_HEADERS,
  );
}

async function waitForDeploymentRollout(
  appsApi: k8s.AppsV1Api,
  name: string,
  ns: string,
): Promise<void> {
  await pollUntil(
    async () => {
      const dep = await appsApi.readNamespacedDeployment({
        name,
        namespace: ns,
      });
      return {
        generation: dep.metadata?.generation ?? 0,
        observedGeneration: dep.status?.observedGeneration ?? 0,
        updatedReplicas: dep.status?.updatedReplicas ?? 0,
        readyReplicas: dep.status?.readyReplicas ?? 0,
        replicas: dep.status?.replicas ?? 0,
      };
    },
    {
      timeoutMs: 120_000,
      intervalMs: 2000,
      isDone: (state) =>
        state.observedGeneration >= state.generation &&
        state.updatedReplicas >= state.replicas &&
        state.readyReplicas >= state.replicas,
      createTimeoutError: (last) =>
        new Error(
          `Timed out waiting for deployment ${name} rollout. ` +
            `generation=${last?.generation}, observedGeneration=${last?.observedGeneration}, ` +
            `updatedReplicas=${last?.updatedReplicas}, readyReplicas=${last?.readyReplicas}, replicas=${last?.replicas}`,
        ),
    },
  );
}

describeRetryLifecycle('Retry lifecycle with policy annotations', () => {
  let client: E2EApi;
  let kc: k8s.KubeConfig;
  let customObjectsApi: k8s.CustomObjectsApi;
  let coreApi: k8s.CoreV1Api;
  let appsApi: k8s.AppsV1Api;
  let namespace: string;
  let operatorDeploymentName: string;

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: LOG_PREFIX,
    });
    namespace = client.k8s.getNamespace();

    const kubeConfigProvider = createKubeConfigProvider({});
    kc = kubeConfigProvider();
    customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi);
    coreApi = kc.makeApiClient(k8s.CoreV1Api);
    appsApi = kc.makeApiClient(k8s.AppsV1Api);

    operatorDeploymentName = await findOperatorDeploymentName(
      appsApi,
      namespace,
    );

    common.logger.info(
      `[${LOG_PREFIX}] Setting retry config to ${JSON.stringify(RETRY_CONFIG_ENV_VARS)} on deployment ${operatorDeploymentName}`,
    );

    await setDeploymentEnvVars(
      appsApi,
      operatorDeploymentName,
      namespace,
      RETRY_CONFIG_ENV_VARS,
    );

    await waitForDeploymentRollout(appsApi, operatorDeploymentName, namespace);

    await destroyFixtureResources(
      client,
      client.getPrefix(),
      ['workspace_a', 'workspace_b'],
      { deleteOrg: false, strict: true, logPrefix: LOG_PREFIX },
    );
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) return;

    try {
      await removeDeploymentEnvVars(
        appsApi,
        operatorDeploymentName,
        namespace,
        Object.keys(RETRY_CONFIG_ENV_VARS),
      );

      await waitForDeploymentRollout(
        appsApi,
        operatorDeploymentName,
        namespace,
      );
    } catch (e) {
      common.logger.warn(
        `[${LOG_PREFIX}] Failed to restore operator env vars: ${e}`,
      );
    }

    const cleanup = new CleanupRunner();

    await cleanup.run('delete rendered resources', async () => {
      await destroyFixtureResources(
        client,
        client.getPrefix(),
        ['workspace_a', 'workspace_b'],
        { deleteOrg: false, logPrefix: LOG_PREFIX },
      );
    });

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    cleanup.throwOnErrors(`${LOG_PREFIX} afterAll`);
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  async function readCr(name: string): Promise<any> {
    const response = await customObjectsApi.getNamespacedCustomObject({
      group: API_GROUP,
      version: 'v1',
      namespace,
      plural: TF_PLURAL,
      name,
    });
    return response;
  }

  async function patchCrAnnotations(
    name: string,
    annotations: Record<string, string>,
  ): Promise<void> {
    await customObjectsApi.patchNamespacedCustomObject(
      {
        group: API_GROUP,
        version: 'v1',
        namespace,
        plural: TF_PLURAL,
        name,
        body: { metadata: { annotations } },
      },
      MERGE_PATCH_HEADERS,
    );
  }

  async function getOperatorLogs(): Promise<string> {
    const pods = await coreApi.listNamespacedPod({
      namespace,
      labelSelector: 'app=firestartr-controller,concern=controller',
    });
    const running = pods.items.find(
      (p: any) =>
        !p.metadata?.deletionTimestamp && p.status?.phase === 'Running',
    );
    if (!running?.metadata?.name) {
      throw new Error('No running firestartr controller pod found');
    }
    const response = await coreApi.readNamespacedPodLog({
      name: running.metadata.name,
      namespace,
    });
    return response;
  }

  async function getErrorCondition(crName: string): Promise<{
    reason?: string;
    message?: string;
  } | null> {
    const cr = await readCr(crName);
    const conditions: any[] = cr.status?.conditions ?? [];
    return (
      conditions.find((c: any) => c.type === 'ERROR' && c.status === 'True') ??
      null
    );
  }

  async function waitForErrorMessageContaining(
    crName: string,
    fragment: string,
    timeoutMs: number,
  ): Promise<void> {
    await pollUntil(
      async () => {
        const err = await getErrorCondition(crName);
        return err?.message ?? '';
      },
      {
        timeoutMs,
        intervalMs: 3000,
        isDone: (msg) => msg.includes(fragment),
        createTimeoutError: () =>
          new Error(
            `Timed out waiting for ERROR message containing '${fragment}' on ${crName}`,
          ),
      },
    );
  }

  async function waitForOperationInLogs(
    opType: string,
    timeoutMs: number,
    crName: string,
  ): Promise<boolean> {
    const pattern = new RegExp(
      `currently handling.*'${opType}'.*${TF_KIND}/${crName}`,
      'i',
    );
    try {
      await pollUntil(
        async () => {
          const logs = await getOperatorLogs();
          return logs;
        },
        {
          timeoutMs,
          intervalMs: 5000,
          isDone: (logs) => pattern.test(logs),
          createTimeoutError: () =>
            new Error(
              `Timed out waiting for operation '${opType}' in operator logs`,
            ),
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  function buildBadModuleMerge(
    extraAnnotations: Record<string, string>,
    terraformExtras?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      owner: 'group:firestartr',
      annotations: extraAnnotations,
      providers: {
        terraform: {
          module: BAD_MODULE_SOURCE,
          ...terraformExtras,
        },
      },
    };
  }

  const BAD_MODULE_PATCHES = [
    { op: 'replace' as const, path: '/providers/terraform/values', value: {} },
    { op: 'remove' as const, path: '/providers/terraform/valuesSchema' },
  ];

  // With OPERATOR_NEXT_RETRY_MS=5000 and OPERATOR_MAX_RETRY=3:
  //   Retries fire at 5s, 10s, 20s — tests complete in ~1-2 min instead of ~15 min
  const RETRY_SETTLE_TIMEOUT = 120_000;

  const SYNC_SETTLE_TIMEOUT = 120_000;

  describe('CR1 — RETRY uses firestartr.dev/policy', () => {
    let crPath: string;
    let crName: string;

    beforeAll(async () => {
      const rendered = await client.claims.renderLocally('workspace_a', {
        merge: buildBadModuleMerge(
          {
            'firestartr.dev/policy': 'apply',
          },
          { policy: 'apply' },
        ),
        patches: BAD_MODULE_PATCHES,
      });
      crPath = rendered.crPaths[0];
      crName = (await getPrimaryManifestResource(crPath)).metadata.name;
      await client.k8s.applyCr(crPath);
    });

    it('enters ERROR with APPLY message after initial processing', async () => {
      const cr = await client.k8s.waitForCr(crPath, 60, 'ERROR');
      expect(cr).toBeDefined();
      const err = await getErrorCondition(crName);
      expect(err?.message).toContain(APPLY_ERROR_FRAGMENT);
    }, 90_000);

    it('patches policy=observe and observes error switch to PLAN/SYNC', async () => {
      await patchCrAnnotations(crName, {
        'firestartr.dev/policy': 'observe',
      });

      await waitForErrorMessageContaining(crName, PLAN_ERROR_FRAGMENT, 30_000);
    }, 60_000);

    it('waits for RETRY and confirms it respects policy=observe', async () => {
      const retrySeen = await waitForOperationInLogs(
        'RETRY',
        RETRY_SETTLE_TIMEOUT,
        crName,
      );
      common.logger.info(
        `[retry-lifecycle] RETRY operation seen in logs: ${retrySeen}`,
      );
      expect(retrySeen).toBe(true);

      const err = await getErrorCondition(crName);
      expect(err?.message).toContain(PLAN_ERROR_FRAGMENT);
    }, 120_000);
  });

  describe('CR2 — RETRY_SYNC uses firestartr.dev/sync-policy', () => {
    let crPath: string;
    let crName: string;

    beforeAll(async () => {
      const rendered = await client.claims.renderLocally('workspace_b', {
        merge: buildBadModuleMerge(
          {
            'firestartr.dev/policy': 'full-control',
            'firestartr.dev/sync-policy': 'observe',
            'firestartr.dev/sync-enabled': 'true',
            'firestartr.dev/sync-period': '30s',
          },
          {
            policy: 'full-control',
            sync: {
              enabled: true,
              period: '30s',
              policy: 'observe',
            },
          },
        ),
        patches: BAD_MODULE_PATCHES,
      });
      crPath = rendered.crPaths[0];
      crName = (await getPrimaryManifestResource(crPath)).metadata.name;
      await client.k8s.applyCr(crPath);
    });

    it(
      'enters ERROR with SYNC message after sync operation',
      async () => {
        const cr = await client.k8s.waitForCr(crPath, 90, 'ERROR');
        expect(cr).toBeDefined();

        await waitForErrorMessageContaining(
          crName,
          SYNC_ERROR_FRAGMENT,
          60_000,
        );
      },
      SYNC_SETTLE_TIMEOUT,
    );

    it(
      'patches sync-policy=apply and waits for APPLY error',
      async () => {
        await patchCrAnnotations(crName, {
          'firestartr.dev/sync-policy': 'apply',
          'firestartr.dev/sync-enabled': 'true',
          'firestartr.dev/sync-period': '30s',
        });

        await waitForErrorMessageContaining(
          crName,
          APPLY_ERROR_FRAGMENT,
          60_000,
        );
      },
      SYNC_SETTLE_TIMEOUT,
    );

    it(
      'waits for RETRY_SYNC and confirms it respects sync-policy=apply',
      async () => {
        const retrySyncSeen = await waitForOperationInLogs(
          'RETRY_SYNC',
          RETRY_SETTLE_TIMEOUT,
          crName,
        );
        common.logger.info(
          `[retry-lifecycle] RETRY_SYNC operation seen in logs: ${retrySyncSeen}`,
        );
        expect(retrySyncSeen).toBe(true);

        const err = await getErrorCondition(crName);
        expect(err?.message).toContain(APPLY_ERROR_FRAGMENT);
      },
      SYNC_SETTLE_TIMEOUT,
    );
  });
});
