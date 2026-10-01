import { RenderedCrMap } from '../renderer/types';

const GITHUB_ORG_SETTINGS_KIND = 'FirestartrGithubOrganizationSettings';
const FIRESTARTR_CLAIM_REF_ANNOTATION = 'firestartr.dev/claim-ref';
const CLAIM_REF_LABEL = 'claim-ref';

function formatResourceRef(name: string, claimRef?: string): string {
  return claimRef ? `${name} (claim: ${claimRef})` : name;
}

// Render-time singleton: at most one FirestartrGithubOrganizationSettings per
// GitHub org (case-insensitive) across the whole rendered set. See ADR 0003.
export function validateGithubOrgSettingsSingleton(crs: RenderedCrMap): void {
  const refsByOrg = new Map<string, string[]>();

  for (const crKey of Object.keys(crs)) {
    const cr: any = crs[crKey];

    if (cr.kind !== GITHUB_ORG_SETTINGS_KIND) continue;

    const org = cr.spec?.org;
    if (typeof org !== 'string' || !org) continue;

    const name = cr.metadata?.name || crKey;
    const claimRef =
      cr.metadata?.annotations?.[FIRESTARTR_CLAIM_REF_ANNOTATION] ||
      cr.metadata?.labels?.[CLAIM_REF_LABEL];

    const normalizedOrg = org.toLowerCase();
    const refs = refsByOrg.get(normalizedOrg) || [];
    refs.push(formatResourceRef(name, claimRef));
    refsByOrg.set(normalizedOrg, refs);
  }

  for (const [org, refs] of refsByOrg.entries()) {
    if (refs.length < 2) continue;

    throw new Error(
      `Duplicate ${GITHUB_ORG_SETTINGS_KIND} resources found for GitHub organization "${org}": ${refs.join(', ')}`,
    );
  }
}
