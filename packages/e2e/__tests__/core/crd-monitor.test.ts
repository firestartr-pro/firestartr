import fs from 'node:fs';

import * as k8s from '@kubernetes/client-node';
import common from 'catalog_common';

import { initE2e } from '../../';
import { createKubeConfigProvider } from '../../src/k8s/config';
import { getStatusCode } from '../../src/errors/status-code';
import { pollUntil } from '../../src/utils/async-control';

const TIMEOUT = 60_000;
const CRDS = [
  'githubgroups.firestartr.dev',
  'githubmemberships.firestartr.dev',
];
function getDummyCrdPath(): string {
  const paths = [
    'packages/k8s/dev/dummy-crds/firestartrdummy-a-crd.yaml',
    '../k8s/dev/dummy-crds/firestartrdummy-a-crd.yaml',
  ];
  const path = paths.find((candidate) => fs.existsSync(candidate));
  if (!path) throw new Error('FirestartrDummyA CRD manifest not found');
  return path;
}

function createDummyResource(name: string): object {
  return {
    apiVersion: 'firestartr.dev/v1',
    kind: 'FirestartrDummyA',
    metadata: { name, namespace: 'default' },
    spec: { computation: { numberOfSeconds: 1 } },
  };
}

async function findOperatorDeploymentName(
  appsApi: k8s.AppsV1Api,
): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const list = await appsApi.listNamespacedDeployment({
      namespace: 'default',
    });

    for (const dep of list.items) {
      const labels = dep.spec?.template?.metadata?.labels ?? {};
      if (
        labels['app'] === 'firestartr-controller' &&
        labels['concern'] === 'controller'
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
  common.logger.info(`[crd-monitor] scaling deployment ${name} to ${replicas}`);

  await appsApi.patchNamespacedDeployment({
    name,
    namespace: 'default',
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
        namespace: 'default',
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

async function deleteCrd(
  api: k8s.ApiextensionsV1Api,
  crd: string,
): Promise<void> {
  try {
    await api.deleteCustomResourceDefinition({ name: crd });
  } catch (error: unknown) {
    const status = getStatusCode(error as Parameters<typeof getStatusCode>[0]);
    if (status !== 404) throw error;
  }
}

async function waitForCrdDeletion(
  api: k8s.ApiextensionsV1Api,
  crd: string,
): Promise<void> {
  await pollUntil(
    async () => {
      try {
        await api.readCustomResourceDefinition({ name: crd });
        return false;
      } catch (error: unknown) {
        const status = getStatusCode(
          error as Parameters<typeof getStatusCode>[0],
        );
        if (status === 404) return true;
        throw error;
      }
    },
    {
      timeoutMs: 60_000,
      intervalMs: 1000,
      isDone: (deleted) => deleted,
      createTimeoutError: () =>
        new Error(`Timed out waiting for CRD ${crd} to be deleted`),
    },
  );
}

async function addWatchedKind(
  appsApi: k8s.AppsV1Api,
  name: string,
  kind: string,
): Promise<void> {
  const deployment = await appsApi.readNamespacedDeployment({
    name,
    namespace: 'default',
  });
  const container = deployment.spec?.template?.spec?.containers[0];
  if (!container) throw new Error(`No operator container found in ${name}`);

  const current = container.env?.find(
    (entry) => entry.name === 'OPERATOR_KIND_LIST',
  )?.value;
  const kinds = current?.split(',').filter(Boolean) ?? [];
  if (kinds.includes(kind)) return;

  await appsApi.patchNamespacedDeployment({
    name,
    namespace: 'default',
    body: [
      {
        op: 'replace',
        path: '/spec/template/spec/containers/0/env',
        value: [
          ...(container.env ?? []).filter(
            (entry) => entry.name !== 'OPERATOR_KIND_LIST',
          ),
          { name: 'OPERATOR_KIND_LIST', value: [...kinds, kind].join(',') },
        ],
      },
    ],
  });
}

async function waitForOperatorWithWatchedKind(
  appsApi: k8s.AppsV1Api,
  coreApi: k8s.CoreV1Api,
  deploymentName: string,
  kind: string,
): Promise<void> {
  await pollUntil(
    async () => {
      const deployment = await appsApi.readNamespacedDeployment({
        name: deploymentName,
        namespace: 'default',
      });
      const expectedValue =
        deployment.spec?.template?.spec?.containers[0].env?.find(
          (entry) => entry.name === 'OPERATOR_KIND_LIST',
        )?.value;
      if (!expectedValue?.split(',').includes(kind)) return false;

      const selector = Object.entries(
        deployment.spec?.selector?.matchLabels ?? {},
      )
        .map(([key, value]) => `${key}=${value}`)
        .join(',');
      const pods = await coreApi.listNamespacedPod({
        namespace: 'default',
        labelSelector: selector,
      });

      return pods.items.some((pod) => {
        const phase = pod.status?.phase;
        const ready = pod.status?.conditions?.some(
          (condition) =>
            condition.type === 'Ready' && condition.status === 'True',
        );
        const actualValue = pod.spec?.containers[0].env?.find(
          (entry) => entry.name === 'OPERATOR_KIND_LIST',
        )?.value;
        return (
          phase === 'Running' && ready && actualValue?.split(',').includes(kind)
        );
      });
    },
    {
      timeoutMs: 120_000,
      intervalMs: 2000,
      isDone: (ready) => ready,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for operator ${deploymentName} to restart with ${kind} in OPERATOR_KIND_LIST`,
        ),
    },
  );
}

async function waitForOperatorLog(
  coreApi: k8s.CoreV1Api,
  condition: (logs: string) => boolean,
  timeout = TIMEOUT,
): Promise<void> {
  await pollUntil(
    async () => {
      const pods = await coreApi.listNamespacedPod({
        namespace: 'default',
        labelSelector: 'app=firestartr-controller,concern=controller',
      });
      const pod = pods.items.find(
        (item) =>
          item.status?.phase === 'Running' &&
          !item.metadata?.deletionTimestamp &&
          item.metadata?.name,
      );
      if (!pod?.metadata?.name) return false;

      const logs = await coreApi.readNamespacedPodLog({
        name: pod.metadata.name,
        namespace: 'default',
      });
      return condition(logs);
    },
    {
      timeoutMs: timeout,
      intervalMs: 1000,
      isDone: (matched) => matched,
      createTimeoutError: () =>
        new Error('Timed out waiting for operator log condition'),
    },
  );
}

describe('[core] crd monitor diagnostics', () => {
  let client: Awaited<ReturnType<typeof initE2e>>;
  let appsApi: k8s.AppsV1Api;
  let extensionsApi: k8s.ApiextensionsV1Api;
  let customObjectsApi: k8s.CustomObjectsApi;
  let coreApi: k8s.CoreV1Api;
  let operatorDeploymentName: string;
  const dummyResourceName = `crd-monitor-trigger-${Date.now()}`;

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'crd-monitor',
    });

    const kubeConfigProvider = createKubeConfigProvider({});
    const kubeConfig = kubeConfigProvider();
    appsApi = kubeConfig.makeApiClient(k8s.AppsV1Api);
    extensionsApi = kubeConfig.makeApiClient(k8s.ApiextensionsV1Api);
    customObjectsApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi);
    coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    operatorDeploymentName = await findOperatorDeploymentName(appsApi);

    await scaleDeployment(appsApi, operatorDeploymentName, 0);
    await waitForDeploymentReplicas(appsApi, operatorDeploymentName, 0);

    await client.k8s.applyCr(getDummyCrdPath());
    await addWatchedKind(appsApi, operatorDeploymentName, 'fsdummiesa');

    for (const crd of CRDS) {
      await deleteCrd(extensionsApi, crd);
      await waitForCrdDeletion(extensionsApi, crd);
    }

    await scaleDeployment(appsApi, operatorDeploymentName, 1);
    await waitForDeploymentReplicas(appsApi, operatorDeploymentName, 1);
    await waitForOperatorWithWatchedKind(
      appsApi,
      coreApi,
      operatorDeploymentName,
      'fsdummiesa',
    );

    await customObjectsApi.createNamespacedCustomObject({
      group: 'firestartr.dev',
      version: 'v1',
      namespace: 'default',
      plural: 'fsdummiesa',
      body: createDummyResource(dummyResourceName),
    });
  }, 120_000);

  afterAll(async () => {
    if (customObjectsApi) {
      try {
        await customObjectsApi.deleteNamespacedCustomObject({
          group: 'firestartr.dev',
          version: 'v1',
          namespace: 'default',
          plural: 'fsdummiesa',
          name: dummyResourceName,
        });
      } catch {
        // Cleanup is best effort when setup fails before the dummy exists.
      }
    }
    if (client) await client.k8s.applyInBranchCrds();
  }, 120_000);

  it('detects missing github CRDs at startup and does not mark them observed after install', async () => {
    const expectedMissing = [
      'default/githubgroups',
      'default/githubmemberships',
    ];

    await waitForOperatorLog(coreApi, (logs) =>
      expectedMissing.every((missing) =>
        logs.includes(
          `Started CRD monitor for missing kind '${missing.split('/')[1]}'`,
        ),
      ),
    );

    await client.k8s.applyInBranchCrds();

    await waitForOperatorLog(coreApi, (logs) =>
      expectedMissing.every((missing) =>
        logs.includes(
          `CRD monitor: CRD '${missing.split('/')[1]}.firestartr.dev' is now available`,
        ),
      ),
    );
  }, 120_000);
});
