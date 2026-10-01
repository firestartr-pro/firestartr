import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import github from 'github';
import type { WorkflowCompletionResult } from 'github';
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
import { resolveE2eFixturesPath } from '../../src/fixtures-path';
import { isNotFound, type GithubError } from '../../src/gh/errors';
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
  retryAsync,
} from '../../src/utils/async-control';

const VERIFY_VARIABLE_WORKFLOW_FILE_NAME = 'verify-org-variable.yaml';
const VERIFY_VARIABLE_WORKFLOW_REPO_PATH = `.github/workflows/${VERIFY_VARIABLE_WORKFLOW_FILE_NAME}`;
const WORKFLOW_RUN_TIMEOUT_MS = 5 * 60 * 1000;
const WORKFLOW_RUN_POLL_INTERVAL_MS = 10000;
const ORG_VAR_READ_TIMEOUT_MS = 5 * 60 * 1000;
const ORG_VAR_READ_INTERVAL_MS = 5000;
const GITHUB_WRITE_RETRY_ATTEMPTS = 5;
const GITHUB_WRITE_RETRY_DELAY_MS = 5000;
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

// =============================================================================
// Workflow-based org variable value verification
//
// GitHub never returns an organization variable's value, so exact equality is
// asserted inside a disposable repository: a workflow_dispatch workflow compares
// the provisioned variable with the expected value and the run's conclusion
// becomes the authoritative value assertion. Runs are correlated by a unique id
// surfaced as the run's display_title; the newest run is never assumed to belong
// to this test.
// =============================================================================

type OrgOctokit = Awaited<ReturnType<typeof github.getOctokitForOrg>>;

type WorkflowRunListItem = {
  id: number;
  display_title?: string | null;
};

type WorkflowRunCompletion = Pick<
  WorkflowCompletionResult,
  'conclusion' | 'runId' | 'htmlUrl'
>;

function selectCorrelatedWorkflowRun<Run extends WorkflowRunListItem>(
  runs: Run[],
  correlationId: string,
): Run | null {
  return runs.find((run) => run.display_title === correlationId) ?? null;
}

function assertWorkflowRunSucceeded(
  completion: WorkflowRunCompletion,
  context: { variableName: string; correlationId: string; repoName: string },
): void {
  if (completion.conclusion === 'success') {
    return;
  }

  throw new Error(
    'Organization variable value verification failed for ' +
      `${context.repoName}/${context.variableName} ` +
      `(correlation ${context.correlationId}): workflow run ` +
      `${completion.runId} concluded with ` +
      `'${completion.conclusion ?? 'none'}'. Run URL: ${completion.htmlUrl}`,
  );
}

async function retryTransientGitHubProbe<T>(
  probe: () => Promise<T>,
): Promise<T> {
  try {
    return await probe();
  } catch (error) {
    if (isRetryableGitHubError(error)) {
      throw createRetryableError(error);
    }

    throw error;
  }
}

async function writeVerifyOrgVariableWorkflow(
  repoName: string,
  org: string,
): Promise<void> {
  const fixturePath = path.join(
    resolveE2eFixturesPath(),
    'workflows',
    VERIFY_VARIABLE_WORKFLOW_FILE_NAME,
  );
  const workflowContent = await fs.readFile(fixturePath, 'utf-8');

  await retryAsync(
    () =>
      github.repo.setContent(
        VERIFY_VARIABLE_WORKFLOW_REPO_PATH,
        workflowContent,
        repoName,
        org,
        'main',
        'test: add organization variable verification workflow',
      ),
    {
      attempts: GITHUB_WRITE_RETRY_ATTEMPTS,
      shouldRetry: (error) => isRetryableGitHubError(error),
      getDelayMs: () => GITHUB_WRITE_RETRY_DELAY_MS,
    },
  );
}

async function waitForRegisteredWorkflowId(
  octokit: OrgOctokit,
  org: string,
  repoName: string,
): Promise<number> {
  console.log(
    `[waitForRegisteredWorkflowId] polling for workflow in ${org}/${repoName}`,
  );
  const workflow = await pollUntil(
    () =>
      retryTransientGitHubProbe(async () => {
        const response = await octokit.rest.actions.listRepoWorkflows({
          owner: org,
          repo: repoName,
          per_page: 100,
        });
        const workflows = response.data.workflows as {
          id: number;
          path: string;
        }[];
        return (
          workflows.find(
            (candidate) =>
              candidate.path === VERIFY_VARIABLE_WORKFLOW_REPO_PATH,
          ) ?? null
        );
      }),
    {
      timeoutMs: ORG_VAR_READ_TIMEOUT_MS,
      intervalMs: ORG_VAR_READ_INTERVAL_MS,
      isDone: (value) => value !== null,
      shouldRetryError: isRetryableError,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for ${VERIFY_VARIABLE_WORKFLOW_REPO_PATH} to be discoverable in ${org}/${repoName}`,
        ),
    },
  );

  if (workflow === null) {
    throw new Error(
      `Expected ${VERIFY_VARIABLE_WORKFLOW_REPO_PATH} to be discoverable in ${org}/${repoName}`,
    );
  }

  console.log(
    `[waitForRegisteredWorkflowId] workflow found: id=${workflow.id}`,
  );
  return workflow.id;
}

async function waitForCorrelatedWorkflowRun(
  octokit: OrgOctokit,
  org: string,
  repoName: string,
  workflowId: number,
  correlationId: string,
  timeoutMs: number,
): Promise<WorkflowRunListItem> {
  console.log(
    `[waitForCorrelatedWorkflowRun] polling for run with correlation=${correlationId} (timeout=${Math.round(timeoutMs / 1000)}s)`,
  );
  const run = await pollUntil(
    () =>
      retryTransientGitHubProbe(async () => {
        const response = await octokit.rest.actions.listWorkflowRuns({
          owner: org,
          repo: repoName,
          workflow_id: workflowId,
          per_page: 100,
        });
        return selectCorrelatedWorkflowRun(
          response.data.workflow_runs as WorkflowRunListItem[],
          correlationId,
        );
      }),
    {
      timeoutMs,
      intervalMs: ORG_VAR_READ_INTERVAL_MS,
      isDone: (value) => value !== null,
      shouldRetryError: isRetryableError,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for a ${VERIFY_VARIABLE_WORKFLOW_FILE_NAME} run ` +
            `with display_title '${correlationId}' in ${org}/${repoName}`,
        ),
    },
  );

  if (run === null) {
    throw new Error(
      `Expected a ${VERIFY_VARIABLE_WORKFLOW_FILE_NAME} run with ` +
        `display_title '${correlationId}' in ${org}/${repoName}`,
    );
  }

  console.log(`[waitForCorrelatedWorkflowRun] run found: id=${run.id}`);
  return run;
}

async function verifyOrgVariableValue(options: {
  octokit: OrgOctokit;
  org: string;
  repoName: string;
  workflowId: number;
  variableName: string;
  expectedValue: string;
}): Promise<void> {
  const { octokit, org, repoName, workflowId, variableName, expectedValue } =
    options;
  const correlationId = randomUUID();

  console.log(
    `[verifyOrgVariableValue] triggering workflow for '${variableName}' (correlation=${correlationId})`,
  );
  await github.workflow.triggerWorkflow(
    org,
    repoName,
    workflowId,
    'main',
    {
      variable_name: variableName,
      expected_value: expectedValue,
      correlation_id: correlationId,
    },
    octokit,
  );

  const deadlineMs = Date.now() + WORKFLOW_RUN_TIMEOUT_MS;
  const run = await waitForCorrelatedWorkflowRun(
    octokit,
    org,
    repoName,
    workflowId,
    correlationId,
    Math.max(deadlineMs - Date.now(), 1),
  );
  console.log(
    `[verifyOrgVariableValue] workflow run ${run.id} found, waiting for completion`,
  );
  const completion = await github.workflow.waitForWorkflowCompletion(
    org,
    repoName,
    run.id,
    Math.max(deadlineMs - Date.now(), 1),
    WORKFLOW_RUN_POLL_INTERVAL_MS,
    octokit,
  );

  console.log(
    `[verifyOrgVariableValue] workflow run ${run.id} concluded: ${completion.conclusion}`,
  );
  assertWorkflowRunSucceeded(completion, {
    variableName,
    correlationId,
    repoName,
  });
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

      // Commit the verification workflow once, before the first value check.
      // Teardown deletes the whole repository, so the file needs no cleanup.

      const org = client.getOrg();
      const octokit = await github.getOctokitForOrg(org);

      console.log(
        `[test] STEP 3: write verification workflow to ${componentName}`,
      );
      await writeVerifyOrgVariableWorkflow(componentName, org);
      const workflowId = await waitForRegisteredWorkflowId(
        octokit,
        org,
        componentName,
      );

      console.log('[test] STEP 4: render orgsettings-vars-a');
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
        `[test] STEP 5: apply org variable section CRs (${renderedVars.crPaths.length} CRs)`,
      );
      await applyAndWaitCrPaths(client, renderedVars.crPaths);

      // Scenario 1: variable with 'all' visibility.
      console.log(`[test] STEP 6: wait for org variable '${allVariableName}'`);
      const allVariable = await waitForOrgVariable(client.gh, allVariableName);
      expect(allVariable.visibility).toBe('all');

      // Scenario 2: variable with 'selected' visibility resolves repo refs.
      console.log(
        `[test] STEP 7: wait for org variable '${selectedVariableName}'`,
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
      console.log('[test] STEP 8: list org variables');
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
        `[test] STEP 9: verify value of '${allVariableName}' via workflow`,
      );
      await verifyOrgVariableValue({
        octokit,
        org,
        repoName: componentName,
        workflowId,
        variableName: allVariableName,
        expectedValue: 'all-value',
      });

      console.log(
        `[test] STEP 10: verify value of '${selectedVariableName}' via workflow`,
      );
      await verifyOrgVariableValue({
        octokit,
        org,
        repoName: componentName,
        workflowId,
        variableName: selectedVariableName,
        expectedValue: 'selected-value',
      });

      // Scenario 4: apply-time adoption — pre-create an external variable, then
      // declare it in the claim with a different value and assert the CR wins.
      // Delete first to handle leftover variables from a previous failed run.
      await client.gh.deleteOrgVariable(adoptVariableName);
      console.log(
        `[test] STEP 11: create external variable '${adoptVariableName}'`,
      );
      await client.gh.createOrgVariable(
        adoptVariableName,
        'external-value',
        'all',
      );
      expect(await client.gh.orgVariableExists(adoptVariableName)).toBe(true);

      console.log('[test] STEP 12: render orgsettings-vars-a with adoption');
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
        `[test] STEP 13: apply CRs with adoption (${renderedVarsWithAdoption.crPaths.length} CRs)`,
      );
      await applyAndWaitCrPaths(client, renderedVarsWithAdoption.crPaths);

      console.log('[test] STEP 14: verify adopted variable value via workflow');
      await verifyOrgVariableValue({
        octokit,
        org,
        repoName: componentName,
        workflowId,
        variableName: adoptVariableName,
        expectedValue: 'adopted-by-firestartr',
      });

      // Scenario 5: cleanup — deleting the variable-section CR removes all
      // variables from the GitHub org.
      console.log(
        '[test] STEP 15: delete variable-section CR and verify cleanup',
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
