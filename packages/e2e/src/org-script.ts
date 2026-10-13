import { DEFAULT_E2E_ORG } from './constants';
import {
  buildComponentClaimPatches,
  buildGroupClaimPatches,
  type ComponentActionsVars,
} from './claim-patches';
import {
  buildE2ePrefix,
  createNameBuilder,
  normalizeNamePrefix,
} from './names';
import type { JsonPatchOperation } from './types';

// Only the GitHub-backed categories ('groups', 'components') currently produce
// orgScript monikers, claim objects, and render/apply fixtures. The remaining
// ones ('systems', 'domains', 'users', 'tfworkspaces', 'argocd',
// 'orgWebhooks', 'secrets') are valid exclude options but produce no output and
// are reserved for future implementation.
export const ORG_SCRIPT_CATEGORIES = [
  'groups',
  'components',
  'systems',
  'domains',
  'users',
  'tfworkspaces',
  'argocd',
  'orgWebhooks',
  'secrets',
] as const;

export type OrgScriptCategory = (typeof ORG_SCRIPT_CATEGORIES)[number];

export interface OrgScriptExclude extends Partial<
  Record<OrgScriptCategory, boolean>
> {
  // Backward-compatible alias from the issue text.
  repos?: boolean;
}

export interface OrgScriptOptions {
  exclude?: OrgScriptExclude;
  org?: string;
  defaultGroupRef?: `group:${string}`;
}

export interface OrgScriptClaim {
  kind: string;
  name: string;
  [key: string]: unknown;
}

export interface OrgScriptClaims {
  groups: OrgScriptClaim[];
  components: OrgScriptClaim[];
}

// A single render/apply fixture entry for currently supported e2e resources.
export interface OrgScriptFixture {
  // The fixture name as it appears under packages/e2e/fixtures/base_claims/
  // (e.g. 'group-a').
  fixtureName: string;
  // Final claim.name expected after patching. When omitted, callers can assume
  // createNameBuilder(prefix).build(fixtureName).
  claimName?: string;
  // JSON patches to apply during rendering, if any.
  patches?: JsonPatchOperation[];
}

export interface OrgScript {
  monikers: Record<string, string>;
  claims: OrgScriptClaims;
  // Flat list of fixture entries for renderable categories only, in dependency
  // order (groups -> components). Pass each entry directly to renderLocally -
  // no manual fixture table needed in tests.
  fixtures: OrgScriptFixture[];
}

type MonikerKey = 'group-a' | 'group-b' | 'group-c' | 'repo-a' | 'repo-b';

type IncludeFlags = {
  groups: boolean;
  components: boolean;
};

type ComponentVariantDefinition = {
  fixtureSuffix: 'frontend' | 'backend';
  monikerKey: 'repo-a' | 'repo-b';
  description: string;
  features?: Array<Record<string, unknown>>;
  vars?: ComponentActionsVars;
  topics?: string[];
};

type ComponentRelationships = {
  owner: string;
  platformOwner: string;
  maintainedBy?: string[];
};

type FixtureClaimNames = {
  groupA: string;
  groupB: string;
  groupC: string;
  frontend: string;
  backend: string;
};

// Subset of ORG_SCRIPT_CATEGORIES: the categories that currently produce output.
const MONIKER_CATEGORIES = [
  'groups',
  'components',
] as const satisfies ReadonlyArray<(typeof ORG_SCRIPT_CATEGORIES)[number]>;

type MonikerCategory = (typeof MONIKER_CATEGORIES)[number];

const CATEGORY_MONIKERS: Record<MonikerCategory, ReadonlyArray<MonikerKey>> = {
  groups: ['group-a', 'group-b', 'group-c'],
  components: ['repo-a', 'repo-b'],
};

const DEFAULT_GROUP_OWNER_REF = 'group:firestartr';

// Shared patches applied to every component fixture.
const FRONTEND_ACTIONS_VARS: ComponentActionsVars = {
  actions: [{ name: 'VAR_A', value: 'VALUE_A' }],
};

const FRONTEND_FEATURES = [
  {
    name: 'build_and_dispatch_docker_images',
    ref: 'main',
  },
];

const BACKEND_TOPICS = ['topic-a', 'topic-b'];

const COMPONENT_VARIANTS: ReadonlyArray<ComponentVariantDefinition> = [
  {
    fixtureSuffix: 'frontend',
    monikerKey: 'repo-a',
    description: 'Org script frontend repository',
    features: FRONTEND_FEATURES,
    vars: FRONTEND_ACTIONS_VARS,
  },
  {
    fixtureSuffix: 'backend',
    monikerKey: 'repo-b',
    description: 'Org script backend repository',
    topics: BACKEND_TOPICS,
  },
];

function createEmptyClaims(): OrgScriptClaims {
  return {
    groups: [],
    components: [],
  };
}

function withDashPrefix(prefix: string, suffix: string): string {
  return prefix ? `${prefix}-${suffix}` : suffix;
}

function buildAllMonikers(prefix: string): Record<MonikerKey, string> {
  return {
    'group-a': withDashPrefix(prefix, 'group-a'),
    'group-b': withDashPrefix(prefix, 'Group B'),
    'group-c': withDashPrefix(prefix, 'Research &&& Development'),
    'repo-a': withDashPrefix(prefix, 'frontend'),
    'repo-b': withDashPrefix(prefix, 'backend'),
  };
}

function isExcluded(
  category: OrgScriptCategory,
  exclude: OrgScriptExclude,
): boolean {
  if (category === 'components' && exclude.repos) return true;
  return Boolean(exclude[category]);
}

function buildIncludeFlags(exclude: OrgScriptExclude): IncludeFlags {
  return {
    groups: !isExcluded('groups', exclude),
    components: !isExcluded('components', exclude),
  };
}

function buildMonikers(
  allMonikers: Record<MonikerKey, string>,
  include: IncludeFlags,
): Record<string, string> {
  const monikers: Record<string, string> = {};

  for (const category of MONIKER_CATEGORIES) {
    if (!include[category]) continue;

    for (const monikerKey of CATEGORY_MONIKERS[category]) {
      monikers[monikerKey] = allMonikers[monikerKey];
    }
  }

  return monikers;
}

/**
 * Returns the claim name that renderLocally will assign to a fixture.
 * This mirrors the logic in buildClaimName / createNameBuilder in the e2e api.
 */
function buildClaimNameForFixture(prefix: string, fixtureName: string): string {
  return createNameBuilder(prefix).build(fixtureName);
}

function buildFixtureClaimNames(prefix: string): FixtureClaimNames {
  return {
    groupA: buildClaimNameForFixture(prefix, 'group-a'),
    groupB: buildClaimNameForFixture(prefix, 'group-b'),
    groupC: buildClaimNameForFixture(prefix, 'group-c'),
    frontend: buildClaimNameForFixture(prefix, 'frontend'),
    backend: buildClaimNameForFixture(prefix, 'backend'),
  };
}

function buildGroupRef(name: string): `group:${string}` {
  return `group:${name}`;
}

function buildGroupParentRefs(
  groupAName: string,
  groupBName: string,
): {
  groupBParent: `group:${string}`;
  groupCParent: `group:${string}`;
} {
  return {
    groupBParent: buildGroupRef(groupAName),
    groupCParent: buildGroupRef(groupBName),
  };
}

function buildComponentRelationships(
  include: Pick<IncludeFlags, 'groups'>,
  refs: {
    groupAName: string;
    groupBName: string;
    groupCName: string;
    defaultGroupRef: `group:${string}`;
  },
): ComponentRelationships {
  const owner = include.groups
    ? buildGroupRef(refs.groupAName)
    : refs.defaultGroupRef;
  const platformOwner = include.groups
    ? buildGroupRef(refs.groupBName)
    : refs.defaultGroupRef;

  return {
    owner,
    platformOwner,
    maintainedBy: include.groups ? [buildGroupRef(refs.groupCName)] : undefined,
  };
}

function buildComponentGithubExtras(
  variant: ComponentVariantDefinition,
): Record<string, unknown> {
  return {
    ...(variant.features ? { features: variant.features } : {}),
    ...(variant.vars ? { vars: variant.vars } : {}),
    ...(variant.topics ? { topics: variant.topics } : {}),
  };
}

function applyComponentRelationships(
  claim: OrgScriptClaim,
  relationships: ComponentRelationships,
): void {
  claim.owner = relationships.owner;
  claim.platformOwner = relationships.platformOwner;

  if (relationships.maintainedBy) {
    claim.maintainedBy = relationships.maintainedBy;
  }
}

function resolveComponentsDefaultGroupRef(
  include: IncludeFlags,
  options: OrgScriptOptions,
): `group:${string}` {
  if (include.groups || !include.components) {
    return DEFAULT_GROUP_OWNER_REF;
  }

  if (options.defaultGroupRef) {
    return options.defaultGroupRef;
  }

  throw new Error(
    'orgScript requires options.defaultGroupRef when groups are excluded and components are included',
  );
}

function buildGroupFixture(
  fixtureName: 'group-a' | 'group-b' | 'group-c',
  claimName: string,
  parent?: `group:${string}`,
): OrgScriptFixture {
  return {
    fixtureName,
    claimName,
    patches: buildGroupClaimPatches({ members: [], parent }),
  };
}

function buildComponentClaim(
  monikers: Record<MonikerKey, string>,
  org: string,
  variant: ComponentVariantDefinition,
  relationships: ComponentRelationships,
): OrgScriptClaim {
  const componentName = monikers[variant.monikerKey];

  const claim: OrgScriptClaim = {
    kind: 'ComponentClaim',
    version: '1.0',
    type: 'service',
    lifecycle: 'production',
    name: componentName,
    providers: {
      github: {
        description: variant.description,
        org,
        name: componentName,
        orgPermissions: 'none',
        visibility: 'private',
        branchStrategy: {
          name: 'trunkBasedDevelopment',
        },
        ...buildComponentGithubExtras(variant),
      },
    },
  };

  applyComponentRelationships(claim, relationships);
  return claim;
}

function buildGroups(
  monikers: Record<MonikerKey, string>,
  org: string,
): OrgScriptClaim[] {
  const parentRefs = buildGroupParentRefs(
    monikers['group-a'],
    monikers['group-b'],
  );

  return [
    {
      kind: 'GroupClaim',
      name: monikers['group-a'],
      description: 'Prefapp all description',
      type: 'business-unit',
      profile: {
        displayName: monikers['group-a'],
        email: 'group-a@',
        picture: 'https://example.com/groups/bu-infrastructure.jpeg',
      },
      members: [],
      providers: {
        github: {
          name: monikers['group-a'],
          privacy: 'closed',
          org,
        },
      },
    },
    {
      kind: 'GroupClaim',
      name: monikers['group-b'],
      description: 'Prefapp missing member description',
      type: 'business-unit',
      profile: {
        displayName: monikers['group-b'],
        email: 'group-b@',
        picture: 'https://example.com/groups/bu-infrastructure.jpeg',
      },
      members: [],
      parent: parentRefs.groupBParent,
      providers: {
        github: {
          name: monikers['group-b'],
          privacy: 'closed',
          org,
        },
      },
    },
    {
      kind: 'GroupClaim',
      name: monikers['group-c'],
      description: 'Prefapp missing member description',
      type: 'business-unit',
      profile: {
        displayName: monikers['group-c'],
        email: 'group-c@',
        picture: 'https://example.com/groups/bu-infrastructure.jpeg',
      },
      members: [],
      parent: parentRefs.groupCParent,
      providers: {
        github: {
          name: monikers['group-c'],
          privacy: 'closed',
          org,
        },
      },
    },
  ];
}

function buildComponents(
  monikers: Record<MonikerKey, string>,
  org: string,
  include: Pick<IncludeFlags, 'groups'>,
  defaultGroupRef: `group:${string}`,
): OrgScriptClaim[] {
  const relationships = buildComponentRelationships(include, {
    groupAName: monikers['group-a'],
    groupBName: monikers['group-b'],
    groupCName: monikers['group-c'],
    defaultGroupRef,
  });

  return COMPONENT_VARIANTS.map((variant) =>
    buildComponentClaim(monikers, org, variant, relationships),
  );
}
function buildComponentFixture(
  claimName: string,
  variant: ComponentVariantDefinition,
  relationships: ComponentRelationships,
): OrgScriptFixture {
  return {
    fixtureName: 'component-a',
    claimName,
    patches: buildComponentClaimPatches({
      name: claimName,
      ownerRef: relationships.owner,
      platformOwnerRef: relationships.platformOwner,
      maintainedBy: relationships.maintainedBy,
      features: variant.features,
      vars: variant.vars,
      topics: variant.topics,
    }),
  };
}

function buildFixtures(
  prefix: string,
  include: IncludeFlags,
  defaultGroupRef: `group:${string}`,
): OrgScriptFixture[] {
  const fixtures: OrgScriptFixture[] = [];
  const claimNames = buildFixtureClaimNames(prefix);
  const parentRefs = buildGroupParentRefs(claimNames.groupA, claimNames.groupB);

  const componentRelationships = buildComponentRelationships(
    {
      groups: include.groups,
    },
    {
      groupAName: claimNames.groupA,
      groupBName: claimNames.groupB,
      groupCName: claimNames.groupC,
      defaultGroupRef,
    },
  );

  if (include.groups) {
    fixtures.push(
      buildGroupFixture('group-a', claimNames.groupA),
      buildGroupFixture('group-b', claimNames.groupB, parentRefs.groupBParent),
      buildGroupFixture('group-c', claimNames.groupC, parentRefs.groupCParent),
    );
  }

  if (include.components) {
    for (const variant of COMPONENT_VARIANTS) {
      const claimName =
        variant.fixtureSuffix === 'frontend'
          ? claimNames.frontend
          : claimNames.backend;
      fixtures.push(
        buildComponentFixture(claimName, variant, componentRelationships),
      );
    }
  }

  return fixtures;
}

/**
 * Builds a deterministic fixture set for organization bootstrap tests.
 *
 * Pass `client.getPrefix()` as the prefix - the internal `e2e-` wrapping is
 * applied automatically so generated monikers align with the claim names that
 * renderLocally will produce. Optional exclusions allow omitting claim
 * categories while keeping cross-reference integrity.
 *
 * The returned `fixtures` array contains one entry per renderable base-claim
 * file (currently groups and components), ready to pass directly to
 * renderLocally - no manual fixture table needed in tests.
 */
export function orgScript(
  prefix: string,
  options: OrgScriptOptions = {},
): OrgScript {
  const normalizedPrefix = normalizeNamePrefix(prefix);
  const scriptPrefix = buildE2ePrefix(normalizedPrefix);
  const exclude = options.exclude ?? {};
  const include = buildIncludeFlags(exclude);
  const org = options.org ?? DEFAULT_E2E_ORG;
  const componentsDefaultGroupRef = resolveComponentsDefaultGroupRef(
    include,
    options,
  );
  const allMonikers = buildAllMonikers(scriptPrefix);
  const claims = createEmptyClaims();

  if (include.groups) {
    claims.groups = buildGroups(allMonikers, org);
  }

  if (include.components) {
    claims.components = buildComponents(
      allMonikers,
      org,
      {
        groups: include.groups,
      },
      componentsDefaultGroupRef,
    );
  }

  return {
    monikers: buildMonikers(allMonikers, include),
    claims,
    fixtures: buildFixtures(
      normalizedPrefix,
      include,
      componentsDefaultGroupRef,
    ),
  };
}
