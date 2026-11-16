/**
 * Operator Plan mode e2e.
 *
 * Goal: every CR gets planned, nothing gets written.
 *
 * Runs alone (it restarts the controller). Opt-in via E2E_RUN_PLAN_MODE=true,
 * or run the `plan-mode` suite.
 *
 * 1. Save the controller's env and replica count.
 * 2. Start the live operator, delete leftovers from past runs, stop it.
 * 3. Start Plan mode: OPERATOR_PLAN_MODE=true, watching only
 *    terraformworkspaces.
 * 4. Apply two CRs from fixture tfworkspace-a (suffixes a and b).
 * 5. Wait for `PLAN FirestartrTerraformWorkspace/<cr> CREATED: +N ~M -K
 *    (.../<cr>.md)`.
 * 6. Assert nothing was written: plan has +N > 0, artifact path printed, CR
 *    has no conditions, no finalizer, no TFResult, no ConfigMap, and the
 *    tfstate Secrets and lock Leases keep the same resourceVersion (no lock,
 *    no state write).
 * 7. Restart the live operator without the plan flag.
 * 8. Both CRs still reach PROVISIONED=True and their ConfigMaps appear.
 * 9. Restore the original deployment, delete the CRs and the artifacts.
 *
 * Catches the two leaks: Plan mode writing to the CR, and Plan mode writing to
 * the Terraform backend.
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
  return pollUntil(() => client.k8s.readControllerLogs(), {
    timeoutMs,
    intervalMs: 2000,
    isDone: condition,
    createTimeoutError: () =>
      new Error(`Timed out waiting for operator log: ${description}`),
  });
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

describePlanMode('Operator plan mode', () => {
  let client: E2EApi;
  let operatorDeploymentName: string;
  let originalDeployment: ControllerDeployment;
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
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

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

  it(
    'plans every CR without writing status, finalizers, TFResults or infrastructure',
    async () => {
      const backendStateBefore = await client.k8s.readBackendStateVersions();

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
        await client.k8s.deleteStaleTFResult(workspace.crName);

        await client.k8s.applyCr(crPath);
      }

      for (const workspace of workspaces) {
        const crName = workspace.crName!;

        const logs = await waitForOperatorLog(
          client,
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

        const planned = await client.k8s.readWorkspace(crName);

        expect(hasProvisionedCondition(planned)).toBe(false);
        expect(planned.status?.conditions ?? []).toEqual([]);
        expect(planned.metadata?.finalizers ?? []).not.toContain(
          'firestartr.dev/finalizer',
        );

        await expect(
          client.k8s.findTFResultByReference(TF_KIND, crName),
        ).resolves.toBeUndefined();

        expect(await client.k8s.configMapExists(workspace.configMapName)).toBe(
          false,
        );
      }

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
    'provisions every planned CR once Plan mode is off',
    async () => {
      for (const workspace of workspaces) {
        const resource = await client.k8s.waitForCr(
          workspace.crPath!,
          WAIT_FOR_CR_TIMEOUT_SECONDS,
        );

        expect(hasProvisionedCondition(resource)).toBe(true);
        await waitForConfigMap(client, workspace.configMapName);
      }
    },
    PROVISION_TIMEOUT_MS,
  );
});
