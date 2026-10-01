export interface DestroyOrgResourcesOptions {
  // Org cleanup only: when true, also target resources matching "<base>-<uuid>"
  // in addition to exact base names. Default is false.
  includePrefixed?: boolean;

  // When true, fail fast on list/delete errors.
  // When false (default), cleanup is best-effort.
  strict?: boolean;

  // Additional org webhook delivery URLs to delete explicitly.
  // Useful for fixtures whose webhook URL is patched at test runtime.
  orgWebhookUrls?: string[];
}

export interface DestroyFixtureResourcesOptions extends DestroyOrgResourcesOptions {
  // Delete stale cluster-scoped CRs derived from fixture claims. Default is true.
  deleteCluster?: boolean;

  // Delete stale org resources (groups/repos) derived from fixture claims.
  // Default is true.
  deleteOrg?: boolean;

  // Prefix used in cleanup logs. Default is "e2e-fixture-cleanup".
  logPrefix?: string;
}

export interface FixtureResource {
  // Fixture key used to derive claim names and route cleanup behavior.
  fixtureName: string;

  // Optional explicit claim name override.
  // If omitted or blank after trim, claimName is generated from prefix + fixtureName
  // via the shared name builder (for example: "<prefix>-e2e-<fixture>" or
  // "e2e-<fixture>" when no prefix is set).
  claimName?: string;
}

// String shorthand means fixtureName only (for example: "group-root").
// Object form allows claimName override when a test needs a specific claim id.
export type FixtureResourceInput = string | FixtureResource;
