export { GlobalSection } from './src/globals/base';
export { BranchStrategiesInitializer } from './src/initializers/branchStrategies';
export { UUIDInitializer } from './src/initializers/uuid';
export { ImportInitializer } from './src/initializers/import';
export { NeedsReImportInitializer } from './src/initializers/needs_re_import';
export { NameNormalizer } from './src/normalizers/name';
export { GlobalDefault } from './src/defaults/global';
export { InitializerDefault } from './src/defaults/initializer';
export { InitializerClaimRef } from './src/initializers/claimRef';
export { GithubRepositoryOverrider } from './src/overriders/githubRepositoryOverride';
export { InitializerPatches as Initializer } from './src/initializers/base';
export { resolveCodeownersRef } from './src/utils/repositoryClaimUtils';
export { setRenderedClaim, emptyRenderedClaims } from './src/refresolver';
import { runComparer } from './src/comparer';
import {
  AllowedProviders,
  configureProvider,
  setDefaultBranch,
  setExcludedPaths,
  setPath,
  setRenamesEnabled,
  setRepositoryUrl,
} from './src/config';
import { INITIALIZERS, INITIALIZERS_BY_FILE_NAME } from './src/initializers';
import { render } from './src/renderer/renderer';
import { App, YamlOutputType } from 'cdk8s';
export {
  AllowedProviders,
  configureProvider,
  setDefaultBranch,
  setRepositoryUrl,
} from './src/config';
export { generateClaimsMap } from './src/utils/claimUtils';
import { isCatalogEntity } from './src/validations/references';
import { NORMALIZERS, normalizeModuleContent } from './src/normalizers';
import { loadCRs } from './src/loader/loader';
import { renderTfWorkspace } from './src/claims/tfworkspaces/renderer';
import { validatek8sLimits } from './src/normalizers/tfworkspace';
import { renderFromImports } from './src/renderer/import-renderer';
import { addLastStateAndLastClaimAnnotations } from './src/renderer/last-state-pr';
import { renameVariantCrFiles } from './src/renderer/claims-render';
import {
  claimsRefListAsGenerator,
  resolveClaimEntries,
  getClaimsEntryAbsolutePath,
} from './src/utils/claimUtils';

export type { RenderClaims } from './src/renderer/types';

export default {
  renderFromImports,

  render,

  setPath,

  INITIALIZERS,

  INITIALIZERS_BY_FILE_NAME,

  NORMALIZERS,

  AllowedProviders,

  setRepositoryUrl,

  setDefaultBranch,

  runComparer,

  isCatalogEntity,

  loadCRs,

  renderTfWorkspace,

  normalizeModuleContent,

  validatek8sLimits,

  addLastStateAndLastClaimAnnotations,
};

/*
 * Main function of the module. Renders claim files into custom resources,
 * and uploads them to a Kubernetes cluster.
 *
 * Input:
 * - globalsPath: string, absolute path to the global files folder
 * - initializersPath: string, absolute path to the initializers files folder
 * - claimsPath: string, absolute path to the claims files folder
 * - crsPath: string, absolute path to the crs files folder
 * - outputDir: string, absolute path to the output folder where the rendered
 *   custom resource files will be put
 *
 * This function returns nothing.
 *
 */
export async function runRenderer(
  globalsPath: string,
  initializersPath: string,
  claimsPath: string,
  crsPath: string,
  claimsDefaults: string,
  outputCatalogDir: string,
  outputCrDir: string,
  renamesEnabled: boolean,
  provider: AllowedProviders,
  excludedPaths: string[] = [],
  validateReferentialIntegrity: string,
  claimRefs = '',
  claimFilesList = '',
  repositoryUrl?: string,
  defaultBranch?: string,
) {
  configureProvider(provider);
  setPath('initializers', initializersPath);
  setPath('crs', crsPath);
  setPath('globals', globalsPath);
  setPath('claims', claimsPath);
  setPath('claimsDefaults', claimsDefaults);
  setRenamesEnabled(renamesEnabled);
  setExcludedPaths(excludedPaths);

  if (!repositoryUrl) {
    const org = process.env['ORG'];
    if (org) {
      repositoryUrl = `https://github.com/${org}/claims`;
    }
  }
  setRepositoryUrl(repositoryUrl);
  setDefaultBranch(defaultBranch ?? 'main');

  const catalogApp = new App({
    outdir: outputCatalogDir,

    outputFileExtension: '.yaml',

    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });

  const firestartrApp = new App({
    outdir: outputCrDir,

    outputFileExtension: '.yaml',

    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });

  let claimRefsList: any = null;
  if (claimRefs) {
    claimRefsList = await claimsRefListAsGenerator(
      claimRefs.replace(/\s/g, '').split(','),
    );
  } else if (claimFilesList) {
    const claimFilesListPaths = claimFilesList
      .replace(/\s/g, '')
      .split(',')
      .map((entryPath: string) =>
        getClaimsEntryAbsolutePath(claimsPath, entryPath),
      );

    claimRefsList = await resolveClaimEntries(claimFilesListPaths);
  } else {
    // in case nothing is passed
    // the system takes everything defined in the claims path
    claimRefsList = await resolveClaimEntries([claimsPath]);
  }

  let renderedMap;
  try {
    renderedMap = await render(
      catalogApp,

      firestartrApp,

      claimRefsList,
    );
  } catch (error) {
    console.log(`Rendering the system: \n ${error}`);

    process.exit(1);
  }

  catalogApp.synth();

  firestartrApp.synth();

  renameVariantCrFiles(outputCrDir, renderedMap);
}
