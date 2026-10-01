import { App, YamlOutputType } from 'cdk8s';
import * as fs from 'fs';
import common from 'catalog_common';
import * as fastJsonPatch from 'fast-json-patch';
import { configurePathsForRendering, getAffectedWetRepository } from './utils';
import { setPath } from '../config';
import { render } from '../renderer/renderer';
import { emptyRenderedClaims } from '../refresolver';

import { resolveClaimEntries } from '../utils/claimUtils';

import { resetLazyLoader } from '../loader/lazy_loader';

/**
 * @description Type with the affected wet repositories
 */
type AffectedResource = {
  // Changes in the resource with the format of fast-json-patch
  changes: fastJsonPatch.Operation[];

  // The reason why the resource is affected
  reason: 'MODIFIED' | 'DELETED_FROM_PR' | 'ADDED_TO_PR';
};

/**
 * @description Object with the affected wet repositories
 */
type AffectedResources = {
  [key: string]: AffectedResource;
};

const MAIN_BRANCH_OUTPUT_DIR = '/tmp/resources_from_main_branch';
const PR_BRANCH_OUTPUT_DIR = '/tmp/resources_from_pr_branch';

/**
 * @description Get the affected wet repositories by a PR
 * @param claimPathFromMain Path to the claims from the main branch
 * @param claimPathFromPR Path to the claims from the PR branch
 * @param wetRepositoriesConfigPath Path to the wet repositories config
 * */
export async function getAffectedRepositories(
  claimPathFromMain: string,

  claimPathFromPR: string,

  wetRepositoriesConfigPath: string,
): Promise<{
  repos: { [key: string]: string };
  changedResources: AffectedResources;
}> {
  /*
   * We need this folder to exist, so we create it beforehand
   *
   */
  if (!fs.existsSync(MAIN_BRANCH_OUTPUT_DIR)) {
    fs.mkdirSync(MAIN_BRANCH_OUTPUT_DIR);
  }

  // Make this function re-callable: clear state left behind by a previous call
  emptyRenderedClaims();
  resetLazyLoader();

  /**
   * Object with the affected wet repositories
   * This will be returned in order to trigger
   * the pipelines of the affected wet repositories
   */
  const affectedWetRepositories: { [key: string]: string } = {};

  /**
   * Object with the affected resources
   * This will be returned for a summary of the changes,
   * and the user will be able to see the changes in the
   * pipeline logs.
   */
  const affectedResources: AffectedResources = {};

  // Load the wet repositories config
  const wetRepositoriesConfig: any = common.io.fromYaml(
    fs.readFileSync(wetRepositoriesConfigPath, 'utf-8'),
  );

  // Get the providers from the wet repositories config
  const providers = Object.keys(wetRepositoriesConfig.states);

  // Set the claims path to the main branch
  setPath('claims', claimPathFromMain);

  // Configure the renderer
  configurePathsForRendering();

  const mainBranchFirestartrApp = new App({
    outdir: MAIN_BRANCH_OUTPUT_DIR,
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });

  const mainBranchCatalogApp = new App({
    outdir: '/tmp/.catalog',
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });

  // Render the main branch
  const renderFromMainBranch: any = await render(
    mainBranchCatalogApp,
    mainBranchFirestartrApp,
    resolveClaimEntries([claimPathFromMain]),
  );

  mainBranchFirestartrApp.synth();

  emptyRenderedClaims();

  resetLazyLoader();

  // Change the claims path to the PR branch
  setPath('claims', claimPathFromPR);

  const app2 = new App({
    outdir: PR_BRANCH_OUTPUT_DIR,
    outputFileExtension: '.yaml',
    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });
  // Render the PR branch
  const renderFromPRBranch: any = await render(
    new App(),
    app2,
    resolveClaimEntries([claimPathFromPR]),
  );

  app2.synth();

  // Iterate over the resources from the main branch
  for (const key of Object.keys(renderFromMainBranch)) {
    const kind = renderFromMainBranch[key].kind;

    //Check if the resource is present in the PR branch
    if (renderFromPRBranch[key]) {
      //Check if the resources are different
      const compareResult = compareCRs(
        renderFromMainBranch[key],

        renderFromPRBranch[key],
      );

      if (compareResult.changed) {
        const affectedRepo = getAffectedWetRepository(
          providers,
          wetRepositoriesConfig,
          kind,
        );

        console.dir(affectedRepo, { depth: null });

        affectedWetRepositories[affectedRepo.repo] =
          affectedRepo.workflows.notify;

        affectedResources[key] = {
          changes: compareResult.changes,

          reason: 'MODIFIED',
        };
      }
    } else {
      /**
       * If the resource is not present in the PR branch,
       * it means that it has been deleted, so it is affected
       **/
      const affectedRepo = getAffectedWetRepository(
        providers,
        wetRepositoriesConfig,
        kind,
      );

      affectedWetRepositories[affectedRepo.repo] =
        affectedRepo.workflows.notify;

      affectedResources[key] = {
        changes: [],

        reason: 'DELETED_FROM_PR',
      };
    }
  }

  /**
   * Iterate over the resources from the PR branch in
   * case there are resources that are not present in the main branch,
   * that means that they have been added to the PR branch.
   */
  for (const key of Object.keys(renderFromPRBranch)) {
    const kind = renderFromPRBranch[key].kind;

    //Check if the resource is not present in the main branch
    if (!renderFromMainBranch[key]) {
      const affectedRepo = getAffectedWetRepository(
        providers,
        wetRepositoriesConfig,
        kind,
      );

      affectedWetRepositories[affectedRepo.repo] =
        affectedRepo.workflows.notify;

      affectedResources[key] = {
        changes: [],

        reason: 'ADDED_TO_PR',
      };
    }
  }

  return {
    repos: affectedWetRepositories,

    changedResources: affectedResources,
  };
}

/**
 * @description Check if two crs are different
 * @param crV1 First cr
 * @param crV2 Second cr
 * */
function compareCRs(
  crV1: any,
  crV2: any,
): {
  changed: boolean;
  changes: fastJsonPatch.Operation[];
} {
  if (crV1.kind !== crV2.kind) {
    throw new Error(`Kind mismatch on compare: ${crV1.kind} !== ${crV2.kind}`);
  }

  const compareResult = fastJsonPatch.compare(crV1, crV2).filter(
    /**
     * This is a fake render, so we don't want to compare
     * the tfStateKey, because in the claims repo we don't
     * have the previous CRs.
     */
    (op: any) =>
      op.path !== '/spec/firestartr/tfStateKey' &&
      op.path !== '/metadata/name' &&
      op.path !== '/spec/writeConnectionSecretToRef/name' &&
      op.path !== '/metadata/annotations/firestartr.dev~1revision',
  );

  return {
    changed: compareResult.length !== 0,
    changes: compareResult,
  };
}

export function writeWetAffectedRepositoriesFile(
  repos: { [key: string]: string },
  path: string,
) {
  fs.writeFileSync(
    path,

    JSON.stringify(repos, null, 4),
  );
}

export async function runComparer(
  claimPathFromMain: string,
  claimPathFromPR: string,
  claimsDefaultsPath: string,
  wetRepositoriesConfigPath: string,
  pathForAffectedReposFile: string,
) {
  setPath('claimsDefaults', claimsDefaultsPath);

  const result = await getAffectedRepositories(
    claimPathFromMain,

    claimPathFromPR,

    wetRepositoriesConfigPath,
  );

  writeWetAffectedRepositoriesFile(result.repos, pathForAffectedReposFile);
}
