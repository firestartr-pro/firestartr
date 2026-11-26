import {
  CleanupRunner,
  cleanupRenderedArtifacts,
  createNameBuilder,
  destroyFixtureResources,
  ensureDefaultGroup,
  initE2e,
  waitForOrgRulesetState,
  type E2EApi,
} from '../..';
import {
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  WAIT_FOR_CR_TIMEOUT_SECONDS,
} from '../../src/test-constants';

const ORG_RULESET_FIXTURE = 'orgruleset-a';

// Org ruleset lifecycle against the real operator and GitHub:
// 1. Init the e2e client with only the default group fixture loaded, and build
//    the ruleset name from the run prefix (claim name == GitHub ruleset name).
// 2. Pre-clean: delete any stale CR and GitHub ruleset with that name.
// 3. Ensure the default group exists and use it as the claim owner.
// 4. Render orgruleset-a with patches: owner = default group, /system removed,
//    repository_name.include scoped to '<name>-*' (matches no repo, so the
//    active ruleset cannot touch other suites' repositories), and
//    bypass_actors emptied (the fixture's team need not exist in the org).
// 5. Apply the rendered FirestartrGithubOrgRuleset CR and wait until the
//    operator reports it healthy.
// 6. Wait until the ruleset exists in GitHub, then read it back and assert
//    name, target=branch, enforcement=active, the deletion and pull_request
//    rule types and the scoped repository include.
// 7. Delete the CR (waits for the finalizer / terraform destroy), then wait
//    until the ruleset is gone from GitHub.
// afterAll: delete the CR if the test threw before step 7, delete the GitHub
// ruleset by name and clean the rendered artifacts; every step runs even if
// an earlier one fails.
describe('Claim Render Local Org Ruleset E2E', () => {
  let client: E2EApi;
  let rulesetName = '';
  let crPath = '';

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'org-ruleset-render-apply',
      onlyFiles: ['firestartr'],
    });

    // The claim name is also the GitHub ruleset name (see buildCommonClaimPatches),
    // so cleanup can target the remote object by the same name.
    rulesetName = createNameBuilder(client.getPrefix()).build(
      ORG_RULESET_FIXTURE,
    );

    await destroyFixtureResources(
      client,
      client.getPrefix(),
      [ORG_RULESET_FIXTURE],
      {
        logPrefix: 'org-ruleset-render-apply',
        orgRulesetNames: [rulesetName],
        strict: true,
      },
    );
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    const cleanup = new CleanupRunner();

    // The test deletes the CR on success; this only fires if it threw earlier.
    if (crPath) {
      await cleanup.run('delete org ruleset CR', async () => {
        await client.k8s.deleteCr(crPath, WAIT_FOR_CR_TIMEOUT_SECONDS);
      });
    }

    await cleanup.run('destroy org ruleset fixture resources', async () => {
      await destroyFixtureResources(
        client,
        client.getPrefix(),
        [ORG_RULESET_FIXTURE],
        {
          logPrefix: 'org-ruleset-render-apply-afterall',
          orgRulesetNames: rulesetName ? [rulesetName] : [],
          strict: true,
        },
      );
    });

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    cleanup.warnOnErrors('org-ruleset-render-apply', 'afterAll');
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'should render, create, and delete an org ruleset',
    async () => {
      const defaultGroup = await ensureDefaultGroup(client);

      // org, claim name and provider name are auto-patched from the claim
      // taxonomy; the rest is runtime-owned or must not depend on the org.
      const rendered = await client.claims.renderLocally(ORG_RULESET_FIXTURE, {
        patches: [
          { op: 'replace', path: '/owner', value: defaultGroup.ref },
          { op: 'remove', path: '/system' },
          {
            op: 'replace',
            path: '/providers/github/conditions/repository_name',
            value: { include: [`${rulesetName}-*`], exclude: [] },
          },
          {
            op: 'replace',
            path: '/providers/github/bypass_actors',
            value: [],
          },
        ],
      });

      const primaryCrPath = rendered.crPaths[0];
      if (!primaryCrPath) {
        throw new Error('No rendered CR path found for orgruleset-a claim');
      }
      crPath = primaryCrPath;

      // Create: apply and wait for the operator to reconcile the ruleset.
      await client.k8s.applyCr(crPath);
      const result = await client.k8s.waitForCr(
        crPath,
        WAIT_FOR_CR_TIMEOUT_SECONDS,
      );
      expect(result).toBeDefined();

      // Confirm reconciliation created the ruleset in GitHub with the claim's
      // configuration.
      await waitForOrgRulesetState(client, rulesetName, true);

      const ruleset = await client.gh.findOrgRulesetByName(rulesetName);
      expect(ruleset).not.toBeNull();
      expect(ruleset?.name).toBe(rulesetName);
      expect(ruleset?.target).toBe('branch');
      expect(ruleset?.enforcement).toBe('active');
      expect(ruleset?.ruleTypes).toEqual(
        expect.arrayContaining(['deletion', 'pull_request']),
      );
      expect(ruleset?.repositoryNameInclude).toEqual([`${rulesetName}-*`]);

      // Delete: the CR finalizer destroys the provider-owned ruleset too.
      await client.k8s.deleteCr(crPath, WAIT_FOR_CR_TIMEOUT_SECONDS);
      crPath = '';
      await waitForOrgRulesetState(client, rulesetName, false);
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );
});
