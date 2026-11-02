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

/** Facts about a claim kind that the CLI owns rather than the claim schema. */
interface KindOverrides {
  /** Directory under `claims/`; null when `--path` is required. */
  claimsDirectory: string | null;
  /** Produces only Backstage catalog entities; skips hydration. */
  catalogOnly: boolean;
  preflight: PreflightKindId | null;
  orgField: string | null;
  hydration: KindHydration | null;
  deleteWorkflow: string | null;
  /** The kind's provider clones one CR per variant. */
  variants: boolean;
  /** Repo that holds the kind's provisioned state. */
  stateRepo: string | null;
  /** Dotted claim reference paths; `[]` is an array and `.**` is recursive. */
  references: readonly string[];
}

const GITHUB_HYDRATION: KindHydration = {
  workflow: 'hydrate-github-claim.yaml',
  key: 'name',
  inputs: ['kind', 'name'],
};
const GITHUB_DELETE = 'delete-github-claim.yaml';
const SECRETS_HYDRATION: KindHydration = {
  workflow: 'hydrate-secrets-claim.yaml',
  key: 'name',
  inputs: ['name'],
};
const SECRETS_DELETE = 'delete-secrets-claim.yaml';
const TFWORKSPACE_HYDRATION: KindHydration = {
  workflow: 'hydrate-tfworkspace-claim.yaml',
  key: 'name',
  inputs: ['name'],
};
const TFWORKSPACE_DELETE = 'delete-tfworkspace-claim.yaml';

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
    hydration: GITHUB_HYDRATION,
    deleteWorkflow: GITHUB_DELETE,
    variants: false,
    stateRepo: 'state-github',
    references: [
      'system',
      'owner',
      'maintainedBy[]',
      'platformOwner',
      'subComponentOf',
      'providers.github.additionalRules[].owners[]',
      'providers.github.vars.actions[].value',
      'providers.github.secrets.actions[].value',
      'providers.github.secrets.codespaces[].value',
      'providers.github.secrets.dependabot[].value',
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
    hydration: GITHUB_HYDRATION,
    deleteWorkflow: GITHUB_DELETE,
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
    references: [
      'providers.github.actions_variables[].selected_repositories[]',
    ],
  },
  OrgWebhookClaim: {
    claimsDirectory: 'orgWebhook',
    catalogOnly: false,
    preflight: null,
    orgField: 'providers.github.orgName',
    hydration: GITHUB_HYDRATION,
    deleteWorkflow: GITHUB_DELETE,
    variants: false,
    stateRepo: 'state-github',
    references: ['system', 'owner', 'providers.github.webhook.secretRef'],
  },
  SecretsClaim: {
    claimsDirectory: null,
    catalogOnly: false,
    preflight: null,
    orgField: null,
    hydration: SECRETS_HYDRATION,
    deleteWorkflow: SECRETS_DELETE,
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
    hydration: TFWORKSPACE_HYDRATION,
    deleteWorkflow: TFWORKSPACE_DELETE,
    variants: true,
    stateRepo: 'state-infra',
    references: ['system', 'owner', 'providers.terraform.values.**'],
  },
  UserClaim: {
    claimsDirectory: 'users',
    catalogOnly: false,
    preflight: 'user',
    orgField: 'providers.github.org',
    hydration: GITHUB_HYDRATION,
    deleteWorkflow: GITHUB_DELETE,
    variants: false,
    stateRepo: 'state-github',
    references: [],
  },
} satisfies Record<ClaimKindName, KindOverrides>;

export interface KindCapability extends KindOverrides {
  kind: ClaimKindName;
  id: string;
  icon: { emoji: string; ascii: string };
  summary: string;
  requiresPath: boolean;
}

function kindCapability(kind: ClaimKindName): KindCapability {
  const overrides = KIND_OVERRIDES[kind];
  return {
    kind,
    ...CLAIM_KINDS[kind],
    ...overrides,
    requiresPath: overrides.claimsDirectory === null,
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
    delete: {
      supported: capability.deleteWorkflow !== null,
      workflow: capability.deleteWorkflow,
    },
    variants: capability.variants,
    preflight: capability.preflight,
    stateRepo: capability.stateRepo,
    references: capability.references,
  };
}

export function kindCapabilitiesJson(): readonly KindCapabilityJson[] {
  return KIND_CAPABILITIES.map(toKindCapabilityJson);
}

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
