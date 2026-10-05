import { CLAIM_KINDS } from './kinds.js';

import type { ClaimKindName } from './kinds.js';

/** Provider vocabulary of `preflight --kind`, when a kind has one. */
export type PreflightKindId = 'repo' | 'team' | 'user' | 'tfworkspace';

/**
 * Facts about a claim kind that the CLI owns rather than the claim schema:
 * where the kind lives in the claims repo, whether it is catalog-only, and
 * which preflight provider vocabulary it maps to.
 */
interface KindOverrides {
  /** Directory under `claims/`; null when `--path` is required. */
  claimsDirectory: string | null;
  /** Produces only Backstage catalog entities; skips hydration. */
  catalogOnly: boolean;
  preflight: PreflightKindId | null;
}

/**
 * The one hand-written kind table. `satisfies Record<ClaimKindName, …>` makes
 * adding a claim schema a compile error until the new kind is classified here.
 * Icons, ids and summaries come from the generated schema metadata instead.
 */
const KIND_OVERRIDES = {
  ArgoDeployClaim: {
    claimsDirectory: 'argocd',
    catalogOnly: false,
    preflight: null,
  },
  ComponentClaim: {
    claimsDirectory: 'components',
    catalogOnly: false,
    preflight: 'repo',
  },
  DomainClaim: {
    claimsDirectory: 'domains',
    catalogOnly: true,
    preflight: null,
  },
  GroupClaim: {
    claimsDirectory: 'groups',
    catalogOnly: false,
    preflight: 'team',
  },
  OrgSettingsClaim: {
    claimsDirectory: 'orgSettings',
    catalogOnly: false,
    preflight: null,
  },
  OrgWebhookClaim: {
    claimsDirectory: 'orgWebhook',
    catalogOnly: false,
    preflight: null,
  },
  SecretsClaim: {
    claimsDirectory: null,
    catalogOnly: false,
    preflight: null,
  },
  SystemClaim: {
    claimsDirectory: 'systems',
    catalogOnly: true,
    preflight: null,
  },
  TFWorkspaceClaim: {
    claimsDirectory: null,
    catalogOnly: false,
    preflight: 'tfworkspace',
  },
  UserClaim: {
    claimsDirectory: 'users',
    catalogOnly: false,
    preflight: 'user',
  },
} satisfies Record<ClaimKindName, KindOverrides>;

export interface KindCapability extends KindOverrides {
  kind: ClaimKindName;
  id: string;
  icon: { emoji: string; ascii: string };
  summary: string;
}

export const KIND_REGISTRY = Object.fromEntries(
  (Object.keys(CLAIM_KINDS) as ClaimKindName[]).map((kind) => [
    kind,
    { kind, ...CLAIM_KINDS[kind], ...KIND_OVERRIDES[kind] },
  ]),
) as Record<ClaimKindName, KindCapability>;

export const KIND_CAPABILITIES: readonly KindCapability[] =
  Object.values(KIND_REGISTRY);

/** Values accepted by `--kind`-style options: short id and full kind. */
export const CLAIM_KIND_OPTIONS: string[] = KIND_CAPABILITIES.flatMap(
  (capability) => [capability.id, capability.kind],
);

/** Kind lookup by short id (case-insensitive); full `*Claim` names fail. */
export function kindById(value: string): KindCapability | undefined {
  const wanted = value.toLowerCase();
  return KIND_CAPABILITIES.find((capability) => capability.id === wanted);
}

/** Kind lookup by short id or full `*Claim` name (case-insensitive). */
export function normalizeKind(value: string): ClaimKindName | undefined {
  const wanted = value.toLowerCase().replace(/claim$/, '');
  return KIND_CAPABILITIES.find((capability) => capability.id === wanted)?.kind;
}

export function isClaimKind(value: string): value is ClaimKindName {
  return value in KIND_REGISTRY;
}

export interface ClaimReference {
  kind: ClaimKindName;
  name: string;
}

/** Parses a `<Kind>-<name>` reference; short kind ids do not resolve. */
export function resolveClaimReference(
  value: string,
): ClaimReference | undefined {
  const separator = value.indexOf('-');
  if (separator < 1) return undefined;
  const kind = value.slice(0, separator);
  const name = value.slice(separator + 1);
  if (!isClaimKind(kind) || !name) return undefined;
  return { kind, name };
}

/** Claims-repo path capabilities, derived from the registry. */
export const CLAIM_PATH_CAPABILITIES = Object.fromEntries(
  KIND_CAPABILITIES.map((capability) => [
    capability.kind,
    capability.claimsDirectory === null
      ? { requiresExplicitPath: true }
      : { directory: capability.claimsDirectory, requiresExplicitPath: false },
  ]),
) as Record<
  ClaimKindName,
  | { readonly requiresExplicitPath: true }
  | { readonly directory: string; readonly requiresExplicitPath: false }
>;
