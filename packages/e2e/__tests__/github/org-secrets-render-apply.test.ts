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
  type GhOrgSecret,
  type GhOrgSecretSection,
  type TempOpaqueSecret,
} from '../..';
import { buildComponentClaimPatches } from '../../src/claim-patches';
import { pickRenderedCr } from '../../src/render-artifacts';
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

const ORG_SECRETS_FIXTURE = 'orgsettings-secrets-a';
const ORG_SECRETS_FIXTURE_FILE = 'orgsettings_secrets_a';
const VERIFY_ORG_SECRET_WORKFLOW_FILE_NAME = 'verify-org-secret.yaml';
const ORG_SECRET_READ_TIMEOUT_MS = 5 * 60 * 1000;
const ORG_SECRET_READ_INTERVAL_MS = 5000;
const WORKFLOW_RUN_TIMEOUT_MS = 5 * 60 * 1000;
const ORG_SECRETS_TEST_TIMEOUT_MS =
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS + 3 * WORKFLOW_RUN_TIMEOUT_MS;

const ACTIONS_ALL_VALUE = 'org-secret-all-value';
const ACTIONS_SELECTED_VALUE = 'org-secret-selected-value';
const ACTIONS_ADOPT_VALUE = 'org-secret-adopted-by-firestartr';
const ACTIONS_ADOPT_EXTERNAL_VALUE = 'org-secret-external-value';
const CODESPACES_VALUE = 'org-secret-codespaces-value';
const DEPENDABOT_VALUE = 'org-secret-dependabot-value';

type OrgSecretNames = {
  actionsAll: string;
  actionsSelected: string;
  actionsAdopt: string;
  codespaces: string;
  dependabot: string;
};

// GitHub org secret names are global to the org and shared by parallel and
// rerun jobs, so every name embeds the test-run prefix.
function buildOrgSecretNames(client: E2EApi): OrgSecretNames {
  const safePrefix = createNameBuilder(client.getPrefix()).prefix.replace(
    /-/g,
    '_',
  );

  return {
    actionsAll: `${safePrefix}_ALL`,
    actionsSelected: `${safePrefix}_SELECTED`,
    actionsAdopt: `${safePrefix}_ADOPT`,
    codespaces: `${safePrefix}_CODESPACES`,
    dependabot: `${safePrefix}_DEPENDABOT`,
  };
}

function buildOrgSecretsMerge(options: {
  names: OrgSecretNames;
  secretRef: (key: string) => string;
  componentName: string;
  domains: Record<GhOrgSecretSection, boolean>;
  adopt: boolean;
}) {
  const actions: Array<Record<string, unknown>> = [
    {
      name: options.names.actionsAll,
      value: options.secretRef('actions_all'),
      visibility: 'all',
    },
    {
      name: options.names.actionsSelected,
      value: options.secretRef('actions_selected'),
      visibility: 'selected',
      selected_repositories: [`component:${options.componentName}`],
    },
  ];

  if (options.adopt) {
    actions.push({
      name: options.names.actionsAdopt,
      value: options.secretRef('actions_adopt'),
      visibility: 'all',
    });
  }

  return {
    providers: {
      github: {
        org_secrets: {
          actions,
          codespaces: options.domains.codespaces
            ? [
                {
                  name: options.names.codespaces,
                  value: options.secretRef('codespaces'),
                  visibility: 'all',
                },
              ]
            : [],
          dependabot: options.domains.dependabot
            ? [
                {
                  name: options.names.dependabot,
                  value: options.secretRef('dependabot'),
                  visibility: 'all',
                },
              ]
            : [],
        },
      },
    },
  };
}

async function readOrgSecret(
  gh: GhApi,
  section: GhOrgSecretSection,
  name: string,
): Promise<GhOrgSecret | null> {
  try {
    return await gh.getOrgSecret(section, name);
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

async function waitForOrgSecret(
  gh: GhApi,
  section: GhOrgSecretSection,
  name: string,
): Promise<GhOrgSecret> {
  console.log(
    `[waitForOrgSecret] polling for ${section} secret '${name}' (timeout=${ORG_SECRET_READ_TIMEOUT_MS}ms)`,
  );
  const secret = await pollUntil(() => readOrgSecret(gh, section, name), {
    timeoutMs: ORG_SECRET_READ_TIMEOUT_MS,
    intervalMs: ORG_SECRET_READ_INTERVAL_MS,
    isDone: (value) => value !== null,
    shouldRetryError: isRetryableError,
    createTimeoutError: () =>
      new Error(
        `Timed out waiting for ${section} org secret '${name}' to exist`,
      ),
  });

  if (secret === null) {
    throw new Error(`Expected ${section} org secret '${name}' to exist`);
  }

  console.log(
    `[waitForOrgSecret] '${name}' found: visibility=${secret.visibility}`,
  );
  return secret;
}

async function waitForOrgSecretAbsence(
  gh: GhApi,
  section: GhOrgSecretSection,
  name: string,
): Promise<void> {
  console.log(`[waitForOrgSecretAbsence] polling for '${name}' removal`);
  await pollUntil(() => readOrgSecret(gh, section, name), {
    timeoutMs: ORG_SECRET_READ_TIMEOUT_MS,
    intervalMs: ORG_SECRET_READ_INTERVAL_MS,
    isDone: (value) => value === null,
    shouldRetryError: isRetryableError,
    createTimeoutError: () =>
      new Error(
        `Timed out waiting for ${section} org secret '${name}' to be removed`,
      ),
  });
  console.log(`[waitForOrgSecretAbsence] '${name}' confirmed absent`);
}

// Single serialized lifecycle: one org-secret section CR owns all declared
// secrets, so create, adoption and deletion are updates to the same resource.
describe('Claim Render Local Org Secrets E2E', () => {
  let client: E2EApi;
  let tempSecret: TempOpaqueSecret | null = null;
  let fixtures: FixtureResourceInput[] = [];
  let componentName = '';
  let defaultGroupName = '';
  let names: OrgSecretNames;
  let domains: Record<GhOrgSecretSection, boolean> = {
    actions: true,
    codespaces: false,
    dependabot: false,
  };

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'org-secrets-render-apply',
      onlyFiles: [
        'firestartr',
        'component_a',
        'secret_a',
        ORG_SECRETS_FIXTURE_FILE,
      ],
    });

    const nameBuilder = createNameBuilder(client.getPrefix());
    defaultGroupName = nameBuilder.build('default-group');
    componentName = nameBuilder.build('component-a');
    names = buildOrgSecretNames(client);

    fixtures = [
      { fixtureName: 'firestartr', claimName: defaultGroupName },
      { fixtureName: 'component-a', claimName: componentName },
      {
        fixtureName: ORG_SECRETS_FIXTURE,
        claimName: nameBuilder.build(ORG_SECRETS_FIXTURE),
      },
    ];

    await destroyFixtureResources(client, client.getPrefix(), fixtures, {
      logPrefix: 'org-secrets-render-apply',
      strict: true,
    });

    // Codespaces and Dependabot org secrets are plan- and permission-gated.
    // Probe once so the suite covers every domain the disposable org supports
    // and skips the rest instead of failing on an environment limit.
    domains = {
      actions: true,
      codespaces: await client.gh.orgSecretSectionAvailable('codespaces'),
      dependabot: await client.gh.orgSecretSectionAvailable('dependabot'),
    };
    console.log(
      `[org-secrets] available domains: ${Object.entries(domains)
        .filter(([, available]) => available)
        .map(([section]) => section)
        .join(', ')}`,
    );

    // destroyFixtureResources only removes cluster CRs, repositories and
    // groups; org secrets left behind by a crashed run need explicit cleanup.
    for (const section of Object.keys(domains) as GhOrgSecretSection[]) {
      if (!domains[section]) continue;
      for (const name of [
        names.actionsAll,
        names.actionsSelected,
        names.actionsAdopt,
        names.codespaces,
        names.dependabot,
      ]) {
        await client.gh.deleteOrgSecret(section, name);
      }
    }
  }, ORG_SECRETS_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    const cleanup = new CleanupRunner();

    // The test deletes the section CR and asserts remote absence; this only
    // fires when it threw earlier.
    if (names) {
      await cleanup.run('delete stale org secrets', async () => {
        for (const section of Object.keys(domains) as GhOrgSecretSection[]) {
          if (!domains[section]) continue;
          for (const name of [
            names.actionsAll,
            names.actionsSelected,
            names.actionsAdopt,
            names.codespaces,
            names.dependabot,
          ]) {
            await client.gh.deleteOrgSecret(section, name);
          }
        }
      });
    }

    if (tempSecret) {
      await cleanup.run('dispose plain org secret values', async () => {
        await tempSecret?.dispose();
      });
    }

    await cleanup.run('destroy org secrets fixture resources', async () => {
      await destroyFixtureResources(client, client.getPrefix(), fixtures, {
        logPrefix: 'org-secrets-render-apply-afterall',
        strict: true,
      });
    });

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    cleanup.warnOnErrors('org-secrets-render-apply', 'afterAll');
  }, ORG_SECRETS_TEST_TIMEOUT_MS);

  it(
    'provisions org secrets across the supported domains, verifies values, adopts a pre-existing secret and cleans up',
    async () => {
      const defaultGroup = await ensureDefaultGroup(client);
      const nameBuilder = createNameBuilder(client.getPrefix());
      const org = client.getOrg();

      console.log('[test] STEP 1: render and apply component-a');
      // The selected-visibility secret and the value-verification workflow both
      // need this disposable repository to exist first.
      const renderedComponent = await client.claims.renderLocally(
        'component-a',
        {
          patches: buildComponentClaimPatches({
            name: componentName,
            ownerRef: defaultGroup.ref,
          }),
        },
      );

      const repositoryCrPath = await pickRenderedCr(
        renderedComponent.crPaths,
        'FirestartrGithubRepository',
      );
      await disableRepositoryAdminEnforcementInManifest(repositoryCrPath);
      await applyAndWaitCrPaths(client, renderedComponent.crPaths);
      expect(await client.gh.repoExists(componentName)).toBe(true);

      console.log('[test] STEP 2: create plain Secret holding the values');
      tempSecret = await createTempOpaqueSecret(client, {
        name: nameBuilder.build('org-secret-values'),
        key: 'actions_all',
        value: ACTIONS_ALL_VALUE,
        extraValues: {
          actions_selected: ACTIONS_SELECTED_VALUE,
          actions_adopt: ACTIONS_ADOPT_VALUE,
          codespaces: CODESPACES_VALUE,
          dependabot: DEPENDABOT_VALUE,
        },
      });
      await tempSecret.apply();

      // The renderer validates secret refs against SecretsClaim metadata. Keep
      // that metadata in the render context without applying ExternalSecrets.
      await client.claims.patchContextFile('secret-a', [
        { op: 'replace', path: '/name', value: tempSecret.name },
        { op: 'remove', path: '/system' },
        { op: 'replace', path: '/owner', value: defaultGroup.ref },
        {
          op: 'replace',
          path: '/providers/external_secrets/externalSecrets/secrets',
          value: Object.keys(tempSecret.values).map((key) => ({
            secretName: key,
            remoteRef: key,
          })),
        },
      ]);

      console.log('[test] STEP 3: render orgsettings-secrets-a');
      // Only the section CR is applied: the claim also renders the org-settings
      // singleton shared with the org-settings and org-variables suites, and
      // this suite must not fight over it in the parallel regular batch.
      const rendered = await client.claims.renderLocally(ORG_SECRETS_FIXTURE, {
        merge: buildOrgSecretsMerge({
          names,
          secretRef: (key) => tempSecret!.claimSecretRefForKey(key),
          componentName,
          domains,
          adopt: false,
        }),
      });
      const sectionCrPath = await pickRenderedCr(
        rendered.crPaths,
        'FirestartrGithubOrganizationSecretSection',
      );

      console.log('[test] STEP 4: apply org-secret section CR');
      await client.k8s.applyCr(sectionCrPath);
      await client.k8s.waitForCr(sectionCrPath, WAIT_FOR_CR_TIMEOUT_SECONDS);

      // Scenario 1: secret with 'all' visibility.
      console.log(
        `[test] STEP 5: wait for actions secret '${names.actionsAll}'`,
      );
      const allSecret = await waitForOrgSecret(
        client.gh,
        'actions',
        names.actionsAll,
      );
      expect(allSecret.visibility).toBe('all');

      // Scenario 2: secret with 'selected' visibility resolves repo refs.
      console.log(
        `[test] STEP 6: wait for actions secret '${names.actionsSelected}'`,
      );
      const selectedSecret = await waitForOrgSecret(
        client.gh,
        'actions',
        names.actionsSelected,
      );
      expect(selectedSecret.visibility).toBe('selected');
      expect(
        await client.gh.getOrgSecretSelectedRepositories(
          'actions',
          names.actionsSelected,
        ),
      ).toContain(`${org}/${componentName}`);

      // Scenario 3: more than one secret across the supported domains.
      if (domains.codespaces) {
        const codespacesSecret = await waitForOrgSecret(
          client.gh,
          'codespaces',
          names.codespaces,
        );
        expect(codespacesSecret.visibility).toBe('all');
      }

      if (domains.dependabot) {
        const dependabotSecret = await waitForOrgSecret(
          client.gh,
          'dependabot',
          names.dependabot,
        );
        expect(dependabotSecret.visibility).toBe('all');
      }

      // Value assertions via an in-repo workflow: only Actions org secrets are
      // readable as `secrets.*`, so Codespaces and Dependabot stay
      // existence-and-visibility assertions above.
      const verification = await prepareWorkflowVerification({
        org,
        repoName: componentName,
        workflowFixtureFileName: VERIFY_ORG_SECRET_WORKFLOW_FILE_NAME,
      });
      console.log('[test] STEP 7: verify value of the all secret via workflow');
      await verifyValueViaWorkflow(verification, {
        failureLabel: 'Organization secret',
        valueName: names.actionsAll,
        inputValues: {
          secret_name: names.actionsAll,
          expected_value: ACTIONS_ALL_VALUE,
        },
      });

      console.log(
        '[test] STEP 8: verify value of the selected secret via workflow',
      );
      await verifyValueViaWorkflow(verification, {
        failureLabel: 'Organization secret',
        valueName: names.actionsSelected,
        inputValues: {
          secret_name: names.actionsSelected,
          expected_value: ACTIONS_SELECTED_VALUE,
        },
      });

      // Scenario 4: apply-time adoption. Pre-create the secret on GitHub with
      // an external value, then declare it in the claim; the CR value must win.
      await client.gh.deleteOrgSecret('actions', names.actionsAdopt);
      console.log(
        `[test] STEP 9: create external secret '${names.actionsAdopt}'`,
      );
      await client.gh.createOrgSecret(
        'actions',
        names.actionsAdopt,
        ACTIONS_ADOPT_EXTERNAL_VALUE,
        'all',
      );
      expect(
        await client.gh.getOrgSecret('actions', names.actionsAdopt),
      ).not.toBeNull();

      console.log('[test] STEP 10: render orgsettings-secrets-a with adoption');
      const renderedWithAdoption = await client.claims.renderLocally(
        ORG_SECRETS_FIXTURE,
        {
          merge: buildOrgSecretsMerge({
            names,
            secretRef: (key) => tempSecret!.claimSecretRefForKey(key),
            componentName,
            domains,
            adopt: true,
          }),
        },
      );
      const adoptedSectionCrPath = await pickRenderedCr(
        renderedWithAdoption.crPaths,
        'FirestartrGithubOrganizationSecretSection',
      );

      console.log('[test] STEP 11: apply CR with adoption and verify value');
      await client.k8s.applyCr(adoptedSectionCrPath);
      await client.k8s.waitForCr(
        adoptedSectionCrPath,
        WAIT_FOR_CR_TIMEOUT_SECONDS,
      );
      await verifyValueViaWorkflow(verification, {
        failureLabel: 'Organization secret',
        valueName: names.actionsAdopt,
        inputValues: {
          secret_name: names.actionsAdopt,
          expected_value: ACTIONS_ADOPT_VALUE,
        },
      });

      // Scenario 5: cleanup — deleting the section CR removes every declared
      // secret from the GitHub org.
      console.log(
        '[test] STEP 12: delete section CR and verify org-secret cleanup',
      );
      await client.k8s.deleteCr(
        adoptedSectionCrPath,
        WAIT_FOR_CR_TIMEOUT_SECONDS,
      );

      await waitForOrgSecretAbsence(client.gh, 'actions', names.actionsAll);
      await waitForOrgSecretAbsence(
        client.gh,
        'actions',
        names.actionsSelected,
      );
      await waitForOrgSecretAbsence(client.gh, 'actions', names.actionsAdopt);

      if (domains.codespaces) {
        await waitForOrgSecretAbsence(
          client.gh,
          'codespaces',
          names.codespaces,
        );
      }

      if (domains.dependabot) {
        await waitForOrgSecretAbsence(
          client.gh,
          'dependabot',
          names.dependabot,
        );
      }

      console.log('[test] ALL STEPS PASSED');
    },
    ORG_SECRETS_TEST_TIMEOUT_MS,
  );
});
