import {
  renderDotFirestartrApp,
  renderMakeDispatches,
  renderServiceClaimFeatures,
  renderStateAppClaim,
  renderStateAppTargets,
  renderStateArgocd,
} from '../render/index.js';
import {
  extractClaimVarsAndSecrets,
  requiredStateAppRegistryVarsAndSecrets,
  type NameValueEntry,
} from './requiredVars.js';

import type {
  PlanRepoFiles,
  PlanSchemaDirs,
  ResolvedPlanContext,
} from './types.js';
import type { DiscoveredRegistry } from '../dotFirestartr.js';
import type { RenderedFile } from '../render/index.js';

function registryHasOciCharts(registry: DiscoveredRegistry): boolean {
  return (
    !Array.isArray(registry.base_paths) &&
    typeof registry.base_paths.charts === 'string' &&
    registry.base_paths.charts.trim().length > 0
  );
}

function collectCopiedVarsAndSecrets(
  context: ResolvedPlanContext,
  registry: DiscoveredRegistry | undefined,
): { copiedVars: NameValueEntry[]; copiedSecrets: NameValueEntry[] } {
  if (context.orgPlan !== 'free' || !registry) {
    return { copiedVars: [], copiedSecrets: [] };
  }

  const needed = requiredStateAppRegistryVarsAndSecrets(
    registry.auth_strategy,
    registryHasOciCharts(registry),
  );
  const serviceEntries = extractClaimVarsAndSecrets(
    context.serviceClaimContent,
  );

  const copiedVars: NameValueEntry[] = [];
  for (const name of needed.vars) {
    const value = serviceEntries.vars.get(name);
    if (value !== undefined) {
      copiedVars.push({ name, value });
    }
  }

  const copiedSecrets: NameValueEntry[] = [];
  for (const name of needed.secrets) {
    const value = serviceEntries.secrets.get(name);
    if (value !== undefined) {
      copiedSecrets.push({ name, value });
    }
  }

  return { copiedVars, copiedSecrets };
}

export async function renderPlanFiles(
  context: ResolvedPlanContext,
  schemaDirs: PlanSchemaDirs,
): Promise<PlanRepoFiles> {
  const { inputs, dotFirestartr } = context;
  const registry = dotFirestartr.registries.find(
    (r) => r.name === inputs.chart.registry,
  );

  const { copiedVars, copiedSecrets } = collectCopiedVarsAndSecrets(
    context,
    registry,
  );

  const stateAppClaimFile = await renderStateAppClaim({
    inputs,
    serviceClaim: context.serviceClaimDefaults,
    stateRepoAppsMajor: context.featureMajors.state_repo_apps,
    claimSchemasDir: schemaDirs.claimSchemasDir,
    existingContent: context.existingStateAppClaim?.content,
    orgPlan: context.orgPlan,
    copiedVars,
    copiedSecrets,
  });

  const serviceClaimFile: RenderedFile = registry
    ? renderServiceClaimFeatures({
        org: context.org,
        inputs,
        existingContent: context.serviceClaimContent,
        path: context.serviceClaimPath,
        authStrategy: registry.auth_strategy,
        featureMajors: {
          build_and_dispatch_docker_images:
            context.featureMajors.build_and_dispatch_docker_images,
          release_please: context.featureMajors.release_please,
        },
        featureSchemas: {
          build_and_dispatch_docker_images:
            context.featureSchemas.build_and_dispatch_docker_images,
          release_please: context.featureSchemas.release_please,
        },
        defaultFilters: context.defaultFilters,
      })
    : {
        path: context.serviceClaimPath,
        outcome: {
          kind: 'conflict',
          reason: `Registry alias "${inputs.chart.registry}" not found in .firestartr`,
        },
      };

  const dotFirestartrFile = renderDotFirestartrApp({
    org: context.org,
    inputs,
    schemasDir: schemaDirs.dotFirestartrSchemasDir,
    existingContent: context.existingDotFirestartrApp,
  });

  let stateAppFiles: RenderedFile[];
  try {
    stateAppFiles = renderStateAppTargets({
      inputs,
      registries: dotFirestartr.registries,
      schemasDir: schemaDirs.dotFirestartrSchemasDir,
      existingFiles: context.existingStateAppFiles,
    });
  } catch (error) {
    stateAppFiles = [
      {
        path: `kubernetes/${inputs.targets[0]?.platform ?? 'unknown'}`,
        outcome: {
          kind: 'conflict',
          reason: error instanceof Error ? error.message : String(error),
        },
      },
    ];
  }

  let stateArgocdFiles: RenderedFile[];
  try {
    const argocd = renderStateArgocd({
      org: context.org,
      inputs,
      platforms: dotFirestartr.platforms,
      vendorDir: schemaDirs.vendorDir,
      existingApplicationSet: context.existingArgocdApplicationSet,
      existingAppProject: context.existingArgocdAppProject,
    });
    stateArgocdFiles = [argocd.applicationSet, argocd.appProject];
  } catch (error) {
    stateArgocdFiles = [
      {
        path: `apps/${inputs.app}/argo-${inputs.app}.ApplicationSet.yaml`,
        outcome: {
          kind: 'conflict',
          reason: error instanceof Error ? error.message : String(error),
        },
      },
    ];
  }

  const makeDispatchesFile = renderMakeDispatches({
    org: context.org,
    inputs,
    defaultBranch: context.serviceDefaultBranch,
    actionsSchemasDir: schemaDirs.actionsSchemasDir,
    existingContent: context.existingMakeDispatches,
  });

  return {
    claims: [stateAppClaimFile, serviceClaimFile],
    dotFirestartr: [dotFirestartrFile],
    stateApp: stateAppFiles,
    stateArgocd: stateArgocdFiles,
    service: [makeDispatchesFile],
  };
}
