import { RenderClaimKey, RenderClaims } from '../renderer/types';
import { extractRefs } from './refsExtractor';

/**
 * @param renderClaims renderClaims to sort
 * @param kinds kinds to get from renderClaims
 * @returns renderClaims with only the kinds specified
 */
export function sortRenderClaimsByKind(
  renderClaims: RenderClaims,
  kinds: string[],
): RenderClaims {
  let result: RenderClaims = {};

  for (const kind of kinds) {
    for (const key in renderClaims) {
      if ((renderClaims[key as RenderClaimKey] as any).claim.kind === kind) {
        result[key as RenderClaimKey] = renderClaims[key as RenderClaimKey];
      }
    }

    result = sortSelfKindRefs(result, kind);
  }

  return result;
}

function sortSelfKindRefs(renderClaims: RenderClaims, kind: string) {
  if (!hasSelfRefs(kind)) {
    return renderClaims;
  }

  const newRenderClaims: RenderClaims = {};

  const data: any = extractRefs(renderClaims, kind);

  const ordered: any[] = [];

  const visiting: any[] = [];

  const visited: any[] = [];

  for (const key of Object.keys(data)) {
    if (!visited.find((obj) => obj.name === key)) {
      sortRefs(data, data[key], ordered, visiting, visited);
    }
  }

  for (const cr of ordered) {
    newRenderClaims[cr.name] = renderClaims[cr.name];
  }

  return newRenderClaims;
}

function sortRefs(
  data: any,
  claim: any,
  ordered: any[] = [],
  visiting: any[] = [],
  visited: any[] = [],
) {
  if (visiting.find((obj) => obj.name === claim.name)) {
    throw new Error(`Circular dependency detected for '${claim.name}'`);
  }

  if (!visited.find((obj) => obj.name === claim.name)) {
    visiting.push(claim);

    if (claim.refs) {
      for (const ref of claim.refs) {
        const referencedObject = data[ref];

        if (!referencedObject) {
          throw new Error(
            `Reference '${ref}' does not exist for '${claim.name}'`,
          );
        }

        sortRefs(data, referencedObject, ordered, visiting, visited);
      }
    }

    visited.push(visiting.pop());

    ordered.push(claim);
  }
}

function hasSelfRefs(kind: string) {
  return ['TFWorkspaceClaim', 'GroupClaim'].includes(kind);
}
