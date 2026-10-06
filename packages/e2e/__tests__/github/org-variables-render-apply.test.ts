import fs from 'node:fs/promises';
import {
  CleanupRunner,
  applyAndWaitCrPaths,
  cleanupRenderedArtifacts,
  createNameBuilder,
  destroyFixtureResources,
  ensureDefaultGroup,
  initE2e,
  type E2EApi,
  type FixtureResourceInput,
  type GhApi,
  type GhOrgVariable,
  type JsonPatchOperation,
} from '../..';
import { readK8sResource } from '../../src/cr-finder';
import { isNotFound, type GithubError } from '../../src/gh/errors';
import { verifyValueViaWorkflow } from '../../src/gh/workflow-verification';
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

function componentPatches(ownerRef: string): JsonPatchOperation[] {
  return [
    { op: 'remove', path: '/system' },
    { op: 'replace', path: '/owner', value: ownerRef },
    { op: 'replace', path: '/platformOwner', value: ownerRef },
    { op: 'remove', path: '/maintainedBy' },
    { op: 'replace', path: '/providers/github/additionalRules', value: [] },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalAdmins',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalMaintainers',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalReaders',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalWriters',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalCodeownersRules',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/spec/actions/oidc/useDefault',
      value: true,
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/spec/actions/oidc/includeClaimKeys',
      value: [],
    },
  ];
}

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

async function findVariableSectionCrPath(crPaths: string[]): Promise<string> {
  for (const crPath of crPaths) {
    const resource = await readK8sResource(crPath);
    if (resource.kind === 'FirestartrGithubOrganizationVariableSection') {
      return crPath;
    }
  }

  throw new Error(
    'Expected rendered claim to include a FirestartrGithubOrganizationVariableSection CR',
  );
}

async function findRepositoryCrPath(crPaths: string[]): Promise<string> {
  for (const crPath of crPaths) {
    const resource = await readK8sResource(crPath);
    if (resource.kind === 'FirestartrGithubRepository') {
      return crPath;
    }
  }

  throw new Error(
    'Expected rendered component to include a FirestartrGithubRepository CR',
  );
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

describe('Claim Render Local Org Variables E2E', () => {
  let client: E2EApi;
  let fixtures: FixtureResourceInput[] = [];
  let componentName = '';
  let defaultGroupName = '';
  let orgSettingsVarsClaimName = '';

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'org-variables-render-apply',
      onlyFiles: ['firestartr', 'component_a', 'orgsettings_vars_a'],
    });

    const nameBuilder = createNameBuilder(client.getPrefix());
    defaultGroupName = nameBuilder.build('default-group');
    componentName = nameBuilder.build('component-a');
    orgSettingsVarsClaimName = nameBuilder.build('orgsettings-vars-a');

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

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

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
          patches: componentPatches(defaultGroup.ref),
        },
      );

      // The verification workflow is committed directly to the protected main
      // branch, so this disposable test repository must not enforce admins.
      const repositoryCrPath = await findRepositoryCrPath(
        renderedComponent.crPaths,
      );
      await disableRepositoryAdminEnforcementInManifest(repositoryCrPath);

      console.log(
        `[test] STEP 2: apply component CRs (${renderedComponent.crPaths.length} CRs)`,
      );
      await applyAndWaitCrPaths(client, renderedComponent.crPaths);
      expect(await client.gh.repoExists(componentName)).toBe(true);

      // The shared helper commits the verification workflow, dispatches it
      // exactly once and correlates the run by display_title. Teardown deletes
      // the whole repository, so the file needs no cleanup.
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

      // Value assertions via in-repo workflow.
      console.log(
        `[test] STEP 8: verify value of '${allVariableName}' via workflow`,
      );
      await verifyValueViaWorkflow({
        org,
        repoName: componentName,
        workflowFixtureFileName: VERIFY_VARIABLE_WORKFLOW_FILE_NAME,
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
      await verifyValueViaWorkflow({
        org,
        repoName: componentName,
        workflowFixtureFileName: VERIFY_VARIABLE_WORKFLOW_FILE_NAME,
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

      const variableSectionCrPath = await findVariableSectionCrPath(
        renderedVarsWithAdoption.crPaths,
      );

      console.log(
        `[test] STEP 12: apply CRs with adoption (${renderedVarsWithAdoption.crPaths.length} CRs)`,
      );
      await applyAndWaitCrPaths(client, renderedVarsWithAdoption.crPaths);

      console.log('[test] STEP 13: verify adopted variable value via workflow');
      await verifyValueViaWorkflow({
        org,
        repoName: componentName,
        workflowFixtureFileName: VERIFY_VARIABLE_WORKFLOW_FILE_NAME,
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
});
