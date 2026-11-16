import * as k8s from '@kubernetes/client-node';
import { getStatusCode, type StatusCodeError } from '../errors/status-code';
import { pollUntil } from '../utils/async-control';
import { JSON_PATCH_HEADERS, STRATEGIC_MERGE_PATCH_HEADERS } from './constants';
import type { KubeConfigProvider } from './types';

export const CONTROLLER_LABELS = 'app=firestartr-controller,concern=controller';
const CONTROLLER_LABEL_SELECTOR = {
  app: 'firestartr-controller',
  concern: 'controller',
};

const API_GROUP = 'firestartr.dev';
const API_VERSION = 'v1';
const TF_KIND = 'FirestartrTerraformWorkspace';
const TF_PLURAL = 'terraformworkspaces';
const TFRESULT_PLURAL = 'tfresults';
// OpenTofu's kubernetes backend stores state in `tfstate-<workspace>-<key>`
// Secrets and locks it with `lock-tfstate-<workspace>-<key>` Leases.
const TF_STATE_FRAGMENT = 'tfstate-';

const OPERATOR_ROLLOUT_TIMEOUT_MS = 120_000;

export type ControllerDeployment = {
  name: string;
  env: k8s.V1EnvVar[];
  replicas: number;
};

export async function readControllerDeployment(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
): Promise<ControllerDeployment> {
  const appsApi = getKubeConfig().makeApiClient(k8s.AppsV1Api);
  const list = await appsApi.listNamespacedDeployment({ namespace });

  for (const deployment of list.items) {
    const labels = deployment.spec?.template?.metadata?.labels ?? {};
    if (
      labels['app'] === CONTROLLER_LABEL_SELECTOR['app'] &&
      labels['concern'] === CONTROLLER_LABEL_SELECTOR['concern']
    ) {
      const name = deployment.metadata?.name;
      if (!name) continue;

      const container = deployment.spec?.template?.spec?.containers?.[0];
      if (!container) {
        throw new Error(`No operator container found in deployment ${name}`);
      }

      return {
        name,
        env: container.env ?? [],
        replicas: deployment.spec?.replicas ?? 1,
      };
    }
  }

  throw new Error('firestartr controller deployment not found');
}

export async function setControllerEnv(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
  name: string,
  env: k8s.V1EnvVar[],
): Promise<void> {
  const appsApi = getKubeConfig().makeApiClient(k8s.AppsV1Api);
  // Strategic merge merges env entries by name, so it never removes an entry
  // such as OPERATOR_PLAN_MODE. Replace the whole env array instead.
  await appsApi.patchNamespacedDeployment(
    {
      name,
      namespace,
      body: [
        {
          op: 'add',
          path: '/spec/template/spec/containers/0/env',
          value: env,
        },
      ],
    },
    JSON_PATCH_HEADERS,
  );
}

export async function scaleController(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
  name: string,
  replicas: number,
): Promise<void> {
  const appsApi = getKubeConfig().makeApiClient(k8s.AppsV1Api);
  await appsApi.patchNamespacedDeployment(
    {
      name,
      namespace,
      body: { spec: { replicas } },
    },
    STRATEGIC_MERGE_PATCH_HEADERS,
  );
}

export async function waitForControllerReplicas(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
  name: string,
  expected: number,
): Promise<void> {
  const appsApi = getKubeConfig().makeApiClient(k8s.AppsV1Api);
  await pollUntil(
    async () => {
      const deployment = await appsApi.readNamespacedDeployment({
        name,
        namespace,
      });
      return {
        replicas: deployment.status?.replicas ?? 0,
        ready: deployment.status?.readyReplicas ?? 0,
      };
    },
    {
      timeoutMs: OPERATOR_ROLLOUT_TIMEOUT_MS,
      intervalMs: 2000,
      isDone: (state) =>
        state.replicas === expected && state.ready === expected,
      createTimeoutError: (last) =>
        new Error(
          `Timed out waiting for deployment ${name} to reach ${expected} replicas ` +
            `(replicas=${last?.replicas}, ready=${last?.ready})`,
        ),
    },
  );
}

export async function waitForControllerRollout(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
  name: string,
): Promise<void> {
  const appsApi = getKubeConfig().makeApiClient(k8s.AppsV1Api);
  await pollUntil(
    async () => {
      const deployment = await appsApi.readNamespacedDeployment({
        name,
        namespace,
      });
      return {
        generation: deployment.metadata?.generation ?? 0,
        observedGeneration: deployment.status?.observedGeneration ?? 0,
        updatedReplicas: deployment.status?.updatedReplicas ?? 0,
        readyReplicas: deployment.status?.readyReplicas ?? 0,
        replicas: deployment.status?.replicas ?? 0,
      };
    },
    {
      timeoutMs: OPERATOR_ROLLOUT_TIMEOUT_MS,
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

export async function readControllerLogs(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
): Promise<string> {
  const coreApi = getKubeConfig().makeApiClient(k8s.CoreV1Api);
  const pods = await coreApi.listNamespacedPod({
    namespace,
    labelSelector: CONTROLLER_LABELS,
  });
  const running = pods.items.find(
    (pod) =>
      !pod.metadata?.deletionTimestamp && pod.status?.phase === 'Running',
  );

  if (!running?.metadata?.name) return '';

  return coreApi.readNamespacedPodLog({
    name: running.metadata.name,
    namespace,
  });
}

export async function readBackendStateVersions(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
): Promise<Record<string, string>> {
  const kubeConfig = getKubeConfig();
  const coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
  const coordinationApi = kubeConfig.makeApiClient(k8s.CoordinationV1Api);
  const secrets = await coreApi.listNamespacedSecret({ namespace });
  const leases = await coordinationApi.listNamespacedLease({ namespace });
  const snapshot: Record<string, string> = {};

  for (const [kind, items] of [
    ['Secret', secrets.items],
    ['Lease', leases.items],
  ] as const) {
    for (const item of items) {
      const name = item.metadata?.name ?? '';
      if (!name.includes(TF_STATE_FRAGMENT)) continue;
      snapshot[`${kind}/${name}`] = item.metadata?.resourceVersion ?? '';
    }
  }

  return snapshot;
}

export async function configMapExists(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
  name: string,
): Promise<boolean> {
  const coreApi = getKubeConfig().makeApiClient(k8s.CoreV1Api);
  try {
    await coreApi.readNamespacedConfigMap({ name, namespace });
    return true;
  } catch (error: unknown) {
    if (getStatusCode(error as StatusCodeError) === 404) return false;
    throw error;
  }
}

async function deleteIgnoringNotFound(
  remove: () => Promise<unknown>,
): Promise<void> {
  try {
    await remove();
  } catch (error: unknown) {
    if (getStatusCode(error as StatusCodeError) !== 404) throw error;
  }
}

// Removes what a force-deleted workspace leaves behind: the ConfigMaps its
// module created and its backend state Secret.
export async function deleteWorkspaceInfrastructure(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
  claimNames: string[],
  tfStateKeys: string[],
): Promise<void> {
  const coreApi = getKubeConfig().makeApiClient(k8s.CoreV1Api);
  const configMaps = await coreApi.listNamespacedConfigMap({ namespace });

  for (const configMap of configMaps.items) {
    const name = configMap.metadata?.name;
    if (
      name &&
      claimNames.some((claimName) => name.startsWith(`${claimName}-configmap-`))
    ) {
      await deleteIgnoringNotFound(() =>
        coreApi.deleteNamespacedConfigMap({ name, namespace }),
      );
    }
  }

  for (const tfStateKey of tfStateKeys) {
    await deleteIgnoringNotFound(() =>
      coreApi.deleteNamespacedSecret({
        name: `tfstate-default-${tfStateKey}`,
        namespace,
      }),
    );
  }
}

export async function readWorkspace(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
  name: string,
): Promise<any> {
  const customObjectsApi = getKubeConfig().makeApiClient(k8s.CustomObjectsApi);
  return customObjectsApi.getNamespacedCustomObject({
    group: API_GROUP,
    version: API_VERSION,
    namespace,
    plural: TF_PLURAL,
    name,
  });
}

export async function deleteStaleTFResult(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
  crName: string,
): Promise<void> {
  const customObjectsApi = getKubeConfig().makeApiClient(k8s.CustomObjectsApi);
  const name = `${TF_KIND}-${crName}`.toLowerCase();

  await deleteIgnoringNotFound(() =>
    customObjectsApi.deleteNamespacedCustomObject({
      group: API_GROUP,
      version: API_VERSION,
      namespace,
      plural: TFRESULT_PLURAL,
      name,
    }),
  );
}
