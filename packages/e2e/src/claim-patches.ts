import type { ClaimKind } from './claim-taxonomy';
import type { JsonPatchOperation } from './types';

// =============================================================================
// Claim-patch policy
//
// The patch set that makes a base_claims fixture valid for e2e — empty
// user-reference fields, the OIDC knobs, the owner/platformOwner refs — lives
// here so every suite and orgScript share one policy instead of re-deriving it.
// Suites pass options for the fields that are usually emptied but occasionally
// set, and an `extraPatches` tail for suite-specific additions.
// =============================================================================

const CLAIM_KIND_TO_GITHUB_ORG_FIELD = {
  GroupClaim: 'org',
  UserClaim: 'org',
  ComponentClaim: 'org',
  OrgWebhookClaim: 'orgName',
  OrgSettingsClaim: 'org',
} as const satisfies Partial<Record<ClaimKind, 'org' | 'orgName'>>;

const CLAIM_KIND_TO_PROVIDER_NAME_FIELD = {
  GroupClaim: '/providers/github/name',
  UserClaim: '/providers/github/name',
  ComponentClaim: '/providers/github/name',
  TFWorkspaceClaim: '/providers/terraform/name',
  OrgWebhookClaim: '/providers/github/name',
  OrgSettingsClaim: '/providers/github/name',
} as const satisfies Partial<Record<ClaimKind, string>>;

function hasOwnKey<T extends object>(
  record: T,
  key: PropertyKey,
): key is keyof T {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Kind-aware patches every render needs: the claim name, the provider name and
 * the GitHub org field. renderLocally applies these before caller patches.
 */
export function buildCommonClaimPatches(
  name: string,
  org: string,
  claimKind: string,
): JsonPatchOperation[] {
  const patches: JsonPatchOperation[] = [
    { op: 'replace', path: '/name', value: name },
  ];

  if (claimKind === 'ComponentClaim') {
    patches.push({
      op: 'add',
      path: '/providers/github/archiveOnDestroy',
      value: false,
    });
  }

  const providerNameField = hasOwnKey(
    CLAIM_KIND_TO_PROVIDER_NAME_FIELD,
    claimKind,
  )
    ? CLAIM_KIND_TO_PROVIDER_NAME_FIELD[claimKind]
    : undefined;

  if (providerNameField) {
    patches.push({ op: 'replace', path: providerNameField, value: name });
  }

  const githubOrgField = hasOwnKey(CLAIM_KIND_TO_GITHUB_ORG_FIELD, claimKind)
    ? CLAIM_KIND_TO_GITHUB_ORG_FIELD[claimKind]
    : undefined;

  if (githubOrgField) {
    patches.push({
      op: 'replace',
      path: `/providers/github/${githubOrgField}`,
      value: org,
    });
  }

  return patches;
}

export interface CodeownersRule {
  path: string;
  owners: string[];
}

export interface ComponentActionsVars {
  actions: Array<{ name: string; value: string }>;
}

export interface ComponentPagesSection {
  buildType: string;
  source: { branch: string; path: string };
  cname: string;
}

export interface ComponentClaimPatchOptions {
  /** Claim name; sets both /name and the GitHub provider name. */
  name: string;
  org?: string;
  ownerRef: string;
  platformOwnerRef?: string;
  /** When omitted, /maintainedBy is removed. */
  maintainedBy?: string[];
  description?: string;
  topics?: string[];
  features?: Array<Record<string, unknown>>;
  vars?: ComponentActionsVars;
  /** Defaults to [] when omitted. */
  additionalCodeownersRules?: CodeownersRule[];
  hasIssues?: boolean;
  pages?: ComponentPagesSection;
  secrets?: Array<{ name: string; value: string }>;
  /** Suite-specific tail, appended after the shared policy. */
  extraPatches?: JsonPatchOperation[];
}

export interface GroupClaimPatchOptions {
  /** Claim name; sets both /name and the GitHub provider name. */
  name?: string;
  org?: string;
  parent?: `group:${string}`;
  members?: string[];
  displayName?: string;
  description?: string;
  /** Suite-specific tail, appended after the shared policy. */
  extraPatches?: JsonPatchOperation[];
}

export function buildComponentClaimPatches(
  options: ComponentClaimPatchOptions,
): JsonPatchOperation[] {
  const platformOwnerRef = options.platformOwnerRef ?? options.ownerRef;
  const patches: JsonPatchOperation[] = [
    { op: 'replace', path: '/name', value: options.name },
    { op: 'replace', path: '/providers/github/name', value: options.name },
  ];

  if (options.org !== undefined) {
    patches.push({
      op: 'replace',
      path: '/providers/github/org',
      value: options.org,
    });
  }

  patches.push({ op: 'remove', path: '/system' });
  patches.push(
    { op: 'replace', path: '/owner', value: options.ownerRef },
    { op: 'replace', path: '/platformOwner', value: platformOwnerRef },
  );

  if (options.maintainedBy) {
    patches.push({
      op: 'replace',
      path: '/maintainedBy',
      value: options.maintainedBy,
    });
  } else {
    patches.push({ op: 'remove', path: '/maintainedBy' });
  }

  if (options.description !== undefined) {
    patches.push({
      op: 'replace',
      path: '/providers/github/description',
      value: options.description,
    });
  }

  patches.push(
    { op: 'replace', path: '/providers/github/additionalRules', value: [] },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalAdmins',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalMaintainers',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalReaders',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalWriters',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalCodeownersRules',
      value: options.additionalCodeownersRules ?? [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/spec/actions/oidc/useDefault',
      value: true,
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/spec/actions/oidc/includeClaimKeys',
      value: [],
    },
  );

  if (options.hasIssues !== undefined) {
    patches.push({
      op: 'add',
      path: '/providers/github/overrides/spec/repo/hasIssues',
      value: options.hasIssues,
    });
  }

  if (options.topics) {
    patches.push({
      op: 'add',
      path: '/providers/github/topics',
      value: options.topics,
    });
  }

  if (options.vars) {
    patches.push({
      op: 'add',
      path: '/providers/github/vars',
      value: options.vars,
    });
  }

  if (options.features) {
    patches.push({
      op: 'add',
      path: '/providers/github/features',
      value: options.features,
    });
  }

  if (options.secrets) {
    patches.push({
      op: 'add',
      path: '/providers/github/secrets',
      value: { actions: options.secrets },
    });
  }

  if (options.pages) {
    patches.push({
      op: 'add',
      path: '/providers/github/pages',
      value: options.pages,
    });
  }

  return [...patches, ...(options.extraPatches ?? [])];
}

export function buildGroupClaimPatches(
  options: GroupClaimPatchOptions,
): JsonPatchOperation[] {
  const patches: JsonPatchOperation[] = [];

  if (options.name !== undefined) {
    patches.push(
      { op: 'replace', path: '/name', value: options.name },
      { op: 'replace', path: '/providers/github/name', value: options.name },
    );
  }

  if (options.description !== undefined) {
    patches.push({
      op: 'replace',
      path: '/description',
      value: options.description,
    });
  }

  if (options.displayName !== undefined) {
    patches.push({
      op: 'replace',
      path: '/profile/displayName',
      value: options.displayName,
    });
  }

  if (options.members !== undefined) {
    patches.push({ op: 'replace', path: '/members', value: options.members });
  }

  if (options.parent !== undefined) {
    // `add` sets the member whether or not the base fixture already has one.
    patches.push({ op: 'add', path: '/parent', value: options.parent });
  }

  if (options.org !== undefined) {
    patches.push({
      op: 'replace',
      path: '/providers/github/org',
      value: options.org,
    });
  }

  return [...patches, ...(options.extraPatches ?? [])];
}
