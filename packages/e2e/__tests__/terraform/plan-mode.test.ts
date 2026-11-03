import fs from 'node:fs/promises';
import path from 'node:path';
import * as k8s from '@kubernetes/client-node';
import common from 'catalog_common';
import {
  CleanupRunner,
  cleanupRenderedArtifacts,
  destroyFixtureResources,
  initE2e,
  prepareProviderConfigManifests,
  resolveE2eProviderConfigsPath,
  type E2EApi,
} from '../..';
import {
  buildClaimRef,
  FIRESTARTR_API_VERSION,
  getFirestartrAnnotation,
} from '../../src/claim-taxonomy';
import { DELETE_TIMEOUT_SECONDS } from '../../src/cleanup/constants';
import {
  getStatusCode,
  type StatusCodeError,
} from '../../src/errors/status-code';
import { createKubeConfigProvider } from '../../src/k8s/config';
import {
  JSON_PATCH_HEADERS,
  STRATEGIC_MERGE_PATCH_HEADERS,
} from '../../src/k8s/constants';
import { getPrimaryManifestResource } from '../../src/k8s/manifests';
import { patchResourceSpecContext } from '../../src/cr-finder';
import {
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  WAIT_FOR_CR_TIMEOUT_SECONDS,
} from '../../src/test-constants';
import { pollUntil } from '../../src/utils/async-control';

const PLAN_MODE_SUITE_ENV_VAR = 'E2E_RUN_PLAN_MODE';

// This test restarts the controller deployment: run it on its own, like the
// retry-lifecycle suite.
const describePlanMode =
  process.env[PLAN_MODE_SUITE_ENV_VAR] === 'true' ? describe : describe.skip;

const OPERATOR_PLAN_MODE_ENV_VAR = 'OPERATOR_PLAN_MODE';
const OPERATOR_KIND_LIST_ENV_VAR = 'OPERATOR_KIND_LIST';

const CONTROLLER_LABELS = 'app=firestartr-controller,concern=controller';
const CONTROLLER_LABEL_SELECTOR = {
  app: 'firestartr-controller',
  concern: 'controller',
};

const API_GROUP = 'firestartr.dev';
const API_VERSION = 'v1';
const TF_KIND = 'FirestartrTerraformWorkspace';
const TF_PLURAL = 'terraformworkspaces';
const TFRESULT_PLURAL = 'tfresults';

const FIXTURE = 'tfworkspace-a';
const CLAIM_KIND = 'TFWorkspaceClaim';
const CLAIM_REF_ANNOTATION = getFirestartrAnnotation('claimRef');
const PROVIDER_CONFIG_MANIFESTS = [
  'kubernetes-backend.yaml',
  'kubernetes.yaml',
] as const;
// Suite-specific names, so the suite never overwrites or deletes the shared
// `kubernetes` and `kubernetes-backend` provider configs other workspaces use.
const PROVIDER_CONFIG_NAMES = {
  backend: 'plan-mode-kubernetes-backend',
  provider: 'plan-mode-kubernetes',
};
// OpenTofu's kubernetes backend stores state in `tfstate-<workspace>-<key>`
// Secrets and locks it with `lock-tfstate-<workspace>-<key>` Leases.
const TF_STATE_FRAGMENT = 'tfstate-';

const LOG_PREFIX = 'plan-mode';

const PLAN_STARTUP_FRAGMENT = 'operator running in Plan mode';
const PLANNED_OPERATION_FRAGMENT = 'PLAN FirestartrTerraformWorkspace';

const OPERATOR_ROLLOUT_TIMEOUT_MS = 120_000;
const PLAN_TIMEOUT_MS = 900_000;
const PROVISION_TIMEOUT_MS = LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS;

type Workspace = {
  suffix: string;
  claimName: string;
  configMapName: string;
  crPath?: string;
  crName?: string;
};

type CapturedDeployment = {
  env: k8s.V1EnvVar[];
  replicas: number;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findOperatorDeploymentName(
  appsApi: k8s.AppsV1Api,
  namespace: string,
): Promise<string> {
  const list = await appsApi.listNamespacedDeployment({ namespace });

  for (const deployment of list.items) {
    const labels = deployment.spec?.template?.metadata?.labels ?? {};
    if (
      labels['app'] === CONTROLLER_LABEL_SELECTOR['app'] &&
      labels['concern'] === CONTROLLER_LABEL_SELECTOR['concern']
    ) {
      const name = deployment.metadata?.name;
      if (name) return name;
    }
  }

  throw new Error('firestartr controller deployment not found');
}

async function captureDeployment(
  appsApi: k8s.AppsV1Api,
  name: string,
  namespace: string,
): Promise<CapturedDeployment> {
  const deployment = await appsApi.readNamespacedDeployment({
    name,
    namespace,
  });
  const container = deployment.spec?.template?.spec?.containers?.[0];

  if (!container) {
    throw new Error(`No operator container found in deployment ${name}`);
  }

  return {
    env: container.env ?? [],
    replicas: deployment.spec?.replicas ?? 1,
  };
}

async function replaceDeploymentEnv(
  appsApi: k8s.AppsV1Api,
  name: string,
  namespace: string,
  env: k8s.V1EnvVar[],
): Promise<void> {
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

function mergeEnv(
  current: k8s.V1EnvVar[],
  overrides: Record<string, string>,
): k8s.V1EnvVar[] {
  const names = new Set(Object.keys(overrides));

  return [
    ...current.filter((entry) => !entry.name || !names.has(entry.name)),
    ...Object.entries(overrides).map(([name, value]) => ({ name, value })),
  ];
}

async function scaleOperator(
  appsApi: k8s.AppsV1Api,
  name: string,
  namespace: string,
  replicas: number,
): Promise<void> {
  await appsApi.patchNamespacedDeployment(
    {
      name,
      namespace,
      body: { spec: { replicas } },
    },
    STRATEGIC_MERGE_PATCH_HEADERS,
  );
}

async function waitForReplicas(
  appsApi: k8s.AppsV1Api,
  name: string,
  namespace: string,
  expected: number,
): Promise<void> {
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

async function waitForDeploymentRollout(
  appsApi: k8s.AppsV1Api,
  name: string,
  namespace: string,
): Promise<void> {
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

async function readOperatorLogs(
  coreApi: k8s.CoreV1Api,
  namespace: string,
): Promise<string> {
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

async function waitForOperatorLog(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  condition: (logs: string) => boolean,
  description: string,
  timeoutMs = OPERATOR_ROLLOUT_TIMEOUT_MS,
): Promise<string> {
  return pollUntil(() => readOperatorLogs(coreApi, namespace), {
    timeoutMs,
    intervalMs: 2000,
    isDone: condition,
    createTimeoutError: () =>
      new Error(`Timed out waiting for operator log: ${description}`),
  });
}

async function readWorkspace(
  customObjectsApi: k8s.CustomObjectsApi,
  namespace: string,
  name: string,
): Promise<any> {
  return customObjectsApi.getNamespacedCustomObject({
    group: API_GROUP,
    version: API_VERSION,
    namespace,
    plural: TF_PLURAL,
    name,
  });
}

async function deleteStaleTFResult(
  customObjectsApi: k8s.CustomObjectsApi,
  namespace: string,
  crName: string,
): Promise<void> {
  const name = `${TF_KIND}-${crName}`.toLowerCase();

  try {
    await customObjectsApi.deleteNamespacedCustomObject({
      group: API_GROUP,
      version: API_VERSION,
      namespace,
      plural: TFRESULT_PLURAL,
      name,
    });
  } catch (error: unknown) {
    if (getStatusCode(error as StatusCodeError) !== 404) throw error;
  }
}

async function snapshotBackendState(
  coreApi: k8s.CoreV1Api,
  coordinationApi: k8s.CoordinationV1Api,
  namespace: string,
): Promise<Record<string, string>> {
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
async function deleteWorkspaceInfrastructure(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  claimNames: string[],
  tfStateKeys: string[],
): Promise<void> {
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

function hasProvisionedCondition(workspace: any): boolean {
  return (workspace.status?.conditions ?? []).some(
    (condition: any) =>
      condition.type === 'PROVISIONED' && condition.status === 'True',
  );
}

async function configMapExists(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  name: string,
): Promise<boolean> {
  try {
    await coreApi.readNamespacedConfigMap({ name, namespace });
    return true;
  } catch (error: unknown) {
    if (getStatusCode(error as StatusCodeError) === 404) return false;
    throw error;
  }
}

async function waitForConfigMap(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  name: string,
): Promise<void> {
  await pollUntil(() => configMapExists(coreApi, namespace, name), {
    timeoutMs: PROVISION_TIMEOUT_MS,
    intervalMs: 3000,
    isDone: (exists) => exists,
    createTimeoutError: () =>
      new Error(`Timed out waiting for Terraform to create ConfigMap ${name}`),
  });
}

describePlanMode('Operator plan mode', () => {
  let client: E2EApi;
  let appsApi: k8s.AppsV1Api;
  let coreApi: k8s.CoreV1Api;
  let coordinationApi: k8s.CoordinationV1Api;
  let customObjectsApi: k8s.CustomObjectsApi;
  let namespace: string;
  let operatorDeploymentName: string;
  let originalDeployment: CapturedDeployment;
  let providerConfigsTempDir: string | undefined;
  let operatorIsLive = false;

  const workspaces: Workspace[] = ['a', 'b'].map((suffix) => ({
    claimName: '',
    configMapName: '',
    suffix,
  }));

  function fixtureInputs() {
    return workspaces.map((workspace) => ({
      fixtureName: FIXTURE,
      claimName: workspace.claimName,
    }));
  }

  function claimRefs(): string[] {
    return workspaces.map((workspace) =>
      buildClaimRef(CLAIM_KIND, workspace.claimName),
    );
  }

  // Deletes the workspaces and waits for the live operator to destroy their
  // infrastructure and state. Without a live operator, or when it fails, the
  // CRs are force-deleted and their infrastructure removed directly.
  async function deleteWorkspaces(operatorRunning: boolean): Promise<void> {
    let failure: unknown;

    if (operatorRunning) {
      try {
        await client.k8s.deleteCustomResourcesByAnnotation({
          kind: TF_KIND,
          apiVersion: FIRESTARTR_API_VERSION,
          annotationKey: CLAIM_REF_ANNOTATION,
          annotationValues: claimRefs(),
          timeout: DELETE_TIMEOUT_SECONDS,
        });
        return;
      } catch (error: unknown) {
        failure = error;
        common.logger.warn(
          `[${LOG_PREFIX}] live operator deletion failed, forcing it: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const remaining = await client.k8s.listCustomResourcesByAnnotation({
      kind: TF_KIND,
      apiVersion: FIRESTARTR_API_VERSION,
      annotationKey: CLAIM_REF_ANNOTATION,
      annotationValues: claimRefs(),
    });
    const tfStateKeys = remaining
      .map(
        (resource) =>
          (resource.spec as { firestartr?: { tfStateKey?: string } })
            ?.firestartr?.tfStateKey,
      )
      .filter((key): key is string => Boolean(key));

    await destroyFixtureResources(client, client.getPrefix(), fixtureInputs(), {
      deleteOrg: false,
      strict: true,
      logPrefix: LOG_PREFIX,
    });
    await deleteWorkspaceInfrastructure(
      coreApi,
      namespace,
      workspaces.map((workspace) => workspace.claimName),
      tfStateKeys,
    );

    if (failure) throw failure;
  }

  async function stopOperator(): Promise<void> {
    await scaleOperator(appsApi, operatorDeploymentName, namespace, 0);
    await waitForReplicas(appsApi, operatorDeploymentName, namespace, 0);
  }

  async function startOperatorWithEnv(env: k8s.V1EnvVar[]): Promise<void> {
    await replaceDeploymentEnv(appsApi, operatorDeploymentName, namespace, env);
    await scaleOperator(appsApi, operatorDeploymentName, namespace, 1);
    await waitForDeploymentRollout(appsApi, operatorDeploymentName, namespace);
    await waitForReplicas(appsApi, operatorDeploymentName, namespace, 1);
  }

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, { namePrefix: LOG_PREFIX });
    namespace = client.k8s.getNamespace();

    const kubeConfig = createKubeConfigProvider({})();
    appsApi = kubeConfig.makeApiClient(k8s.AppsV1Api);
    coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    coordinationApi = kubeConfig.makeApiClient(k8s.CoordinationV1Api);
    customObjectsApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi);

    operatorDeploymentName = await findOperatorDeploymentName(
      appsApi,
      namespace,
    );
    originalDeployment = await captureDeployment(
      appsApi,
      operatorDeploymentName,
      namespace,
    );

    const runId = Date.now();

    for (const workspace of workspaces) {
      workspace.claimName = `${client.getPrefix()}-e2e-plan-mode-${workspace.suffix}`;
      workspace.configMapName = `${workspace.claimName}-configmap-${runId}`;
    }

    const providerConfigsPath = resolveE2eProviderConfigsPath();
    providerConfigsTempDir = await prepareProviderConfigManifests(
      providerConfigsPath,
      namespace,
      PROVIDER_CONFIG_NAMES,
    );

    for (const manifestName of PROVIDER_CONFIG_MANIFESTS) {
      await client.k8s.applyCr(path.join(providerConfigsTempDir, manifestName));
    }

    // Let the live operator destroy anything an earlier run left behind, then
    // stop it before touching its environment.
    if (originalDeployment.replicas < 1) {
      await startOperatorWithEnv(originalDeployment.env);
    }
    await deleteWorkspaces(true);
    await stopOperator();

    // Start only Plan mode, watching only workspace CRs so unrelated cluster
    // state cannot change the artifacts this test asserts on.
    const planModeEnv = mergeEnv(originalDeployment.env, {
      [OPERATOR_PLAN_MODE_ENV_VAR]: 'true',
      [OPERATOR_KIND_LIST_ENV_VAR]: TF_PLURAL,
    });

    await startOperatorWithEnv(planModeEnv);

    await waitForOperatorLog(
      coreApi,
      namespace,
      (logs) => logs.includes(PLAN_STARTUP_FRAGMENT),
      `'${PLAN_STARTUP_FRAGMENT}'`,
    );
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) return;

    const cleanup = new CleanupRunner();
    const providerConfigsDir = providerConfigsTempDir;

    const canManageOperator = Boolean(
      appsApi && operatorDeploymentName && originalDeployment,
    );

    if (canManageOperator && !operatorIsLive) {
      await cleanup.run('start the live operator', async () => {
        await stopOperator();
        await startOperatorWithEnv(originalDeployment.env);
        operatorIsLive = true;
      });
    }

    await cleanup.run('delete rendered workspaces', async () => {
      await deleteWorkspaces(operatorIsLive);
    });

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    if (providerConfigsDir) {
      for (const manifestName of PROVIDER_CONFIG_MANIFESTS) {
        await cleanup.run(
          `delete provider config ${manifestName}`,
          async () => {
            await client.k8s.deleteCr(
              path.join(providerConfigsDir, manifestName),
            );
          },
        );
      }

      await cleanup.run('remove provider config temp dir', async () => {
        await fs.rm(providerConfigsDir, { recursive: true, force: true });
      });
    }

    if (canManageOperator) {
      // startOperatorWithEnv always runs one replica: put back the captured
      // environment and replica count even when the live operator resumed.
      await cleanup.run('restore operator deployment', async () => {
        await replaceDeploymentEnv(
          appsApi,
          operatorDeploymentName,
          namespace,
          originalDeployment.env,
        );
        await scaleOperator(
          appsApi,
          operatorDeploymentName,
          namespace,
          originalDeployment.replicas,
        );
        await waitForDeploymentRollout(
          appsApi,
          operatorDeploymentName,
          namespace,
        );
        await waitForReplicas(
          appsApi,
          operatorDeploymentName,
          namespace,
          originalDeployment.replicas,
        );
      });
    }

    cleanup.throwOnErrors(`${LOG_PREFIX} afterAll`);
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'plans every CR without writing status, finalizers, TFResults or infrastructure',
    async () => {
      const backendStateBefore = await snapshotBackendState(
        coreApi,
        coordinationApi,
        namespace,
      );

      for (const workspace of workspaces) {
        const rendered = await client.claims.renderLocally(FIXTURE, {
          sourceFixtureName: FIXTURE,
          claimName: workspace.claimName,
          patches: [
            {
              op: 'replace',
              path: '/providers/terraform/values/configmap_name',
              value: workspace.configMapName,
            },
          ],
        });

        const crPath = rendered.crPaths[0];
        if (!crPath) {
          throw new Error(
            `No rendered CR path found for ${workspace.claimName}`,
          );
        }

        await patchResourceSpecContext(crPath, {
          backend: { ref: PROVIDER_CONFIG_NAMES.backend },
          providers: [{ ref: PROVIDER_CONFIG_NAMES.provider }],
        });

        const resource = await getPrimaryManifestResource(crPath);
        if (!resource.metadata?.name) {
          throw new Error(`Missing name for rendered ${workspace.claimName}`);
        }
        const resourceContext = (
          resource.spec as {
            context?: {
              providers?: Array<{ ref: string }>;
              backend?: { ref: string };
            };
          }
        )?.context;
        expect(resourceContext?.providers).toEqual([
          { ref: PROVIDER_CONFIG_NAMES.provider },
        ]);
        expect(resourceContext?.backend).toEqual({
          ref: PROVIDER_CONFIG_NAMES.backend,
        });

        workspace.crPath = crPath;
        workspace.crName = resource.metadata.name;

        // A previous run of this suite may have left a TFResult for the same
        // CR name; Plan mode must not add one of its own.
        await deleteStaleTFResult(
          customObjectsApi,
          namespace,
          workspace.crName,
        );

        await client.k8s.applyCr(crPath);
      }

      for (const workspace of workspaces) {
        const crName = workspace.crName!;

        const logs = await waitForOperatorLog(
          coreApi,
          namespace,
          (current) =>
            new RegExp(
              `${PLANNED_OPERATION_FRAGMENT}/${escapeRegExp(
                crName,
              )} CREATED: \\+\\d+ ~\\d+ -\\d+ \\(.+\\)`,
            ).test(current),
          `PLAN artifact for ${TF_KIND}/${crName}`,
          PLAN_TIMEOUT_MS,
        );

        const planLine = logs
          .split('\n')
          .find((line) =>
            line.includes(`${PLANNED_OPERATION_FRAGMENT}/${crName} CREATED:`),
          );
        expect(planLine).toBeDefined();

        const planMatch = planLine?.match(
          /CREATED: \+(\d+) ~(\d+) -(\d+) \((.+)\)/,
        );
        expect(planMatch).not.toBeNull();
        expect(Number(planMatch?.[1])).toBeGreaterThan(0);
        expect(planMatch?.[4]).toContain(
          `/FirestartrTerraformWorkspace/${crName}.md`,
        );

        const planned = await readWorkspace(
          customObjectsApi,
          namespace,
          crName,
        );

        expect(hasProvisionedCondition(planned)).toBe(false);
        expect(planned.status?.conditions ?? []).toEqual([]);
        expect(planned.metadata?.finalizers ?? []).not.toContain(
          'firestartr.dev/finalizer',
        );

        await expect(
          client.k8s.findTFResultByReference(TF_KIND, crName),
        ).resolves.toBeUndefined();

        expect(
          await configMapExists(coreApi, namespace, workspace.configMapName),
        ).toBe(false);
      }

      // Plans read a snapshot of the state: they never take the backend's
      // Lease nor create or update its state Secret.
      await expect(
        snapshotBackendState(coreApi, coordinationApi, namespace),
      ).resolves.toEqual(backendStateBefore);
    },
    PLAN_TIMEOUT_MS,
  );

  it(
    'stops the Plan mode operator and starts the live operator again',
    async () => {
      await stopOperator();
      await startOperatorWithEnv(originalDeployment.env);

      await waitForOperatorLog(
        coreApi,
        namespace,
        (logs) =>
          logs.includes('started the operator with options') &&
          !logs.includes(PLAN_STARTUP_FRAGMENT),
        'the live operator to start without Plan mode',
      );

      operatorIsLive = true;
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );

  it(
    'provisions every planned CR once Plan mode is off',
    async () => {
      for (const workspace of workspaces) {
        const resource = await client.k8s.waitForCr(
          workspace.crPath!,
          WAIT_FOR_CR_TIMEOUT_SECONDS,
        );

        expect(hasProvisionedCondition(resource)).toBe(true);
        await waitForConfigMap(coreApi, namespace, workspace.configMapName);
      }
    },
    PROVISION_TIMEOUT_MS,
  );
});
