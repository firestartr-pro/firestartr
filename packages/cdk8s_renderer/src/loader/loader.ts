import { crawl, crawlWithExclusions } from '../crawler';
import { SECTIONS_BY_FILE_NAME, SCHEMAS_BY_SECTION_NAME } from '../globals';
import common from 'catalog_common';
import * as path from 'path';
import {
  INITIALIZERS,
  INITIALIZERS_BY_FILE_NAME,
  SCHEMAS_BY_INITIALIZER_NAME,
} from '../initializers';
import { InitializerPatches } from '../initializers/base';
import { GlobalSection } from '../globals/base';
import {
  getAdditionalPaths,
  getConfiguredProvider,
  getPath,
  getRenamesEnabled,
} from '../config';
import { OverriderPatches } from '../overriders/base';
import { GithubRepositoryOverrider } from '../overriders/githubRepositoryOverride';
import * as fs from 'fs';
import * as fastJsonPatch from 'fast-json-patch';
import fjp from 'fast-json-patch';
import { FirestartrAllClaim, IVirtualClaim } from '../claims/virtual';
import { IClaim } from '../claims/base';
import { UUIDInitializer } from '../initializers/uuid';
import { ClaimValidation } from '../claims';
import claims from '../claims/base';
import { stripKnownRelations } from '../utils/crUtils';
import { Normalizer } from '../normalizers/base';
import { NORMALIZERS } from '../normalizers';
import { NameNormalizer } from '../normalizers/name';
import { InitializerClaimRef } from '../initializers/claimRef';
import { InitializerDefault } from '../defaults/initializer';
import {
  RenderClaimData,
  RenderClaimKey,
  RenderClaims,
} from '../renderer/types';
import { loadClaim } from './lazy_loader';
import _ from 'lodash';

import { applyBlockAwareDefaults } from './claimsDefaulter';

import log from '../logger';

export const isYamlFile = new RegExp(/\.(yaml|yml)$/);

/**
 *
 * @returns Virtual Claims
 */

const virtualClaims: IVirtualClaim[] = [new FirestartrAllClaim()];

/*
 * Loads all applicable globals for a given claim and stores them into a list.
 *
 * Input:
 * - claim: our custom claim object, with which we check if the global is applicable
 *
 * Returns:
 * - A GlobalSection array promise, containing all the globals loaded for this claim
 *
 */
export async function loadGlobals(claim: any): Promise<GlobalSection[]> {
  const result: GlobalSection[] = [];

  await crawl(
    getPath('globals'),

    (entry: string) => {
      return isYamlFile.test(entry);
    },

    async (entry: string, data: any) => {
      const globalData: any = common.io.fromYaml(data);

      const ext: string = path.extname(entry);

      const name: string = path.basename(entry, ext);

      if (name in SECTIONS_BY_FILE_NAME) {
        const section: any = new SECTIONS_BY_FILE_NAME[name](globalData);

        if (!(await section.validate(SCHEMAS_BY_SECTION_NAME[name] || {}))) {
          throw new Error(`Invalid ${name} global file`);
        }

        if (globalData.kind === claim.kind) {
          result.push(section);
        } else {
          log.debug(
            `Skipping global ${name} because it is not applicable to ${claim.kind}`,
          );
        }
      }
    },
  );

  log.info(`Loaded globals ${result}`);

  return result;
}

/*
 * If the input claim is a GithubRepositoryClaim, it loads all it's applicable
 * overrides and stores them into a list. Otherwise, it returns an empty list.
 *
 * Input:
 * - claim: our custom claim object, which should be a GithubRepositoryClaim
 *
 * Returns:
 * - An Overrider array, with a GithubRepositoryOverrider if the claim
 *   was a GithubRepositoryClaim, or empty if it was not.
 *
 */
export function loadOverrides(claim: any): OverriderPatches[] {
  const overrides: OverriderPatches[] = [];

  if (claim.kind === 'ComponentClaim' && claim.providers.github.overrides) {
    overrides.push(new GithubRepositoryOverrider());
  }

  return overrides;
}

/**
 * Load all normalizers and stores them into a list.
 * @param claim
 * @returns
 */
export async function loadNormalizers(
  _claim: any,
  path?: string,
): Promise<Normalizer[]> {
  const result: Normalizer[] = [];

  for (const normalizer of NORMALIZERS) {
    result.push(new normalizer({ path: path }));
  }

  return result;
}

/*
 * Loads all applicable initializers for a given claim and stores them into a list.
 *
 * Input:
 * - claim: our custom claim object, with which we check if the initializer is applicable
 *
 * Returns:
 * - An Initializer array promise, containing all the initializers loaded for this claim
 *
 */

let loadedInitializers: InitializerPatches[] | false = false;

export async function loadInitializers(
  claim: any,
  claimPath?: string,
  initializersPath: string = getPath('initializers'),
): Promise<InitializerPatches[]> {
  const result: InitializerPatches[] = [];

  await crawl(
    initializersPath,

    (entry: string) => {
      return isYamlFile.test(entry);
    },

    async (entry: string, data: any) => {
      const initializerData: any = common.io.fromYaml(data);

      const ext: string = path.extname(entry);

      const name: string = path.basename(entry, ext);

      if (name in INITIALIZERS_BY_FILE_NAME) {
        const initializerBfN: any = new INITIALIZERS_BY_FILE_NAME[name](
          initializerData,
        );

        if (
          !(await initializerBfN.validate(
            SCHEMAS_BY_INITIALIZER_NAME[name] || {},
          ))
        ) {
          throw new Error(`Invalid ${name} initializer file`);
        }

        if (initializerData.kind === claim.kind) {
          result.push(initializerBfN);
        } else {
          log.debug(
            `Skipping initializer ${name} because it is not applicable to ${claim.kind}`,
          );
        }
      }
    },
  );

  for (const initializer of INITIALIZERS) {
    if (initializer.applicableKinds.includes(claim.kind)) {
      result.push(new initializer({ path: claimPath }));
    }
  }

  log.info(`Loaded initializers ${JSON.stringify(result)}`);

  loadedInitializers = result;

  return loadedInitializers;
}

export function loadClaimDefaults() {
  try {
    return common.io.fromYaml(
      fs.readFileSync(
        `${getPath('claimsDefaults')}/claims_defaults.yaml`,
        'utf-8',
      ),
    );
  } catch (error) {
    const errMsg = `Could not read claims defaults file in path ${getPath('claimsDefaults')}/claims_defaults.yaml: ${error}`;
    log.error(errMsg);
    throw new Error(errMsg);
  }
}

/*
 * Using fast-json-patch, compares a claim to its kind's defaults, then patches it.
 *
 * Input:
 * - claim: our custom claim object, which we want to patch
 * - defaultsClaims: an object, containing the defaults for each claim kind,
 *   with the same structure that we use for the actual claims
 *
 * Returns:
 * - The patched claim
 *
 */
export function patchClaim(claim: any, defaultsClaims: any) {
  if (defaultsClaims[claim.kind]) {
    claim = applyBlockAwareDefaults(claim, defaultsClaims[claim.kind]);
  }
  return claim;
}

/*
 * Loads CRs from disk and returns two views of the same crawl result.
 *
 * The `crs` view keeps only CRs whose claim-ref is in `allowedClaimReferences`.
 * Renderers use it to find previous CRs for the claims currently being rendered.
 *
 * The `fullCrs` view keeps every valid CR found under `crsPath`, before the
 * claim-ref filter is applied. Final render-time validations use it when an
 * invariant must consider existing resources outside the current claim subset.
 */
export interface LoadedCrsWithFullSet {
  crs: any;
  fullCrs: any;
}

export async function loadCRsWithFullSet(
  crsPath: string = getPath('crs'),
  excludedPaths: string[] = [getPath('globals'), getPath('initializers')],
  allowedClaimReferences: string[] = [],
): Promise<LoadedCrsWithFullSet> {
  const result: any = {};
  const fullResult: any = {};

  await crawlWithExclusions(
    crsPath,
    (entry: string) => {
      return isYamlFile.test(entry);
    },
    async (entry: string, data: any) => {
      const yamlData: any = stripKnownRelations(common.io.fromYaml(data));

      const metadata = yamlData?.metadata;

      if (
        !(
          yamlData &&
          typeof yamlData === 'object' &&
          'kind' in yamlData &&
          metadata &&
          typeof metadata === 'object' &&
          'name' in metadata
        )
      ) {
        log.warn(`Invalid CR file ${entry}`);
      } else {
        const crKey = `${yamlData.kind}-${metadata.name}`;

        if (fullResult[crKey]) {
          log.error(`Duplicate CR ${crKey}`);
        }

        // Keep the complete CR set for validations that need repository-wide context.
        fullResult[crKey] = yamlData;

        // Keep the filtered CR set for previous-CR lookup during claim rendering.
        if (
          allowedClaimReferences.length === 0 ||
          allowedClaimReferences.includes(
            yamlData.metadata?.annotations?.[
              common.generic.getFirestartrAnnotation('claim-ref')
            ],
          )
        ) {
          result[crKey] = yamlData;
        }
      }
    },
    excludedPaths.concat(getAdditionalPaths()),
  );

  return { crs: result, fullCrs: fullResult };
}

export async function loadCRs(
  crsPath: string = getPath('crs'),
  excludedPaths: string[] = [getPath('globals'), getPath('initializers')],
  allowedClaimReferences: string[] = [],
) {
  const { crs } = await loadCRsWithFullSet(
    crsPath,
    excludedPaths,
    allowedClaimReferences,
  );

  return crs;
}

export interface IRenameResult {
  kind: string;
  claimPath: string;
  claimName: string;
  oldName: string;
  newName: string;
}

/*
 * Description: Get the renamed using claimRef annotation
 * Input: claims: any, crs: any
 * Output: renames: IRenameResult[]
 */

export async function loadRenames(
  claims: any,
  crs: any,
): Promise<IRenameResult[]> {
  /*
   * If checkRenames is false, we don't need to check for renames
   */
  const renamesEnabled = getRenamesEnabled();
  if (!renamesEnabled) return [];

  const result: IRenameResult[] = [];

  /**
   * For each CR, look for a claim that does not match the name with CR's firestartr.dev/claim-ref annotation
   */
  for (const cr of Object.values(crs)) {
    const anyCr: any = cr;

    if (!anyCr?.metadata?.annotations) continue;

    // if the annotation is a claimRef
    const annotationName = common.generic.getFirestartrAnnotation('claim-ref');

    const annotations = anyCr?.metadata?.annotations || {};
    if (annotationName in annotations) {
      const claimRef = anyCr.metadata.annotations[annotationName];

      // split the annotation into kind and name
      const [kind, name] = claimRef.split('/');

      // if the claim exists, check if the name is different for the given provider
      const referencedClaim = claims[`${kind}-${name}`].claim;

      const oldName = anyCr.metadata.name;
      const newName = referencedClaim.providers[getConfiguredProvider()].name;

      if (oldName !== newName) {
        result.push({
          kind: referencedClaim.kind,
          claimPath: claims[`${kind}-${name}`].claimPath,
          claimName: referencedClaim.name,
          oldName,
          newName,
        });
      }
    }
  }
  return result;
}

export interface RenderData {
  globals?: any;
  initializers?: any;
  claims?: any;
  renames?: any;
  crs?: any;
}

export async function loadClaimsList(
  claimRefList: AsyncGenerator<string, void, unknown>,
  claimsPath: string = getPath('claims'),
) {
  const data: {
    renderClaims: RenderClaims;
    crs: any;
    fullCrs: any;
    renames?: IRenameResult[];
  } = {
    renderClaims: {},
    crs: {},
    fullCrs: {},
  };

  const defaults = loadClaimDefaults();

  for await (const claimRef of claimRefList) {
    const [renderedClaimData] = await loadClaim(
      claimRef,
      getOrg(),
      defaults,
      patchClaim,
      loadInitializers,
      loadGlobals,
      loadOverrides,
      loadNormalizers,
      claimsPath,
    );
    data.renderClaims = _.merge(data.renderClaims, renderedClaimData);
  }

  const crClaimReferences = [];
  for (const ref of Object.keys(data.renderClaims)) {
    // Replaces only the first instance of '-'
    crClaimReferences.push(ref.replace('-', '/'));
  }

  const loadedCrs = await loadCRsWithFullSet(
    getPath('crs'),
    [getPath('globals'), getPath('initializers')],
    crClaimReferences,
  );
  data['crs'] = loadedCrs.crs;
  data['fullCrs'] = loadedCrs.fullCrs;

  return data;
}

function getOrg() {
  const groupOrg: string = common.environment.getFromEnvironmentWithDefault(
    common.types.envVars.org,

    '',
  );

  return groupOrg;
}
