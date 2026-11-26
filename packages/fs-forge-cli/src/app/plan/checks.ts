import YAML from 'yaml';

import { claimExists } from '../../claims/claimsMap.js';
import { loadActionsValidator } from '../../schema/actionsSchemas.js';
import { formatAjvErrors } from '../../utils/ajvValidation.js';
import { isRecord } from '../../utils/isRecord.js';
import {
  CORE_STATE_APP_SECRET_NAMES,
  CORE_STATE_APP_VAR_NAMES,
  extractClaimVarsAndSecrets,
  requiredServiceVarsAndSecrets,
  requiredStateAppRegistryVarsAndSecrets,
} from './requiredVars.js';

import type {
  PlanCheck,
  PlanSchemaDirs,
  PlanTargetRepo,
  ResolvedPlanContext,
} from './types.js';
import type { AppTrack } from '../../schema/appInputs.js';
import type { DiscoveredRegistry } from '../dotFirestartr.js';

function trackImageType(track: AppTrack): 'snapshots' | 'releases' {
  return track === 'releases' ? 'releases' : 'snapshots';
}

function registryHasOciCharts(registry: DiscoveredRegistry): boolean {
  return (
    !Array.isArray(registry.base_paths) &&
    typeof registry.base_paths.charts === 'string' &&
    registry.base_paths.charts.trim().length > 0
  );
}

function checkClaimName(context: ResolvedPlanContext): PlanCheck {
  const claimName = `app-${context.inputs.app}`;
  if (!claimExists(context.claimsMap, 'ComponentClaim', claimName)) {
    return {
      id: 'claim-name',
      status: 'pass',
      message: `ComponentClaim "${claimName}" is available in ${context.org}/${context.claimsRepoName}.`,
    };
  }
  if (context.existingStateAppClaim?.isStateRepoClaim) {
    return {
      id: 'claim-name',
      status: 'pass',
      message: `ComponentClaim "${claimName}" already exists as a state-repo claim for this App.`,
    };
  }
  return {
    id: 'claim-name',
    status: 'fail',
    message: `ComponentClaim "${claimName}" already exists in ${context.org}/${context.claimsRepoName} but is not a state_repo_apps claim.`,
    checklist: [
      `Choose a different app name or convert "${claimName}" into a state_repo_apps ComponentClaim.`,
    ],
  };
}

function checkRegistryAndPlatforms(context: ResolvedPlanContext): PlanCheck {
  const { inputs, dotFirestartr } = context;
  const issues: string[] = [];

  const registry = dotFirestartr.registries.find(
    (r) => r.name === inputs.chart.registry,
  );
  if (!registry) {
    issues.push(
      `Registry alias "${inputs.chart.registry}" not found in .firestartr/docker_registries/.`,
    );
  }

  for (const target of inputs.targets) {
    const platform = dotFirestartr.platforms.find(
      (p) => p.name === target.platform,
    );
    if (!platform) {
      issues.push(
        `Platform "${target.platform}" not found in .firestartr/platforms/.`,
      );
      continue;
    }
    if (!platform.tenants.includes(target.tenant)) {
      issues.push(
        `Tenant "${target.tenant}" is not listed in .firestartr/platforms/${target.platform}.yaml.`,
      );
    }
    if (!platform.envs.includes(target.env)) {
      issues.push(
        `Env "${target.env}" is not listed in .firestartr/platforms/${target.platform}.yaml.`,
      );
    }
  }

  if (issues.length === 0) {
    return {
      id: 'registry-and-platforms',
      status: 'pass',
      message: `Registry "${inputs.chart.registry}" and all target platforms/tenants/envs exist in .firestartr.`,
    };
  }
  return {
    id: 'registry-and-platforms',
    status: 'fail',
    message: issues.join(' '),
    checklist: issues,
  };
}

function checkImageTypes(context: ResolvedPlanContext): PlanCheck {
  const { inputs, dotFirestartr } = context;
  const registry = dotFirestartr.registries.find(
    (r) => r.name === inputs.chart.registry,
  );
  if (!registry) {
    return {
      id: 'image-types',
      status: 'fail',
      message: `Cannot verify image_types: registry "${inputs.chart.registry}" not found in .firestartr.`,
      checklist: [
        `Add registry "${inputs.chart.registry}" to .firestartr/docker_registries/.`,
      ],
    };
  }

  const neededTypes = new Set(
    inputs.targets.map((t) => trackImageType(t.track)),
  );
  const missing = [...neededTypes].filter(
    (type) => !registry.image_types.includes(type),
  );
  if (missing.length === 0) {
    return {
      id: 'image-types',
      status: 'pass',
      message: `Registry "${registry.name}" supports required image_types (${[...neededTypes].join(', ')}).`,
    };
  }
  return {
    id: 'image-types',
    status: 'fail',
    message: `Registry "${registry.name}" does not support image_types: ${missing.join(', ')}.`,
    checklist: [
      `Add ${missing.join(', ')} to image_types in .firestartr/docker_registries/${registry.name}.yaml or choose another registry.`,
    ],
  };
}

function checkArgoNotificationsApp(context: ResolvedPlanContext): PlanCheck {
  const stateRepo = `${context.org}/app-${context.inputs.app}`;
  return {
    id: 'argo-notifications-app',
    status: 'info',
    message: `Cannot verify ArgoCD notifications GitHub App access to ${stateRepo} with the CLI token (requires org-admin installation permissions).`,
    checklist: [
      `Confirm the ArgoCD notifications GitHub App (fs-argocd-notifications) has access to ${stateRepo}.`,
    ],
  };
}

function checkVarsAndSecrets(context: ResolvedPlanContext): PlanCheck[] {
  const registry = context.dotFirestartr.registries.find(
    (r) => r.name === context.inputs.chart.registry,
  );
  const authStrategy = registry?.auth_strategy ?? '';
  const ociCharts = registry ? registryHasOciCharts(registry) : true;

  const serviceRequired = requiredServiceVarsAndSecrets(authStrategy);
  const stateAppRegistryRequired = requiredStateAppRegistryVarsAndSecrets(
    authStrategy,
    ociCharts,
  );

  if (context.orgPlan === 'unknown') {
    return [
      {
        id: 'vars-and-secrets',
        status: 'fail',
        message: `Could not detect GitHub plan for org "${context.org}" (API returned 403 or omitted plan). Rendered files assume a paid plan; ask an org owner to confirm whether the org is on a free or paid plan and re-run with --org-plan.`,
        checklist: [
          `Ask an org owner to confirm whether "${context.org}" is on a free or paid GitHub plan, then re-run with --org-plan.`,
        ],
      },
    ];
  }

  if (context.orgPlan === 'paid') {
    const orgVars = [
      ...new Set([
        ...CORE_STATE_APP_VAR_NAMES,
        ...serviceRequired.vars,
        ...stateAppRegistryRequired.vars,
      ]),
    ];
    const orgSecrets = [
      ...new Set([
        ...CORE_STATE_APP_SECRET_NAMES,
        ...serviceRequired.secrets,
        ...stateAppRegistryRequired.secrets,
      ]),
    ];
    return [
      {
        id: 'vars-and-secrets',
        status: 'info',
        message: `Org "${context.org}" is on a paid plan: confirm required Actions vars and secrets are set at org level.`,
        checklist: [
          `Confirm org-level Actions vars: ${orgVars.join(', ')}.`,
          `Confirm org-level Actions secrets: ${orgSecrets.join(', ')}.`,
        ],
      },
    ];
  }

  // Free plan: fail per missing var/secret on the Service claim and app-<app>.
  const serviceEntries = extractClaimVarsAndSecrets(
    context.serviceClaimContent,
  );
  const checks: PlanCheck[] = [];

  for (const name of serviceRequired.vars) {
    if (!serviceEntries.vars.has(name)) {
      checks.push({
        id: `vars-service-${name}`,
        status: 'fail',
        message: `Missing Actions var "${name}" on Service ComponentClaim "${context.serviceRepoName}".`,
        checklist: [
          `Add Actions var "${name}" to ${context.serviceClaimPath}.`,
        ],
      });
    }
  }
  for (const name of serviceRequired.secrets) {
    if (!serviceEntries.secrets.has(name)) {
      checks.push({
        id: `secrets-service-${name}`,
        status: 'fail',
        message: `Missing Actions secret "${name}" on Service ComponentClaim "${context.serviceRepoName}".`,
        checklist: [
          `Add Actions secret "${name}" to ${context.serviceClaimPath}.`,
        ],
      });
    }
  }

  if (context.existingStateAppClaim) {
    // Existing app-<app> claim is not edited for vars/secrets on a free plan:
    // check every needed state-app var and secret against the existing app claim itself.
    const stateAppEntries = extractClaimVarsAndSecrets(
      context.existingStateAppClaim.content,
    );
    const neededStateAppVars = [
      ...new Set([
        ...CORE_STATE_APP_VAR_NAMES,
        ...stateAppRegistryRequired.vars,
      ]),
    ];
    const neededStateAppSecrets = [
      ...new Set([
        ...CORE_STATE_APP_SECRET_NAMES,
        ...stateAppRegistryRequired.secrets,
      ]),
    ];

    for (const name of neededStateAppVars) {
      if (!stateAppEntries.vars.has(name)) {
        checks.push({
          id: `vars-state-app-${name}`,
          status: 'fail',
          message: `Missing Actions var "${name}" on existing ComponentClaim "app-${context.inputs.app}".`,
          checklist: [
            `Add Actions var "${name}" to ${context.existingStateAppClaim.path}.`,
          ],
        });
      }
    }
    for (const name of neededStateAppSecrets) {
      if (!stateAppEntries.secrets.has(name)) {
        checks.push({
          id: `secrets-state-app-${name}`,
          status: 'fail',
          message: `Missing Actions secret "${name}" on existing ComponentClaim "app-${context.inputs.app}".`,
          checklist: [
            `Add Actions secret "${name}" to ${context.existingStateAppClaim.path}.`,
          ],
        });
      }
    }
  } else {
    // Creating app-<app>: core six are rendered automatically on a free plan;
    // registry/cloud vars are copied from the Service claim.
    for (const name of stateAppRegistryRequired.vars) {
      if (!serviceEntries.vars.has(name)) {
        checks.push({
          id: `vars-state-app-${name}`,
          status: 'fail',
          message: `Missing Actions var "${name}" needed for app-${context.inputs.app} (not found on Service claim "${context.serviceRepoName}").`,
          checklist: [
            `Supply Actions var "${name}" for app-${context.inputs.app}.`,
          ],
        });
      }
    }
    for (const name of stateAppRegistryRequired.secrets) {
      if (!serviceEntries.secrets.has(name)) {
        checks.push({
          id: `secrets-state-app-${name}`,
          status: 'fail',
          message: `Missing Actions secret "${name}" needed for app-${context.inputs.app} (not found on Service claim "${context.serviceRepoName}").`,
          checklist: [
            `Supply Actions secret "${name}" for app-${context.inputs.app}.`,
          ],
        });
      }
    }
  }

  if (checks.length === 0) {
    return [
      {
        id: 'vars-and-secrets',
        status: 'pass',
        message: `All required Actions vars and secrets for "${context.serviceRepoName}" and "app-${context.inputs.app}" are present.`,
      },
    ];
  }
  return checks;
}

function checkBuildImages(
  context: ResolvedPlanContext,
  schemaDirs: PlanSchemaDirs,
): PlanCheck {
  const { existingBuildImages, inputs } = context;
  if (existingBuildImages === undefined) {
    return {
      id: 'build-images',
      status: 'fail',
      message: `.github/build_images.yaml is missing in ${context.serviceRepoOwner}/${context.serviceRepoName}.`,
      checklist: [
        `Create .github/build_images.yaml in ${context.serviceRepoOwner}/${context.serviceRepoName} with the required flavors.`,
      ],
    };
  }

  const doc = YAML.parseDocument(existingBuildImages);
  if (doc.errors.length > 0) {
    return {
      id: 'build-images',
      status: 'fail',
      message: `Malformed YAML in .github/build_images.yaml: ${doc.errors[0].message}`,
      checklist: [
        `Fix YAML syntax in .github/build_images.yaml in ${context.serviceRepoOwner}/${context.serviceRepoName}.`,
      ],
    };
  }

  const parsed: unknown = doc.toJS();
  if (!isRecord(parsed)) {
    return {
      id: 'build-images',
      status: 'fail',
      message: 'Expected YAML mapping in .github/build_images.yaml.',
      checklist: [
        `Fix .github/build_images.yaml in ${context.serviceRepoOwner}/${context.serviceRepoName} so it is a valid YAML mapping.`,
      ],
    };
  }

  const validate = loadActionsValidator(
    'build_images',
    schemaDirs.actionsSchemasDir,
  );
  if (!validate(parsed)) {
    const errors = formatAjvErrors(validate.errors);
    return {
      id: 'build-images',
      status: 'fail',
      message: `.github/build_images.yaml failed schema validation: ${errors.join('; ')}`,
      checklist: [
        `Fix schema validation errors in .github/build_images.yaml: ${errors.join('; ')}`,
      ],
    };
  }

  const missingFlavors: string[] = [];
  const seen = new Set<string>();
  for (const target of inputs.targets) {
    const type = trackImageType(target.track);
    const flavor = target.flavor ?? 'default';
    const key = `${type}.${flavor}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const section = parsed[type];
    if (
      !isRecord(section) ||
      !Object.prototype.hasOwnProperty.call(section, flavor)
    ) {
      missingFlavors.push(key);
    }
  }

  if (missingFlavors.length > 0) {
    return {
      id: 'build-images',
      status: 'fail',
      message: `.github/build_images.yaml is missing flavor(s): ${missingFlavors.join(', ')}.`,
      checklist: missingFlavors.map(
        (key) =>
          `Add flavor "${key}" to .github/build_images.yaml in ${context.serviceRepoOwner}/${context.serviceRepoName}.`,
      ),
    };
  }

  return {
    id: 'build-images',
    status: 'pass',
    message:
      '.github/build_images.yaml is valid and defines all required flavors.',
  };
}

function checkTargetRepo(
  id: string,
  repoSlug: string,
  repo: PlanTargetRepo,
): PlanCheck {
  if (repo.archived) {
    return {
      id,
      status: 'fail',
      message: `Repository ${repoSlug} is archived and must be unarchived before applying this plan.`,
      checklist: [`Unarchive repository ${repoSlug} before running app apply.`],
    };
  }
  if (repo.exists) {
    return {
      id,
      status: 'pass',
      message: `Repository ${repoSlug} exists.`,
    };
  }
  return {
    id,
    status: 'fail',
    message: `Repository ${repoSlug} does not exist and must exist before applying this plan.`,
    checklist: [`Create repository ${repoSlug} before running app apply.`],
  };
}

export function runPlanChecks(
  context: ResolvedPlanContext,
  schemaDirs: PlanSchemaDirs,
): PlanCheck[] {
  return [
    checkTargetRepo(
      'dot-firestartr-repo',
      `${context.org}/.firestartr`,
      context.repoState.dotFirestartr,
    ),
    checkTargetRepo(
      'state-argocd-repo',
      `${context.org}/state-argocd`,
      context.repoState.stateArgocd,
    ),
    checkTargetRepo(
      'service-repo',
      `${context.serviceRepoOwner}/${context.serviceRepoName}`,
      context.repoState.service,
    ),
    checkClaimName(context),
    checkRegistryAndPlatforms(context),
    checkImageTypes(context),
    checkBuildImages(context, schemaDirs),
    checkArgoNotificationsApp(context),
    ...checkVarsAndSecrets(context),
  ];
}
