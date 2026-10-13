export {
  CleanupRunner,
  cleanupRenderedArtifacts,
  destroyClusterFixtureResources,
  destroyFixtureResources,
  destroyOrgFixtureResources,
  destroyOrgResources,
} from './src/cleanup';

export {
  buildE2ePrefix,
  createNameBuilder,
  normalizeNamePrefix,
  resolveNamePrefix,
} from './src/names';

export {
  resolveE2eBaseClaimsPath,
  resolveE2eFixturesPath,
  resolveE2eProviderConfigsPath,
} from './src/fixtures-path';
export { createTestContext } from './src/test-context';
export { prepareProviderConfigManifests } from './src/provider-configs';

export { initE2e } from './src/api';
export {
  E2E_DIAGNOSTIC_BEGIN,
  E2E_DIAGNOSTIC_END,
} from './src/k8s/diagnostics';
export { ensureDefaultGroup } from './src/default-group';
export { waitForOrgWebhookState } from './src/gh/wait';
export { createTempOpaqueSecret } from './src/temp-secret';

export { orgScript } from './src/org-script';
export {
  applyAndWaitCrPaths,
  renderApplyAndWaitFixtures,
  type FixturePatchesByClaimName,
} from './src/render-apply-fixtures';

export type {
  ClaimsApi,
  E2EApi,
  E2EInitOptions,
  GhApi,
  GhOrgSettings,
  GhOrgVariable,
  GhOrgWebhook,
  GhRepoLabel,
  JsonPatchOperation,
  K8sApi,
  RenderLocallyOptions,
  RenderLocallyResult,
  TestContext,
} from './src/types';

export type { TempOpaqueSecret } from './src/temp-secret';

export type { OrgScriptFixture, OrgScriptOptions } from './src/org-script';

export type {
  DestroyFixtureResourcesOptions,
  DestroyOrgResourcesOptions,
  FixtureResource,
  FixtureResourceInput,
} from './src/cleanup';
