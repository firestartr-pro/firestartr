/**
 * Live: operator Plan mode e2e (TerraformWorkspace kind only).
 *
 * Runs alone: restarts the controller. Opt-in E2E_RUN_PLAN_MODE=true or the
 * `plan-mode` suite.
 *
 * 1. Save controller env + replicas.
 * 2. Start live operator, delete leftovers from earlier runs.
 * 3. Live operator provisions a (update) and b (destroy), each: render with
 *    configmap_name=<cm>-<run>, apply CR, wait PROVISIONED=True, finalizer
 *    `firestartr.dev/finalizer` present, ConfigMap created.
 * 4. Stop live operator; start Plan mode: OPERATOR_PLAN_MODE=true,
 *    OPERATOR_KIND_LIST=terraformworkspaces.
 * 5. Create phase, workspace c (fresh):
 *    5a. Render with configmap_name=<cm>-<run>, delete stale TFResult, apply CR.
 *    5b. Wait log `PLAN ... CREATED`.
 *    5c. Read .md and .json from /tmp/plans in controller pod (exec cat).
 *    5d. Markdown has a non-empty fenced `## Plan` block; JSON parses; operation
 *        CREATED; status PLANNED; plan non-null.
 *    5e. JSON counts equal log counts; +N > 0.
 *    5f. CR: no status/conditions, no finalizer.
 *    5g. No TFResult; no ConfigMap.
 *    5h. Backend tfstate Secrets/Leases resourceVersion unchanged.
 * 6. Update phase, workspace a:
 *    6a. Snapshot CR status + finalizers.
 *    6b. Re-render with configmap_name=<cm>-<run>-updated, apply CR.
 *    6c. Wait log `PLAN ... UPDATED`; read + check artifact (5c-5e).
 *    6d. CR status + finalizers equal snapshot (observe-only).
 *    6e. Updated ConfigMap not created; backend unchanged.
 * 7. Destroy phase, workspace b:
 *    7a. Snapshot CR status + finalizers.
 *    7b. Request deletion (no wait).
 *    7c. Wait log `PLAN ... MARKED_TO_DELETION`; read + check artifact.
 *    7d. CR has deletionTimestamp and finalizer still set.
 *    7e. CR status + finalizers equal snapshot; backend unchanged.
 * 8. Stop Plan mode; restart live operator with original env.
 * 9. Workspace a: PROVISIONED=True and updated ConfigMap exists.
 * 10. Workspace c: PROVISIONED=True and its ConfigMap exists.
 * 11. Workspace b: deletion finished by live operator (CR gone).
 * 12. afterAll: start live operator if needed, delete CRs/artifacts/provider
 *     configs, restore deployment; errors collected and rethrown.
 * Any operator log wait that times out also throws the last 60 operator log
 * lines.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type * as k8s from '@kubernetes/client-node';
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
import type { ControllerDeployment } from '../../src/k8s/controller';
import { getPrimaryManifestResource } from '../../src/k8s/manifests';
import { patchResourceSpecContext } from '../../src/cr-finder';
import {
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  WAIT_FOR_CR_TIMEOUT_SECONDS,
} from '../../src/test-constants';
import { pollUntil } from '../../src/utils/async-control';
import {
  assertArtifactMatchesLog,
  assertPlanned,
  assertPlanMarkdown,
  findPlanLogLine,
  assertObserveOnly,
  type ObservedFields,
  type PlanArtifact,
  type PlanLogLine,
} from '../../src/plan-mode/observe';

const PLAN_MODE_SUITE_ENV_VAR = 'E2E_RUN_PLAN_MODE';

// This test restarts the controller deployment: run it on its own, like the
// retry-lifecycle suite.
const describePlanMode =
  process.env[PLAN_MODE_SUITE_ENV_VAR] === 'true' ? describe : describe.skip;

const OPERATOR_PLAN_MODE_ENV_VAR = 'OPERATOR_PLAN_MODE';
const OPERATOR_KIND_LIST_ENV_VAR = 'OPERATOR_KIND_LIST';

const TF_KIND = 'FirestartrTerraformWorkspace';
const TF_PLURAL = 'terraformworkspaces';

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

const LOG_PREFIX = 'plan-mode';
const OPERATOR_LOG_TAIL_LINES = 60;

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

type ProviderConfigRef = { kind: string; name: string };

function providerConfigRef(name: string): ProviderConfigRef {
  return { kind: 'FirestartrProviderConfig', name };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function waitForOperatorLog(
  client: E2EApi,
  condition: (logs: string) => boolean,
  description: string,
  timeoutMs = OPERATOR_ROLLOUT_TIMEOUT_MS,
): Promise<string> {
  try {
    return await pollUntil(() => client.k8s.readControllerLogs(), {
      timeoutMs,
      intervalMs: 2000,
      isDone: condition,
      createTimeoutError: () =>
        new Error(`Timed out waiting for operator log: ${description}`),
    });
  } catch (error: unknown) {
    const tail = (await client.k8s.readControllerLogs())
      .split('\n')
      .slice(-OPERATOR_LOG_TAIL_LINES)
      .join('\n');
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
        `Last ${OPERATOR_LOG_TAIL_LINES} operator log lines:\n${tail}`,
    );
  }
}

function hasProvisionedCondition(workspace: any): boolean {
  return (workspace.status?.conditions ?? []).some(
    (condition: any) =>
      condition.type === 'PROVISIONED' && condition.status === 'True',
  );
}

async function waitForConfigMap(client: E2EApi, name: string): Promise<void> {
  await pollUntil(() => client.k8s.configMapExists(name), {
    timeoutMs: PROVISION_TIMEOUT_MS,
    intervalMs: 3000,
    isDone: (exists) => exists,
    createTimeoutError: () =>
      new Error(`Timed out waiting for Terraform to create ConfigMap ${name}`),
  });
}

async function waitForPlan(
  client: E2EApi,
  crName: string,
  operation: string,
): Promise<PlanLogLine> {
  const logs = await waitForOperatorLog(
    client,
    (current) =>
      findPlanLogLine(current, TF_KIND, crName, operation) !== undefined,
    `PLAN ${operation} for ${TF_KIND}/${crName}`,
    PLAN_TIMEOUT_MS,
  );

  return findPlanLogLine(logs, TF_KIND, crName, operation)!;
}

// Reads the plan the operator wrote into its pod and checks it against the
// log line that announced it.
async function readPlanArtifact(
  client: E2EApi,
  planned: PlanLogLine,
): Promise<PlanArtifact> {
  const md = await client.k8s.readControllerFile(planned.artifactMd);
  expect(md).toContain(`# ${TF_KIND}/${planned.name}`);

  const json = await client.k8s.readControllerFile(
    planned.artifactMd.replace(/\.md$/, '.json'),
  );
  const artifact = JSON.parse(json) as PlanArtifact;
  assertArtifactMatchesLog(artifact, planned);

  if (artifact.result.status === 'PLANNED') assertPlanMarkdown(md, planned);

  return artifact;
}

async function waitForWorkspaceGone(
  client: E2EApi,
  claimRef: string,
): Promise<void> {
  await pollUntil(
    () =>
      client.k8s.listCustomResourcesByAnnotation({
        kind: TF_KIND,
        apiVersion: FIRESTARTR_API_VERSION,
        annotationKey: CLAIM_REF_ANNOTATION,
        annotationValues: [claimRef],
      }),
    {
      timeoutMs: PROVISION_TIMEOUT_MS,
      intervalMs: 3000,
      isDone: (items) => items.length === 0,
      createTimeoutError: () =>
        new Error(`Timed out waiting for ${claimRef} to be deleted`),
    },
  );
}

describePlanMode('Operator plan mode', () => {
  let client: E2EApi;
  let operatorDeploymentName: string;
  let originalDeployment: ControllerDeployment;
  let providerConfigsTempDir: string | undefined;
  let operatorIsLive = false;

  // a and b exist before Plan mode starts, so update and destroy work on real
  // Terraform state; c is created under Plan mode.
  const workspaces: Workspace[] = ['a', 'b', 'c'].map((suffix) => ({
    claimName: '',
    configMapName: '',
    suffix,
  }));
  const [updatedWorkspace, destroyedWorkspace, createdWorkspace] = workspaces;

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
    await client.k8s.deleteWorkspaceInfrastructure(
      workspaces.map((workspace) => workspace.claimName),
      tfStateKeys,
    );

    if (failure) throw failure;
  }

  async function stopOperator(): Promise<void> {
    await client.k8s.scaleController(operatorDeploymentName, 0);
    await client.k8s.waitForControllerReplicas(operatorDeploymentName, 0);
  }

  async function startOperatorWithEnv(env: k8s.V1EnvVar[]): Promise<void> {
    await client.k8s.setControllerEnv(operatorDeploymentName, env);
    await client.k8s.scaleController(operatorDeploymentName, 1);
    await client.k8s.waitForControllerRollout(operatorDeploymentName);
    await client.k8s.waitForControllerReplicas(operatorDeploymentName, 1);
  }

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, { namePrefix: LOG_PREFIX });

    originalDeployment = await client.k8s.readControllerDeployment();
    operatorDeploymentName = originalDeployment.name;

    const runId = Date.now();

    for (const workspace of workspaces) {
      workspace.claimName = `${client.getPrefix()}-e2e-plan-mode-${workspace.suffix}`;
      workspace.configMapName = `${workspace.claimName}-configmap-${runId}`;
    }

    const providerConfigsPath = resolveE2eProviderConfigsPath();
    providerConfigsTempDir = await prepareProviderConfigManifests(
      providerConfigsPath,
      client.k8s.getNamespace(),
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

    // Update and destroy need provisioned state with the finalizer set, so the
    // live operator provisions them before Plan mode starts.
    const provisioning = [updatedWorkspace, destroyedWorkspace];
    for (const workspace of provisioning) {
      const crPath = await renderWorkspace(workspace, workspace.configMapName);
      await client.k8s.deleteStaleTFResult(workspace.crName!);
      await client.k8s.applyCr(crPath);
    }
    for (const workspace of provisioning) {
      const resource = await client.k8s.waitForCr(
        workspace.crPath!,
        WAIT_FOR_CR_TIMEOUT_SECONDS,
      );

      expect(hasProvisionedCondition(resource)).toBe(true);
      expect(resource.metadata?.finalizers ?? []).toContain(
        'firestartr.dev/finalizer',
      );
      await waitForConfigMap(client, workspace.configMapName);
    }

    await stopOperator();

    // Start only Plan mode, watching only workspace CRs so unrelated cluster
    // state cannot change the artifacts this test asserts on.
    const planModeEnv = mergeEnv(originalDeployment.env, {
      [OPERATOR_PLAN_MODE_ENV_VAR]: 'true',
      [OPERATOR_KIND_LIST_ENV_VAR]: TF_PLURAL,
    });

    await startOperatorWithEnv(planModeEnv);

    await waitForOperatorLog(
      client,
      (logs) => logs.includes(PLAN_STARTUP_FRAGMENT),
      `'${PLAN_STARTUP_FRAGMENT}'`,
    );
  }, 2 * PROVISION_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) return;

    const cleanup = new CleanupRunner();
    const providerConfigsDir = providerConfigsTempDir;

    const canManageOperator = Boolean(
      operatorDeploymentName && originalDeployment,
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
        await client.k8s.setControllerEnv(
          operatorDeploymentName,
          originalDeployment.env,
        );
        await client.k8s.scaleController(
          operatorDeploymentName,
          originalDeployment.replicas,
        );
        await client.k8s.waitForControllerRollout(operatorDeploymentName);
        await client.k8s.waitForControllerReplicas(
          operatorDeploymentName,
          originalDeployment.replicas,
        );
      });
    }

    cleanup.throwOnErrors(`${LOG_PREFIX} afterAll`);
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  async function renderWorkspace(
    workspace: Workspace,
    configMapName: string,
  ): Promise<string> {
    const rendered = await client.claims.renderLocally(FIXTURE, {
      sourceFixtureName: FIXTURE,
      claimName: workspace.claimName,
      patches: [
        {
          op: 'replace',
          path: '/providers/terraform/values/configmap_name',
          value: configMapName,
        },
      ],
    });

    const crPath = rendered.crPaths[0];
    if (!crPath) {
      throw new Error(`No rendered CR path found for ${workspace.claimName}`);
    }

    await patchResourceSpecContext(crPath, {
      backend: { ref: providerConfigRef(PROVIDER_CONFIG_NAMES.backend) },
      providers: [{ ref: providerConfigRef(PROVIDER_CONFIG_NAMES.provider) }],
    });

    const resource = await getPrimaryManifestResource(crPath);
    if (!resource.metadata?.name) {
      throw new Error(`Missing name for rendered ${workspace.claimName}`);
    }
    const resourceContext = (
      resource.spec as {
        context?: {
          providers?: Array<{ ref: ProviderConfigRef }>;
          backend?: { ref: ProviderConfigRef };
        };
      }
    )?.context;
    expect(resourceContext?.providers).toEqual([
      { ref: providerConfigRef(PROVIDER_CONFIG_NAMES.provider) },
    ]);
    expect(resourceContext?.backend).toEqual({
      ref: providerConfigRef(PROVIDER_CONFIG_NAMES.backend),
    });

    workspace.crPath = crPath;
    workspace.crName = resource.metadata.name;

    return crPath;
  }

  async function observe(workspace: Workspace): Promise<ObservedFields> {
    const resource = await client.k8s.readWorkspace(workspace.crName!);

    return {
      status: resource.status,
      finalizers: resource.metadata?.finalizers,
    };
  }

  it(
    'plans create, update and destroy without writing status, finalizers, TFResults or infrastructure',
    async () => {
      const backendStateBefore = await client.k8s.readBackendStateVersions();

      // Create: a fresh workspace, planned under Plan mode.
      for (const workspace of [createdWorkspace]) {
        const crPath = await renderWorkspace(
          workspace,
          workspace.configMapName,
        );

        // A previous run of this suite may have left a TFResult for the same
        // CR name; Plan mode must not add one of its own.
        await client.k8s.deleteStaleTFResult(workspace.crName!);

        await client.k8s.applyCr(crPath);
      }

      for (const workspace of [createdWorkspace]) {
        const crName = workspace.crName!;
        const planned = await waitForPlan(client, crName, 'CREATED');

        expect(planned.counts?.add ?? 0).toBeGreaterThan(0);
        assertPlanned(await readPlanArtifact(client, planned), 'CREATED');

        const created = await client.k8s.readWorkspace(crName);

        expect(hasProvisionedCondition(created)).toBe(false);
        expect(created.status?.conditions ?? []).toEqual([]);
        expect(created.metadata?.finalizers ?? []).not.toContain(
          'firestartr.dev/finalizer',
        );

        await expect(
          client.k8s.findTFResultByReference(TF_KIND, crName),
        ).resolves.toBeUndefined();

        expect(await client.k8s.configMapExists(workspace.configMapName)).toBe(
          false,
        );
      }

      // Update: provisioned workspace a, new configmap_name. Status and
      // finalizers must not move, and the updated ConfigMap must not appear.
      for (const workspace of [updatedWorkspace]) {
        const before = await observe(workspace);

        workspace.configMapName = `${workspace.configMapName}-updated`;
        const crPath = await renderWorkspace(
          workspace,
          workspace.configMapName,
        );
        await client.k8s.applyCr(crPath);

        const planned = await waitForPlan(client, workspace.crName!, 'UPDATED');

        assertPlanned(await readPlanArtifact(client, planned), 'UPDATED');
        assertObserveOnly(
          TF_KIND,
          workspace.crName!,
          before,
          await observe(workspace),
        );
        expect(await client.k8s.configMapExists(workspace.configMapName)).toBe(
          false,
        );
      }

      // Destroy: only workspace b. The live operator would remove its finalizer;
      // Plan mode must leave the CR stuck in deletion.
      const destroyed = destroyedWorkspace;
      const beforeDestroy = await observe(destroyed);

      await client.k8s.requestWorkspaceDeletion(destroyed.crName!);

      const planned = await waitForPlan(
        client,
        destroyed.crName!,
        'MARKED_TO_DELETION',
      );

      expect(planned.counts?.destroy ?? 0).toBeGreaterThan(0);
      assertPlanned(
        await readPlanArtifact(client, planned),
        'MARKED_TO_DELETION',
      );

      const pending = await client.k8s.readWorkspace(destroyed.crName!);

      expect(pending.metadata?.deletionTimestamp).toBeDefined();
      expect(pending.metadata?.finalizers ?? []).toContain(
        'firestartr.dev/finalizer',
      );
      assertObserveOnly(
        TF_KIND,
        destroyed.crName!,
        beforeDestroy,
        await observe(destroyed),
      );

      // Plans read a snapshot of the state: they never take the backend's
      // Lease nor create or update its state Secret.
      await expect(client.k8s.readBackendStateVersions()).resolves.toEqual(
        backendStateBefore,
      );
    },
    PLAN_TIMEOUT_MS,
  );

  it(
    'stops the Plan mode operator and starts the live operator again',
    async () => {
      await stopOperator();
      await startOperatorWithEnv(originalDeployment.env);

      await waitForOperatorLog(
        client,
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
    'provisions the updated CR and finishes the deletion once Plan mode is off',
    async () => {
      const kept = updatedWorkspace;
      const destroyed = destroyedWorkspace;

      const resource = await client.k8s.waitForCr(
        kept.crPath!,
        WAIT_FOR_CR_TIMEOUT_SECONDS,
      );

      expect(hasProvisionedCondition(resource)).toBe(true);
      await waitForConfigMap(client, kept.configMapName);

      const created = createdWorkspace;
      const createdResource = await client.k8s.waitForCr(
        created.crPath!,
        WAIT_FOR_CR_TIMEOUT_SECONDS,
      );

      expect(hasProvisionedCondition(createdResource)).toBe(true);
      await waitForConfigMap(client, created.configMapName);

      await waitForWorkspaceGone(
        client,
        buildClaimRef(CLAIM_KIND, destroyed.claimName),
      );
    },
    PROVISION_TIMEOUT_MS,
  );
});
