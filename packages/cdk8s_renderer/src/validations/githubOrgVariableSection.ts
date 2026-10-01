import { RenderedCrMap } from '../renderer/types';

const GITHUB_ORG_VARIABLE_SECTION_KIND =
  'FirestartrGithubOrganizationVariableSection';
const FIRESTARTR_CLAIM_REF_ANNOTATION = 'firestartr.dev/claim-ref';
const CLAIM_REF_LABEL = 'claim-ref';

function formatResourceRef(name: string, claimRef?: string): string {
  return claimRef ? `${name} (claim: ${claimRef})` : name;
}

export function validateGithubOrgVariableSectionSingleton(
  crs: RenderedCrMap,
): void {
  const refsByOrg = new Map<string, string[]>();
  const seenClaimRefs = new Map<string, Set<string>>();

  for (const crKey of Object.keys(crs)) {
    const cr: any = crs[crKey];

    if (cr.kind !== GITHUB_ORG_VARIABLE_SECTION_KIND) continue;

    const org = cr.spec?.org;
    if (typeof org !== 'string' || !org) continue;

    const name = cr.metadata?.name || crKey;
    const claimRef =
      cr.metadata?.annotations?.[FIRESTARTR_CLAIM_REF_ANNOTATION] ||
      cr.metadata?.labels?.[CLAIM_REF_LABEL];

    const normalizedOrg = org.toLowerCase();

    if (claimRef) {
      const seen = seenClaimRefs.get(normalizedOrg) || new Set();
      if (seen.has(claimRef)) continue;
      seen.add(claimRef);
      seenClaimRefs.set(normalizedOrg, seen);
    }

    const refs = refsByOrg.get(normalizedOrg) || [];
    refs.push(formatResourceRef(name, claimRef));
    refsByOrg.set(normalizedOrg, refs);
  }

  for (const [org, refs] of refsByOrg.entries()) {
    if (refs.length < 2) continue;

    throw new Error(
      `Duplicate ${GITHUB_ORG_VARIABLE_SECTION_KIND} resources found for GitHub organization "${org}": ${refs.join(', ')}`,
    );
  }
}

export function validateActionsVariablesUniqueness(crs: RenderedCrMap): void {
  for (const crKey of Object.keys(crs)) {
    const cr: any = crs[crKey];

    if (cr.kind !== GITHUB_ORG_VARIABLE_SECTION_KIND) continue;

    const actionsVariables = cr.spec?.actionsVariables;
    if (!Array.isArray(actionsVariables)) continue;

    const names = new Set<string>();
    for (const variable of actionsVariables) {
      const varName = variable?.name;
      if (!varName) continue;

      if (names.has(varName)) {
        const org = cr.spec?.org || 'unknown';
        throw new Error(
          `Duplicate action variable name "${varName}" found in ${GITHUB_ORG_VARIABLE_SECTION_KIND} for organization "${org}"`,
        );
      }
      names.add(varName);
    }
  }
}
