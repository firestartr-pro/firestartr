/**
 * renderedClaims is a map of rendered claims
 * It contains the rendered claims in the form of a map
 * where the key is the claim kind and name
 * and the value is the rendered CR
 */
let renderedClaims: any = {};

/**
 * previousClaimsSymbols holds previously rendered claims (from prior import
 * runs, e.g. the CRs already present on disk) keyed by claim kind and name.
 * It is only consulted as a fallback when a claim reference is not part of the
 * current render run but still exists as a previous CR.
 */
let previousClaimsSymbols: any = {};

import log from '../logger';

export function setRenderedClaim(claim: any, cr: any) {
  const claimKey = `${claim.kind}-${claim.name}`;

  log.silly(`Set rendered claim with key ${claimKey}`);

  if (renderedClaims[claimKey]) {
    throw new Error(`Claim ${claimKey} already rendered`);
  }

  renderedClaims[claimKey] = cr;
}

export function setPreviousClaimsSymbols(symbols: any) {
  previousClaimsSymbols = symbols ?? {};
}

export function emptyRenderedClaims() {
  renderedClaims = {};
  previousClaimsSymbols = {};
}

/**
 * Resolves a claim reference
 * @param kind Claim kind
 * @param name  Claim name
 * @param property  Claim property in lodash path format "metadata.name"
 * @returns value of the property
 */
export function resolveClaimRef(
  kind: string,

  name: string,

  symbolsTable: any = renderedClaims,
) {
  if (symbolsTable[`${kind}-${name}`]) {
    return symbolsTable[`${kind}-${name}`];
  }

  if (symbolsTable === renderedClaims) {
    const previousCr = previousClaimsSymbols[`${kind}-${name}`];

    if (previousCr) {
      return previousCr;
    }
  }

  throw new Error(`Claim ${kind}-${name} not found`);
}
