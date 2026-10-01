import { App, YamlOutputType } from 'cdk8s';
import { renderClaims, renameVariantCrFiles } from './claims-render';
import { RenderClaims } from './types';
import { setPreviousClaimsSymbols } from '../refresolver';

import { importedsRefsWalker } from './imported-refs';

import log from '../logger';
import { emptyRenderedClaims } from '../refresolver';
import { loadClaimDefaults, patchClaim } from '../loader/loader';
import { validateClaim } from '../claims/base/validation';
import { stitchClaim, STITCHED_CLAIM } from '../claims/stitching/stitching';
import common from 'catalog_common';

/*
 * Function called when rendering from the importer class.
 *
 * Input:
 * - renderClaims: a RenderClaims object, which contains the list of claims
 *   we want to render
 *
 * Return:
 * - The result of rendering the renderClaims object, plus the
 *   rendered firestartr-all group
 *
 */
export async function renderFromImports(
  rClaims: RenderClaims,

  crs: any = {},

  catalogOutputDir = '/tmp/.catalog',

  crOutputDir = '/tmp/.resources',

  needsReImport = false,
) {
  // Apply claim defaults (same as runRenderer path does via loadClaim/patchClaim)
  let defaults: any;
  try {
    defaults = loadClaimDefaults();
  } catch (e) {
    log.warn(`Could not load claim defaults: ${e.message}`);
  }

  // type: is the kind of the claim
  // value: is the imported-ref (the name in Github, can be with special characters, spaces, etc)
  const previousClaimsIndex = buildPreviousClaimsIndex(crs);

  const fSolver = (type: string, value: string) => {
    return solver(type, value, rClaims, previousClaimsIndex);
  };

  try {
    // we need to expand the imported-refs
    for (const renderClaim of Object.values(rClaims)) {
      const symbolsToResolve = importedsRefsWalker(renderClaim);

      await Promise.all(symbolsToResolve.map((s) => s(fSolver)));
    }
  } catch (e) {
    log.error(`Error while resolving imported-refs: ${e.message}`);
    throw new Error(`Error while resolving imported-refs: ${e.message}`);
  }

  // Clear the rendered claims symbol table to ensure a clean state
  // after resolving imported refs, preventing setRenderedClaim() from throwing
  // 'already rendered' for claims that were previously seeded
  emptyRenderedClaims();

  // After resolving the imported-refs, each claim goes through the same
  // defaults → stitching → AJV pipeline as loadClaim so feature claim-patches
  // are applied and validated at the import boundary too. Stitching is
  // once-only: already stitched claims are left untouched (no feature
  // re-download, no gates re-applied).
  for (const renderClaim of Object.values(rClaims)) {
    if (renderClaim.claim && renderClaim.claim[STITCHED_CLAIM]) {
      validateClaim(
        renderClaim.claim,
        `firestartr.dev://common/${renderClaim.claim.kind}`,
      );
      continue;
    }
    const rawClaim = renderClaim.claim;
    const claim = defaults ? patchClaim(rawClaim, defaults) : rawClaim;
    renderClaim.claim = await stitchClaim(claim, undefined, rawClaim);
    validateClaim(
      renderClaim.claim,
      `firestartr.dev://common/${renderClaim.claim.kind}`,
    );
  }

  const catalogScope = new App({
    outdir: catalogOutputDir,

    outputFileExtension: '.yaml',

    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });

  const firestartrScope = new App({
    outdir: crOutputDir,

    outputFileExtension: '.yaml',

    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
  });

  // Claims skipped from this run (e.g. by fCheckCRExistsOnDisk) but still
  // present as previous CRs must be resolvable by charts that reference them.
  setPreviousClaimsSymbols(buildPreviousClaimsSymbols(crs));

  const result: any = await renderClaims(
    catalogScope,

    firestartrScope,

    { renderClaims: rClaims, crs, renames: [] },
  );

  firestartrScope.synth();

  if (crOutputDir) {
    renameVariantCrFiles(crOutputDir, result);
  }

  return result;
}

export function buildPreviousClaimsIndex(crs: any): {
  user: Map<string, string>;
  group: Map<string, string>;
} {
  const index: { user: Map<string, string>; group: Map<string, string> } = {
    user: new Map<string, string>(),
    group: new Map<string, string>(),
  };

  for (const cr of Object.values(crs ?? {})) {
    const anyCr = cr as any;

    const kind = anyCr?.kind;

    const externalName =
      anyCr?.metadata?.annotations?.[
        common.generic.getFirestartrAnnotation('external-name')
      ];

    const claimRef =
      anyCr?.metadata?.annotations?.[
        common.generic.getFirestartrAnnotation('claim-ref')
      ];

    if (!kind || !externalName || !claimRef) {
      continue;
    }

    const claimName = claimRef.split('/')[1];

    if (!claimName) {
      continue;
    }

    if (kind === 'FirestartrGithubMembership') {
      index.user.set(externalName, claimName);
    } else if (kind === 'FirestartrGithubGroup') {
      index.group.set(externalName, claimName);
    }
  }

  return index;
}

export function buildPreviousClaimsSymbols(crs: any): Record<string, any> {
  const symbols: Record<string, any> = {};

  for (const cr of Object.values(crs ?? {})) {
    const anyCr = cr as any;

    const kind = anyCr?.kind;

    const claimRef =
      anyCr?.metadata?.annotations?.[
        common.generic.getFirestartrAnnotation('claim-ref')
      ];

    if (!kind || !claimRef) {
      continue;
    }

    const claimName = claimRef.split('/')[1];

    if (!claimName) {
      continue;
    }

    const claimKind =
      kind === 'FirestartrGithubMembership'
        ? 'UserClaim'
        : kind === 'FirestartrGithubGroup'
          ? 'GroupClaim'
          : undefined;

    if (!claimKind) {
      continue;
    }

    symbols[`${claimKind}-${claimName}`] = anyCr;
  }

  return symbols;
}

async function solver(
  type: string,
  value: string,
  rClaims: RenderClaims,
  previousClaimsIndex: {
    user: Map<string, string>;
    group: Map<string, string>;
  },
) {
  const claimKind = type === 'user' ? 'UserClaim' : 'GroupClaim';

  for (const key in rClaims) {
    if (key.startsWith(claimKind)) {
      const claimData = rClaims[key];

      if (claimData.claim.providers?.github?.name === value) {
        return `${type}:${claimData.claim.name}`;
      }
    }
  }

  const previousClaimName =
    type === 'user'
      ? previousClaimsIndex.user.get(value)
      : previousClaimsIndex.group.get(value);

  if (previousClaimName) {
    return `${type}:${previousClaimName}`;
  }

  throw new Error(
    `Could not resolve imported-ref of type ${type} with value ${value}`,
  );
}
