// Central claim-taxonomy module: all claim-kind facts live here.
// Add a new claim kind by editing CLAIM_KIND_TO_CR_KIND and
// CLAIM_KIND_TO_RELATED_CR_KINDS — no other module needs to change.

import common from 'catalog_common';

export const FIRESTARTR_API_VERSION = 'firestartr.dev/v1';

// Firestartr manifest annotation names. The suffix is the fact; the
// `firestartr.dev/` prefix is applied by getFirestartrAnnotation.
export const FIRESTARTR_ANNOTATIONS = {
  claimRef: 'claim-ref',
  reconcileAt: 'reconcile-at',
  import: 'import',
  externalName: 'external-name',
} as const;

export function getFirestartrAnnotation(
  name: keyof typeof FIRESTARTR_ANNOTATIONS,
): string {
  return common.generic.getFirestartrAnnotation(FIRESTARTR_ANNOTATIONS[name]);
}

export const CLAIM_KIND_TO_CR_KIND = {
  GroupClaim: 'FirestartrGithubGroup',
  UserClaim: 'FirestartrGithubMembership',
  ComponentClaim: 'FirestartrGithubRepository',
  TFWorkspaceClaim: 'FirestartrTerraformWorkspace',
  OrgWebhookClaim: 'FirestartrGithubOrgWebhook',
  OrgSettingsClaim: 'FirestartrGithubOrganizationSettings',
} as const satisfies Record<string, string>;

const CLAIM_KIND_TO_RELATED_CR_KINDS = {
  GroupClaim: ['FirestartrGithubGroup'],
  UserClaim: ['FirestartrGithubMembership'],
  ComponentClaim: [
    'FirestartrGithubRepository',
    'FirestartrGithubRepositorySecretsSection',
    'FirestartrGithubRepositoryFeature',
  ],
  TFWorkspaceClaim: ['FirestartrTerraformWorkspace'],
  OrgWebhookClaim: ['FirestartrGithubOrgWebhook'],
  OrgSettingsClaim: [
    'FirestartrGithubOrganizationSettings',
    'FirestartrGithubOrganizationVariableSection',
  ],
} as const satisfies Record<string, readonly string[]>;

export type ClaimKind = keyof typeof CLAIM_KIND_TO_CR_KIND;
export type ClaimRef = `${ClaimKind}/${string}`;

// Claim kinds whose resources are tracked as org-scoped resources
// (GitHub groups/repos) in addition to cluster CRs.
const ORG_RESOURCE_CLAIM_KINDS = new Set<ClaimKind>([
  'GroupClaim',
  'ComponentClaim',
]);

function hasOwnKey<T extends object>(
  record: T,
  key: PropertyKey,
): key is keyof T {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function isClaimKind(value: unknown): value is ClaimKind {
  return typeof value === 'string' && hasOwnKey(CLAIM_KIND_TO_CR_KIND, value);
}

export function buildClaimRef(
  claimKind: ClaimKind,
  claimName: string,
): ClaimRef {
  return `${claimKind}/${claimName}`;
}

export function getRelatedCrKindsForClaimKind(claimKind: ClaimKind): string[] {
  const kinds = CLAIM_KIND_TO_RELATED_CR_KINDS[claimKind];
  if (!kinds) {
    throw new Error(
      `Missing related CR kind mapping for claim kind ${claimKind}`,
    );
  }
  return [...kinds];
}

export function isOrgResourceClaimKind(claimKind: ClaimKind): boolean {
  return ORG_RESOURCE_CLAIM_KINDS.has(claimKind);
}
