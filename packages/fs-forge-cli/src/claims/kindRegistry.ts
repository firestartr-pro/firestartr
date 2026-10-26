import { CLAIM_KINDS } from './kinds.js';

import type { ClaimKindName } from './kinds.js';

/** Provider vocabulary of `preflight --kind`, when a kind has one. */
export type PreflightKindId = 'repo' | 'team' | 'user' | 'tfworkspace';

/** Hydration the claims repo runs for a kind, as the CLI dispatches it. */
export interface KindHydration {
  /** Claims-repo workflow file that hydrates the claim. */
  workflow: string;
  /** Claim field passed as the workflow's `name` input. */
  key: string;
  /** Workflow inputs, in dispatch order. */
  inputs: readonly string[];
}

/** Whether a kind can be unprovisioned, and by which claims-repo workflow. */
export interface KindDelete {
  supported: boolean;
  workflow: string | null;
}

/**
 * Facts about a claim kind that the CLI owns rather than the claim schema:
 * where the kind lives in the claims repo, how it hydrates and deletes, and
 * which preflight provider vocabulary it maps to.
 */
interface KindOverrides {
  /** Directory under `claims/`; null when `--path` is required. */
  claimsDirectory: string | null;
  /** Produces only Backstage catalog entities; skips hydration. */
  catalogOnly: boolean;
  preflight: PreflightKindId | null;
  /** Dotted path of the claim's organization field; null when it has none. */
  orgField: string | null;
  /** Hydration this kind gets; null when no workflow hydrates it. */
  hydration: KindHydration | null;
  /** Claims-repo workflow that unprovisions this kind; null when none does. */
  deleteWorkflow: string | null;
  /** Whether the kind's provider supports variant claims. */
  variants: boolean;
  /** State repo that holds the kind's provisioned state; null when it has none. */
  stateRepo: string | null;
  /** Dotted claim fields pointing at other claims; arrays end in `[]`. */
  references: readonly string[];
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
    orgField: null,
    hydration: null,
    deleteWorkflow: null,
    variants: false,
    stateRepo: null,
    references: ['system'],
  },
  ComponentClaim: {
    claimsDirectory: 'components',
    catalogOnly: false,
    preflight: 'repo',
    orgField: 'providers.github.org',
    hydration: {
      workflow: 'hydrate-github-claim.yaml',
      key: 'name',
      inputs: ['kind', 'name'],
    },
    deleteWorkflow: 'delete-github-claim.yaml',
    variants: false,
    stateRepo: 'state-github',
    references: [
      'system',
      'owner',
      'maintainedBy[]',
      'platformOwner',
      'subComponentOf',
    ],
  },
  DomainClaim: {
    claimsDirectory: 'domains',
    catalogOnly: true,
    preflight: null,
    orgField: null,
    hydration: null,
    deleteWorkflow: null,
    variants: false,
    stateRepo: null,
    references: ['owner'],
  },
  GroupClaim: {
    claimsDirectory: 'groups',
    catalogOnly: false,
    preflight: 'team',
    orgField: 'providers.github.org',
    hydration: {
      workflow: 'hydrate-github-claim.yaml',
      key: 'name',
      inputs: ['kind', 'name'],
    },
    deleteWorkflow: 'delete-github-claim.yaml',
    variants: false,
    stateRepo: 'state-github',
    references: ['parent', 'children[]', 'members[]'],
  },
  OrgSettingsClaim: {
    claimsDirectory: 'orgSettings',
    catalogOnly: false,
    preflight: null,
    orgField: 'providers.github.org',
    hydration: null,
    deleteWorkflow: null,
    variants: false,
    stateRepo: 'state-github',
    references: [],
  },
  OrgWebhookClaim: {
    claimsDirectory: 'orgWebhook',
    catalogOnly: false,
    preflight: null,
    orgField: null,
    hydration: {
      workflow: 'hydrate-github-claim.yaml',
      key: 'name',
      inputs: ['kind', 'name'],
    },
    deleteWorkflow: 'delete-github-claim.yaml',
    variants: false,
    stateRepo: 'state-github',
    references: ['system', 'owner'],
  },
  SecretsClaim: {
    claimsDirectory: null,
    catalogOnly: false,
    preflight: null,
    orgField: null,
    hydration: {
      workflow: 'hydrate-secrets-claim.yaml',
      key: 'name',
      inputs: ['name'],
    },
    deleteWorkflow: 'delete-secrets-claim.yaml',
    variants: false,
    stateRepo: 'state-infra',
    references: ['system', 'owner'],
  },
  SystemClaim: {
    claimsDirectory: 'systems',
    catalogOnly: true,
    preflight: null,
    orgField: null,
    hydration: null,
    deleteWorkflow: null,
    variants: false,
    stateRepo: null,
    references: ['domain', 'owner'],
  },
  TFWorkspaceClaim: {
    claimsDirectory: null,
    catalogOnly: false,
    preflight: 'tfworkspace',
    orgField: null,
    hydration: {
      workflow: 'hydrate-tfworkspace-claim.yaml',
      key: 'name',
      inputs: ['name'],
    },
    deleteWorkflow: 'delete-tfworkspace-claim.yaml',
    variants: true,
    stateRepo: 'state-infra',
    references: ['system', 'owner'],
  },
  UserClaim: {
    claimsDirectory: 'users',
    catalogOnly: false,
    preflight: 'user',
    orgField: 'providers.github.org',
    hydration: {
      workflow: 'hydrate-github-claim.yaml',
      key: 'name',
      inputs: ['kind', 'name'],
    },
    deleteWorkflow: 'delete-github-claim.yaml',
    variants: false,
    stateRepo: 'state-github',
    references: [],
  },
} satisfies Record<ClaimKindName, KindOverrides>;

export interface KindCapability extends Omit<KindOverrides, 'deleteWorkflow'> {
  kind: ClaimKindName;
  id: string;
  icon: { emoji: string; ascii: string };
  summary: string;
  /** Derived: the kind has no `claimsDirectory`, so `--path` is required. */
  requiresPath: boolean;
  delete: KindDelete;
}

/** Joins a kind's generated metadata with its hand-written overrides. */
function kindCapability(kind: ClaimKindName): KindCapability {
  const { claimsDirectory, deleteWorkflow, ...overrides } =
    KIND_OVERRIDES[kind];
  return {
    kind,
    ...CLAIM_KINDS[kind],
    ...overrides,
    claimsDirectory,
    requiresPath: claimsDirectory === null,
    delete: { supported: deleteWorkflow !== null, workflow: deleteWorkflow },
  };
}

export const KIND_REGISTRY = Object.fromEntries(
  (Object.keys(CLAIM_KINDS) as ClaimKindName[]).map(
    (kind) => [kind, kindCapability(kind)] as const,
  ),
) as Record<ClaimKindName, KindCapability>;

export const KIND_CAPABILITIES: readonly KindCapability[] =
  Object.values(KIND_REGISTRY);

/** Wire shape of `kinds --json` and `kinds show <kind> --json`. */
export interface KindCapabilityJson {
  id: string;
  kind: ClaimKindName;
  description: string;
  claimsDirectory: string | null;
  requiresPath: boolean;
  catalogOnly: boolean;
  orgField: string | null;
  hydration: KindHydration | null;
  delete: KindDelete;
  variants: boolean;
  preflight: PreflightKindId | null;
  stateRepo: string | null;
  references: readonly string[];
}

export function toKindCapabilityJson(
  capability: KindCapability,
): KindCapabilityJson {
  return {
    id: capability.id,
    kind: capability.kind,
    description: capability.summary,
    claimsDirectory: capability.claimsDirectory,
    requiresPath: capability.requiresPath,
    catalogOnly: capability.catalogOnly,
    orgField: capability.orgField,
    hydration: capability.hydration,
    delete: capability.delete,
    variants: capability.variants,
    preflight: capability.preflight,
    stateRepo: capability.stateRepo,
    references: capability.references,
  };
}

export const KIND_CAPABILITIES_JSON: readonly KindCapabilityJson[] =
  KIND_CAPABILITIES.map(toKindCapabilityJson);

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
  return Object.prototype.hasOwnProperty.call(KIND_REGISTRY, value);
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
