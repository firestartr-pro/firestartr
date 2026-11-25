import { runPlanChecks } from './checks.js';
import { renderPlanFiles } from './render.js';
import { resolvePlanContext, type ResolvePlanOptions } from './resolve.js';

import type { AppPlanResult, PlanSchemaDirs } from './types.js';

export { runPlanChecks } from './checks.js';
export { renderPlanFiles } from './render.js';
export {
  CORE_STATE_APP_SECRET_NAMES,
  CORE_STATE_APP_VAR_NAMES,
  coreStateAppSecrets,
  coreStateAppVars,
  extractClaimVarsAndSecrets,
  requiredServiceVarsAndSecrets,
  requiredStateAppRegistryVarsAndSecrets,
} from './requiredVars.js';
export type { NameValueEntry, RequiredVarsAndSecrets } from './requiredVars.js';
export { resolvePlanContext } from './resolve.js';
export type { ResolvePlanOptions } from './resolve.js';
export {
  appPlanHeadBranch,
  buildPlanJsonOutput,
  buildPlanSteps,
  collectPlanConflicts,
  formatPlanText,
  writePlanOutputFiles,
} from './steps.js';
export type {
  AppPlanJsonOutput,
  PlanConflict,
  PlanRepoEntry,
  PlanStep,
  PlanStepFile,
} from './steps.js';
export type {
  AppPlanResult,
  ExistingNamedFile,
  ExistingStateAppClaim,
  PlanCheck,
  PlanCheckStatus,
  PlanDefaultBranches,
  PlanRepoFiles,
  PlanSchemaDirs,
  ResolvedPlanContext,
} from './types.js';

export interface PlanAppOptions extends ResolvePlanOptions {
  schemaDirs: PlanSchemaDirs;
}

export async function planApp(options: PlanAppOptions): Promise<AppPlanResult> {
  const { schemaDirs, ...resolveOptions } = options;
  const context = await resolvePlanContext(resolveOptions);
  const [files, checks] = await Promise.all([
    renderPlanFiles(context, schemaDirs),
    Promise.resolve(runPlanChecks(context, schemaDirs)),
  ]);
  return { context, files, checks };
}
