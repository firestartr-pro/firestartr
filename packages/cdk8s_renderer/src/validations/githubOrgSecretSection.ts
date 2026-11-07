import { RenderClaims, RenderedCrMap } from '../renderer/types';

const GITHUB_ORG_SECRET_SECTION_KIND =
  'FirestartrGithubOrganizationSecretSection';
const FIRESTARTR_CLAIM_REF_ANNOTATION = 'firestartr.dev/claim-ref';
const CLAIM_REF_LABEL = 'claim-ref';

const SECRETS_CLAIM_REF_PATTERN =
  /^ref:secretsclaim:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$/;

function formatResourceRef(name: string, claimRef?: string): string {
  return claimRef ? `${name} (claim: ${claimRef})` : name;
}

export function validateGithubOrgSecretSectionSingleton(
  crs: RenderedCrMap,
): void {
  const refsByOrg = new Map<string, string[]>();
  const seenClaimRefs = new Map<string, Set<string>>();

  for (const crKey of Object.keys(crs)) {
    const cr: any = crs[crKey];

    if (cr.kind !== GITHUB_ORG_SECRET_SECTION_KIND) continue;

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
      `Duplicate ${GITHUB_ORG_SECRET_SECTION_KIND} resources found for GitHub organization "${org}": ${refs.join(', ')}`,
    );
  }
}

export function validateSecretNamesUniqueness(crs: RenderedCrMap): void {
  for (const crKey of Object.keys(crs)) {
    const cr: any = crs[crKey];

    if (cr.kind !== GITHUB_ORG_SECRET_SECTION_KIND) continue;

    const secrets = cr.spec?.secrets;
    if (!secrets || typeof secrets !== 'object') continue;

    for (const section of ['actions', 'codespaces', 'dependabot']) {
      const sectionSecrets = secrets[section];
      if (!Array.isArray(sectionSecrets)) continue;

      const names = new Set<string>();
      for (const secret of sectionSecrets) {
        const secretName = secret?.name;
        if (!secretName) continue;

        if (names.has(secretName)) {
          const org = cr.spec?.org || 'unknown';
          throw new Error(
            `Duplicate secret name "${secretName}" found in ${section} section of ${GITHUB_ORG_SECRET_SECTION_KIND} for organization "${org}"`,
          );
        }
        names.add(secretName);
      }
    }
  }
}

export function validateOrgSecretsCrossReferences(
  renderClaims: RenderClaims,
): void {
  for (const claimKey of Object.keys(renderClaims)) {
    if (!claimKey.startsWith('OrgSettingsClaim-')) continue;

    const claimData = renderClaims[claimKey];
    const claim = claimData?.claim;
    const orgSecrets = claim?.providers?.github?.org_secrets;
    if (!orgSecrets || typeof orgSecrets !== 'object') continue;

    for (const section of ['actions', 'codespaces', 'dependabot']) {
      const secrets = orgSecrets[section];
      if (!Array.isArray(secrets)) continue;

      for (const secret of secrets) {
        if (!secret.value) continue;

        const match = secret.value.match(SECRETS_CLAIM_REF_PATTERN);
        if (!match) continue;

        const [, secretClaimName, secretKey] = match;
        const expectedKey = `SecretsClaim-${secretClaimName}`;

        if (!renderClaims[expectedKey]) continue;

        const secretClaim = renderClaims[expectedKey]?.claim;
        const externalSecrets =
          secretClaim?.providers?.external_secrets?.externalSecrets?.secrets;
        const pushSecrets =
          secretClaim?.providers?.external_secrets?.pushSecrets;

        let keyFound = false;

        if (Array.isArray(pushSecrets)) {
          keyFound =
            pushSecrets.find((s: any) => s.secretName === secretKey) !==
            undefined;
        }

        if (!keyFound && Array.isArray(externalSecrets)) {
          keyFound =
            externalSecrets.find((s: any) => s.secretName === secretKey) !==
            undefined;
        }

        if (!keyFound) {
          throw new Error(
            `CrossReference error: OrgSettingsClaim/${claim.name} references a non-existent secret key "${secretKey}" in SecretsClaim/${secretClaimName} via org_secrets.${section}.${secret.name}`,
          );
        }
      }
    }
  }
}
