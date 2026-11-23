/**
 * Claim Render Local Org Variables e2e.
 *
 * Goal: org variable section CR provisions GitHub org Actions variables
 * (plain + secretsclaim ref), adopts pre-existing var, ref value follows
 * secret rotation, secret value never in rendered CR.
 *
 * Runs in regular parallel batch (`org-variables-render-apply` suite).
 *
 * Setup: destroys stale fixture CRs and deletes any leftover ref variable
 * from a crashed run.
 *
 * Test 1 (all, selected and adopted variables):
 * 1. Render component-a and disable admin enforcement on its repository (the
 *    verification workflow is committed to main).
 * 2. Apply component-a's CRs; expect its repository to exist.
 * 3. Render orgsettings-vars-a with this run's names for the `all` and
 *    `selected` variables; the selected one is bound to component-a.
 * 4. Apply every CR the claim renders.
 * 5. Wait for the `all` variable; expect visibility `all`.
 * 6. Wait for the `selected` variable; expect visibility `selected` and the
 *    selected repository org/component-a.
 * 7. List org variables; expect both names present.
 * 8. Commit the verification workflow to component-a and dispatch it: the
 *    `all` variable must hold `all-value`.
 * 9. Dispatch it again: the `selected` variable must hold `selected-value`.
 * 10. Create an external variable on GitHub with value `external-value`,
 *     outside the claim.
 * 11. Render orgsettings-vars-a declaring that name with
 *     `adopted-by-firestartr`.
 * 12. Apply every CR the claim renders; the variable is adopted.
 * 13. Dispatch the workflow: the adopted variable must hold
 *     `adopted-by-firestartr`, so the CR value wins.
 * 14. Delete the variable-section CR; poll until all three variables are
 *     absent from GitHub.
 *
 * Test 2 (secretsclaim ref variable):
 * 15. Create a plain Secret holding the value under key `variable_value`;
 *     patch the secret-a SecretsClaim context (name, owner, populated
 *     external secret keys) so the cross-reference check passes without
 *     applying ExternalSecrets.
 * 16. Render orgsettings-vars-a with one `all` variable whose value is
 *     `ref:secretsclaim:<secret>:variable_value`. The variable-section CR must
 *     carry `ref: {kind: Secret, name, key}` and no `value`, and the secret
 *     value must not appear anywhere in the file.
 * 17. Apply the variable-section CR and wait for PROVISIONED.
 * 18. Poll GitHub until the variable holds the initial secret value.
 * 19. Rotate: apply the same Secret name and key with a new value, set
 *     reconcile-at on the CR and re-apply it.
 * 20. Poll GitHub until the variable holds the rotated value.
 * 21. Render with a ref key the SecretsClaim does not populate: the render
 *     must fail with an error naming `actions_variables.<name>`. Nothing is
 *     applied.
 * 22. Delete the variable-section CR; poll until the variable is absent from
 *     GitHub.
 *
 * Teardown: deletes the owning CRs first, then any leftover ref org variable
 * and the temporary Secret, then rendered artifacts. Each step is recorded
 * separately and only warns, so teardown never hides the original failure.
 */

import fs from 'node:fs/promises';
import {
  CleanupRunner,
  applyAndWaitCrPaths,
  cleanupRenderedArtifacts,
  createNameBuilder,
  createTempOpaqueSecret,
  destroyFixtureResources,
  ensureDefaultGroup,
  initE2e,
  type E2EApi,
  type FixtureResourceInput,
  type GhApi,
  type GhOrgVariable,
  type JsonPatchOperation,
  type TempOpaqueSecret,
} from '../..';
import { buildComponentClaimPatches } from '../../src/claim-patches';
import { readK8sResource } from '../../src/cr-finder';
import { pickRenderedCr, setReconcileAt } from '../../src/render-artifacts';
import { isNotFound, type GithubError } from '../../src/gh/errors';
import {
  prepareWorkflowVerification,
  verifyValueViaWorkflow,
} from '../../src/gh/workflow-verification';
import { isRetryableGitHubError } from '../../src/gh/wait';
import { disableRepositoryAdminEnforcementInManifest } from '../../src/repository-admin-enforcement';
import {
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  WAIT_FOR_CR_TIMEOUT_SECONDS,
} from '../../src/test-constants';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
} from '../../src/utils/async-control';

const VERIFY_VARIABLE_WORKFLOW_FILE_NAME = 'verify-org-variable.yaml';
const WORKFLOW_RUN_TIMEOUT_MS = 5 * 60 * 1000;
const ORG_VAR_READ_TIMEOUT_MS = 5 * 60 * 1000;
const ORG_VAR_READ_INTERVAL_MS = 5000;
const ORG_VARS_TEST_TIMEOUT_MS =
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS + 3 * WORKFLOW_RUN_TIMEOUT_MS;
const REF_SECRET_KEY = 'variable_value';
const MISSING_REF_SECRET_KEY = 'missing_variable_key';
const REF_VARIABLE_INITIAL_VALUE = 'ref-variable-initial-value';
const REF_VARIABLE_ROTATED_VALUE = 'ref-variable-rotated-value';

function orgVariablesPatches(options: {
  allVariableName: string;
  selectedVariableName: string;
  componentName: string;
}): JsonPatchOperation[] {
  return [
    {
      op: 'replace',
      path: '/providers/github/actions_variables/0/name',
      value: options.allVariableName,
    },
    {
      op: 'replace',
      path: '/providers/github/actions_variables/1/name',
      value: options.selectedVariableName,
    },
    {
      op: 'replace',
      path: '/providers/github/actions_variables/1/selected_repositories',
      value: [`component:${options.componentName}`],
    },
  ];
}

function refOnlyVariablesPatches(
  variableName: string,
  claimSecretRef: string,
): JsonPatchOperation[] {
  return [
    {
      op: 'replace',
      path: '/providers/github/actions_variables',
      value: [{ name: variableName, value: claimSecretRef, visibility: 'all' }],
    },
  ];
}

function addAdoptVariablePatch(adoptVariableName: string): JsonPatchOperation {
  return {
    op: 'add',
    path: '/providers/github/actions_variables/-',
    value: {
      name: adoptVariableName,
      value: 'adopted-by-firestartr',
      visibility: 'all',
    },
  };
}

async function readOrgVariableIfAvailable(
  gh: GhApi,
  name: string,
): Promise<GhOrgVariable | null> {
  try {
    return await gh.findOrgVariableByName(name);
  } catch (error) {
    if (isNotFound(error as GithubError)) {
      return null;
    }

    if (isRetryableGitHubError(error)) {
      throw createRetryableError(error);
    }

    throw error;
  }
}

async function waitForOrgVariable(
  gh: GhApi,
  name: string,
): Promise<GhOrgVariable> {
  console.log(
    `[waitForOrgVariable] polling for '${name}' (timeout=${ORG_VAR_READ_TIMEOUT_MS}ms)`,
  );
  const variable = await pollUntil(() => readOrgVariableIfAvailable(gh, name), {
    timeoutMs: ORG_VAR_READ_TIMEOUT_MS,
    intervalMs: ORG_VAR_READ_INTERVAL_MS,
    isDone: (value) => value !== null,
    shouldRetryError: isRetryableError,
    createTimeoutError: () =>
      new Error(`Timed out waiting for org variable '${name}' to exist`),
  });

  if (variable === null) {
    throw new Error(`Expected org variable '${name}' to exist`);
  }

  console.log(
    `[waitForOrgVariable] '${name}' found: visibility=${variable.visibility}`,
  );
  return variable;
}

async function waitForOrgVariableAbsence(
  gh: GhApi,
  name: string,
): Promise<void> {
  console.log(`[waitForOrgVariableAbsence] polling for '${name}' removal`);
  await pollUntil(() => readOrgVariableIfAvailable(gh, name), {
    timeoutMs: ORG_VAR_READ_TIMEOUT_MS,
    intervalMs: ORG_VAR_READ_INTERVAL_MS,
    isDone: (value) => value === null,
    shouldRetryError: isRetryableError,
    createTimeoutError: () =>
      new Error(`Timed out waiting for org variable '${name}' to be removed`),
  });
  console.log(`[waitForOrgVariableAbsence] '${name}' confirmed absent`);
}

// Variable values are readable through the API, so the rotation is observed
// directly instead of through a workflow run.
async function waitForOrgVariableValue(
  gh: GhApi,
  name: string,
  expectedValue: string,
): Promise<void> {
  console.log(
    `[waitForOrgVariableValue] polling '${name}' for the expected value (timeout=${ORG_VAR_READ_TIMEOUT_MS}ms)`,
  );
  await pollUntil(() => readOrgVariableIfAvailable(gh, name), {
    timeoutMs: ORG_VAR_READ_TIMEOUT_MS,
    intervalMs: ORG_VAR_READ_INTERVAL_MS,
    isDone: (variable) => variable?.value === expectedValue,
    shouldRetryError: isRetryableError,
    createTimeoutError: (lastVariable) =>
      new Error(
        `Timed out waiting for org variable '${name}' to hold the expected value (last state: ${lastVariable ? 'present' : 'absent'})`,
      ),
  });
  console.log(`[waitForOrgVariableValue] '${name}' holds the expected value`);
}

describe('Claim Render Local Org Variables E2E', () => {
  let client: E2EApi;
  let fixtures: FixtureResourceInput[] = [];
  let componentName = '';
  let defaultGroupName = '';
  let orgSettingsVarsClaimName = '';
  let refVariableName = '';
  let refSecret: TempOpaqueSecret | null = null;

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'org-variables-render-apply',
      onlyFiles: [
        'firestartr',
        'component_a',
        'orgsettings_vars_a',
        'secret_a',
      ],
    });

    const nameBuilder = createNameBuilder(client.getPrefix());
    defaultGroupName = nameBuilder.build('default-group');
    componentName = nameBuilder.build('component-a');
    orgSettingsVarsClaimName = nameBuilder.build('orgsettings-vars-a');
    refVariableName = `${nameBuilder.prefix.replace(/-/g, '_')}_ref`;

    fixtures = [
      { fixtureName: 'firestartr', claimName: defaultGroupName },
      { fixtureName: 'component-a', claimName: componentName },
      {
        fixtureName: 'orgsettings-vars-a',
        claimName: orgSettingsVarsClaimName,
      },
    ];

    await destroyFixtureResources(client, client.getPrefix(), fixtures, {
      logPrefix: 'org-variables-render-apply',
      strict: true,
    });

    // Org variables are not tied to a repository, so a leftover from a
    // crashed run needs explicit deletion.
    await client.gh.deleteOrgVariable(refVariableName);
  }, ORG_VARS_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    const cleanup = new CleanupRunner();

    await cleanup.run('destroy org variables fixture resources', async () => {
      await destroyFixtureResources(client, client.getPrefix(), fixtures, {
        logPrefix: 'org-variables-render-apply-afterall',
        strict: true,
      });
    });

    // The ref test deletes its CR and asserts remote absence; this only fires
    // when that test threw earlier, so the variable cannot outlive the run.
    if (refVariableName) {
      await cleanup.run(`delete ref org variable '${refVariableName}'`, () =>
        client.gh.deleteOrgVariable(refVariableName),
      );
    }

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    if (refSecret) {
      await cleanup.run('dispose ref secret', async () => {
        await refSecret?.dispose();
      });
    }

    cleanup.warnOnErrors('org-variables-render-apply', 'afterAll');
  }, ORG_VARS_TEST_TIMEOUT_MS);

  it(
    'renders and applies org variables with all and selected visibility, adopts an externally-created variable, and cleans up',
    async () => {
      const defaultGroup = await ensureDefaultGroup(client);
      const nameBuilder = createNameBuilder(client.getPrefix());
      const safePrefix = nameBuilder.prefix.replace(/-/g, '_');
      const allVariableName = `${safePrefix}_all`;
      const selectedVariableName = `${safePrefix}_selected`;
      const adoptVariableName = `${safePrefix}_adopt`;

      console.log('[test] STEP 1: render component-a');
      // Provision the component repository first so the org variable section
      // can resolve the selected repository reference to a real repo.
      const renderedComponent = await client.claims.renderLocally(
        'component-a',
        {
          patches: buildComponentClaimPatches({
            name: componentName,
            ownerRef: defaultGroup.ref,
          }),
        },
      );

      // The verification workflow is committed directly to the protected main
      // branch, so this disposable test repository must not enforce admins.
      const repositoryCrPath = await pickRenderedCr(
        renderedComponent.crPaths,
        'FirestartrGithubRepository',
      );
      await disableRepositoryAdminEnforcementInManifest(repositoryCrPath);

      console.log(
        `[test] STEP 2: apply component CRs (${renderedComponent.crPaths.length} CRs)`,
      );
      await applyAndWaitCrPaths(client, renderedComponent.crPaths);
      expect(await client.gh.repoExists(componentName)).toBe(true);

      // The verification workflow is committed once below, before the first
      // value check. Teardown deletes the whole repository, so the file needs
      // no cleanup.
      const org = client.getOrg();

      console.log('[test] STEP 3: render orgsettings-vars-a');
      const renderedVars = await client.claims.renderLocally(
        'orgsettings-vars-a',
        {
          patches: orgVariablesPatches({
            allVariableName,
            selectedVariableName,
            componentName,
          }),
        },
      );

      console.log(
        `[test] STEP 4: apply org variable section CRs (${renderedVars.crPaths.length} CRs)`,
      );
      await applyAndWaitCrPaths(client, renderedVars.crPaths);

      // Scenario 1: variable with 'all' visibility.
      console.log(`[test] STEP 5: wait for org variable '${allVariableName}'`);
      const allVariable = await waitForOrgVariable(client.gh, allVariableName);
      expect(allVariable.visibility).toBe('all');

      // Scenario 2: variable with 'selected' visibility resolves repo refs.
      console.log(
        `[test] STEP 6: wait for org variable '${selectedVariableName}'`,
      );
      const selectedVariable = await waitForOrgVariable(
        client.gh,
        selectedVariableName,
      );
      expect(selectedVariable.visibility).toBe('selected');

      const selectedRepos =
        await client.gh.getOrgVariableSelectedRepositories(
          selectedVariableName,
        );
      expect(selectedRepos).toContain(`${org}/${componentName}`);

      // Scenario 3: multiple variables with mixed visibility.
      console.log('[test] STEP 7: list org variables');
      const variables = await client.gh.listOrgVariables();
      const variableNames = variables.map((v) => v.name);
      const lowerNames = variableNames.map((n) => n.toLowerCase());
      expect(lowerNames).toEqual(
        expect.arrayContaining([
          allVariableName.toLowerCase(),
          selectedVariableName.toLowerCase(),
        ]),
      );

      // Value assertions via in-repo workflow: commit the verification
      // workflow once, then dispatch it once per variable.
      const verification = await prepareWorkflowVerification({
        org,
        repoName: componentName,
        workflowFixtureFileName: VERIFY_VARIABLE_WORKFLOW_FILE_NAME,
      });
      console.log(
        `[test] STEP 8: verify value of '${allVariableName}' via workflow`,
      );
      await verifyValueViaWorkflow(verification, {
        failureLabel: 'Organization variable',
        valueName: allVariableName,
        inputValues: {
          variable_name: allVariableName,
          expected_value: 'all-value',
        },
      });

      console.log(
        `[test] STEP 9: verify value of '${selectedVariableName}' via workflow`,
      );
      await verifyValueViaWorkflow(verification, {
        failureLabel: 'Organization variable',
        valueName: selectedVariableName,
        inputValues: {
          variable_name: selectedVariableName,
          expected_value: 'selected-value',
        },
      });

      // Scenario 4: apply-time adoption — pre-create an external variable, then
      // declare it in the claim with a different value and assert the CR wins.
      // Delete first to handle leftover variables from a previous failed run.
      await client.gh.deleteOrgVariable(adoptVariableName);
      console.log(
        `[test] STEP 10: create external variable '${adoptVariableName}'`,
      );
      await client.gh.createOrgVariable(
        adoptVariableName,
        'external-value',
        'all',
      );
      expect(await client.gh.orgVariableExists(adoptVariableName)).toBe(true);

      console.log('[test] STEP 11: render orgsettings-vars-a with adoption');
      const renderedVarsWithAdoption = await client.claims.renderLocally(
        'orgsettings-vars-a',
        {
          patches: [
            ...orgVariablesPatches({
              allVariableName,
              selectedVariableName,
              componentName,
            }),
            addAdoptVariablePatch(adoptVariableName),
          ],
        },
      );

      const variableSectionCrPath = await pickRenderedCr(
        renderedVarsWithAdoption.crPaths,
        'FirestartrGithubOrganizationVariableSection',
      );

      console.log(
        `[test] STEP 12: apply CRs with adoption (${renderedVarsWithAdoption.crPaths.length} CRs)`,
      );
      await applyAndWaitCrPaths(client, renderedVarsWithAdoption.crPaths);

      console.log('[test] STEP 13: verify adopted variable value via workflow');
      await verifyValueViaWorkflow(verification, {
        failureLabel: 'Organization variable',
        valueName: adoptVariableName,
        inputValues: {
          variable_name: adoptVariableName,
          expected_value: 'adopted-by-firestartr',
        },
      });

      // Scenario 5: cleanup — deleting the variable-section CR removes all
      // variables from the GitHub org.
      console.log(
        '[test] STEP 14: delete variable-section CR and verify cleanup',
      );
      await client.k8s.deleteCr(
        variableSectionCrPath,
        WAIT_FOR_CR_TIMEOUT_SECONDS,
      );

      await waitForOrgVariableAbsence(client.gh, allVariableName);
      await waitForOrgVariableAbsence(client.gh, selectedVariableName);
      await waitForOrgVariableAbsence(client.gh, adoptVariableName);
      console.log('[test] ALL STEPS PASSED');
    },
    ORG_VARS_TEST_TIMEOUT_MS,
  );

  it(
    'provisions an org variable from a secretsclaim ref, follows secret rotation, rejects a missing ref key and cleans up',
    async () => {
      const defaultGroup = await ensureDefaultGroup(client);
      const nameBuilder = createNameBuilder(client.getPrefix());

      console.log(
        '[test] STEP 15: create plain Secret holding the variable value',
      );
      const valueSecret = await createTempOpaqueSecret(client, {
        name: nameBuilder.build('org-var-secret'),
        key: REF_SECRET_KEY,
        value: REF_VARIABLE_INITIAL_VALUE,
      });
      refSecret = valueSecret;
      await valueSecret.apply();

      // The renderer validates secret refs against SecretsClaim metadata. Keep
      // that metadata in the render context without applying ExternalSecrets.
      await client.claims.patchContextFile('secret-a', [
        { op: 'replace', path: '/name', value: valueSecret.name },
        { op: 'remove', path: '/system' },
        { op: 'replace', path: '/owner', value: defaultGroup.ref },
        {
          op: 'replace',
          path: '/providers/external_secrets/externalSecrets/secrets',
          value: Object.keys(valueSecret.values).map((key) => ({
            secretName: key,
            remoteRef: key,
          })),
        },
      ]);

      console.log(
        '[test] STEP 16: render orgsettings-vars-a with a ref variable',
      );
      const renderedRef = await client.claims.renderLocally(
        'orgsettings-vars-a',
        {
          patches: refOnlyVariablesPatches(
            refVariableName,
            valueSecret.claimSecretRefForKey(REF_SECRET_KEY),
          ),
        },
      );
      const refSectionCrPath = await pickRenderedCr(
        renderedRef.crPaths,
        'FirestartrGithubOrganizationVariableSection',
      );
      const refSectionCr = await readK8sResource(refSectionCrPath);
      const refSectionText = await fs.readFile(refSectionCrPath, 'utf-8');
      expect(refSectionText).not.toContain(REF_VARIABLE_INITIAL_VALUE);
      expect(
        (refSectionCr.spec as { actionsVariables: unknown[] }).actionsVariables,
      ).toEqual([
        {
          name: refVariableName,
          visibility: 'all',
          ref: { kind: 'Secret', name: valueSecret.name, key: REF_SECRET_KEY },
        },
      ]);

      console.log('[test] STEP 17: apply variable-section CR');
      await applyAndWaitCrPaths(client, [refSectionCrPath]);

      console.log(
        `[test] STEP 18: wait for '${refVariableName}' to hold the initial secret value`,
      );
      await waitForOrgVariableValue(
        client.gh,
        refVariableName,
        REF_VARIABLE_INITIAL_VALUE,
      );

      console.log(
        '[test] STEP 19: rotate the secret and force a reconciliation',
      );
      const rotatedSecret = await createTempOpaqueSecret(client, {
        name: valueSecret.name,
        key: REF_SECRET_KEY,
        value: REF_VARIABLE_ROTATED_VALUE,
      });
      try {
        await rotatedSecret.apply();
      } finally {
        await rotatedSecret.cleanup();
      }
      await setReconcileAt(refSectionCrPath);
      await client.k8s.applyCr(refSectionCrPath);

      console.log(
        `[test] STEP 20: wait for '${refVariableName}' to hold the rotated secret value`,
      );
      await waitForOrgVariableValue(
        client.gh,
        refVariableName,
        REF_VARIABLE_ROTATED_VALUE,
      );

      console.log('[test] STEP 21: render with a missing ref key');
      await expect(
        client.claims.renderLocally('orgsettings-vars-a', {
          patches: refOnlyVariablesPatches(
            refVariableName,
            `ref:secretsclaim:${valueSecret.name}:${MISSING_REF_SECRET_KEY}`,
          ),
        }),
      ).rejects.toThrow(`actions_variables.${refVariableName}`);

      console.log(
        '[test] STEP 22: delete variable-section CR and verify cleanup',
      );
      await client.k8s.deleteCr(refSectionCrPath, WAIT_FOR_CR_TIMEOUT_SECONDS);
      await waitForOrgVariableAbsence(client.gh, refVariableName);
      console.log('[test] REF STEPS PASSED');
    },
    ORG_VARS_TEST_TIMEOUT_MS,
  );
});
