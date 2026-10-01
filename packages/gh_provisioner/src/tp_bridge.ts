// Bridge to terraform provisioner

import { Entity } from './entities';

import log from './logger';

import path from 'path';

import { runTerraformProvisioner } from 'terraform_provisioner';

import { adaptProviders, adaptBackend } from './providers';

import { getTFProjectPath } from './debug';

const TF_PROJECTS_PATH = '/tmp/gh-workspaces';
const KUBERNETES_LABEL_VALUE_MAX_LENGTH = 63;

export async function runOnTerraform(
  entity: Entity,
  command: string,
  customArgs?: any[],
  opts: any = {},
) {
  if (!entity || typeof entity !== 'object')
    throw new Error('[BUG] entity is invalid in runOnTerraform');
  // Workspace session/reuse logic
  let reuseExistingProject = false;
  if (entity.__ghProvisionerSessionWorkspaceInitialized) {
    reuseExistingProject = true;
  }
  // Mark the session workspace as initialized after the first non-destroy, non-output, non-debug call
  const isWorkspaceInitializingCommand = ![
    'output',
    'tear-up-project',
    'debug',
  ].includes(command);

  log.info(
    `Running on terraform entity '${entity.k8sId}' with command '${command}' customArgs = ${customArgs ? customArgs.join(',') : 'null'} `,
  );

  const streaming = entity.streamTFProvisioner;

  if (command === 'import-with-reimport') {
    // Step 1: nuke the tf state via destroy-state-only
    await runTerraformProvisioner(
      buildContext(entity, false),
      'destroy-state-only',
      streaming,
      customArgs,
      opts.ctl,
    );

    // Step 2: load new addresses to import
    await entity.loadAddressesToImport();

    // Step 3: custom-import with correct reuse flag
    const importResult = await runTerraformProvisioner(
      buildContext(
        entity,
        !!entity.__ghProvisionerSessionWorkspaceInitialized,
        true,
      ),
      'custom-import',
      streaming,
      entity.importDocument,
      opts.ctl,
    );
    entity.__ghProvisionerSessionWorkspaceInitialized = true;
    return importResult;
  } else if (command === 'import') {
    // we get the elements we need to import
    await entity.loadAddressesToImport();

    const importResult = await runTerraformProvisioner(
      buildContext(
        entity,
        !!entity.__ghProvisionerSessionWorkspaceInitialized,
        true,
      ),
      'custom-import',
      streaming,
      entity.importDocument,
      opts.ctl,
    );
    entity.__ghProvisionerSessionWorkspaceInitialized = true;
    return importResult;
  } else {
    // For import-like commands, set importMode automatically
    const importCommands = ['import-with-reimport', 'custom-import', 'import'];
    const isImportLike = importCommands.includes(command);
    // Always force importMode=true for all import-like commands.

    // Apply-time adoption: when an apply runs and the entity has pending import
    // entries (e.g. labels that already exist on GitHub), the bridge runs the
    // regular apply with importMode=true. Import blocks are evaluated and
    // consumed by the same single apply, importing pre-existing resources into
    // state and reconciling them in one step.
    //
    // See ADR 0006: Apply-time adoption of existing GitHub resources via import blocks.
    const importDoc = entity.importDocument;
    if (command === 'apply' && importDoc.imports.length > 0) {
      const importResult = await runTerraformProvisioner(
        buildContext(entity, reuseExistingProject, true),
        'apply',
        streaming,
        importDoc,
        opts.ctl,
      );
      entity.__ghProvisionerSessionWorkspaceInitialized = true;
      return importResult;
    }

    const result = await runTerraformProvisioner(
      buildContext(entity, reuseExistingProject, isImportLike ? true : false),
      command,
      streaming,
      customArgs,
      opts.ctl,
    );
    if (
      !entity.__ghProvisionerSessionWorkspaceInitialized &&
      isWorkspaceInitializingCommand
    ) {
      entity.__ghProvisionerSessionWorkspaceInitialized = true;
    }
    return result;
  }
}

export function buildContext(
  entity: Entity,
  reuseExistingProjectOverride = false,
  importMode = false,
) {
  log.info(`Building terraform provisioner's context for ${entity.k8sId}`);

  const result = adaptProviders(entity);

  const projectPath = entity.sessionProjectPath
    ? entity.sessionProjectPath // Always use session projectPath if present
    : entity.inDebugMode
      ? getTFProjectPath(entity)
      : path.join(
          TF_PROJECTS_PATH,
          `${entity.cr.kind.toLowerCase()}-${entity.cr.name}-${entity.sessionId ?? 'unknown'}`,
        );
  const backend = adaptBackend(entity);

  return {
    type: 'Remote',
    inline: entity.terraformModuleAsURL,
    module: entity.terraformModuleAsURL,
    values: entity.document,
    requiredProviders: result.providers,
    secrets: result.secrets,
    backend,
    tfStateKey: entity.tfStateKey,
    tfStatePath: calculateTFStatePath(entity, backend),
    references: {},
    projectPath,
    reuseExistingProject: reuseExistingProjectOverride ? true : undefined, // only set if true
    importMode: importMode === true,
  };
}

export function calculateTFStatePath(entity: Entity, backend: any) {
  let tfStatePath: string;

  log.debug(
    `Calculating tfStatePath for ${entity.k8sId} with backend ${JSON.stringify(backend)}`,
  );

  if (entity.cr.kind === 'FirestartrGithubRepositoryFeature') {
    if ('kubernetes' in backend) {
      // we should short it to a maximum of 63 characters to avoid issues with terraform state file names
      tfStatePath = `ghfeat/${entity.cr.name}`.substring(0, 63);
    } else {
      tfStatePath = `${entity.cr.kind.toLowerCase()}/${entity.cr.name}`;
    }
  } else if (
    entity.cr.kind === 'FirestartrGithubRepositorySecretsSection' &&
    'kubernetes' in backend
  ) {
    // we should short it to a maximum of 63 characters to avoid issues with terraform state file names
    tfStatePath = `grss/${entity.cr.spec.firestartr.tfStateKey}`.substring(
      0,
      63,
    );
  } else {
    const kind = entity.cr.kind.toLowerCase();
    const tfStateKey = entity.cr.spec.firestartr.tfStateKey;
    tfStatePath = `${kind}/${tfStateKey}`;

    if ('kubernetes' in backend) {
      tfStatePath = fitKubernetesBackendLabel(tfStatePath, kind, tfStateKey);
    }
  }

  log.debug(
    `[gh-provisioner] tfStateKey for ${entity.k8sId} = '${tfStatePath}'`,
  );

  return tfStatePath;
}

function fitKubernetesBackendLabel(
  tfStatePath: string,
  kind: string,
  tfStateKey: string,
) {
  if (
    tfStatePath.split('/').join('-').length <= KUBERNETES_LABEL_VALUE_MAX_LENGTH
  ) {
    return tfStatePath;
  }

  const tfStateKeyLabelLength = tfStateKey.split('/').join('-').length;
  const maxKindLength =
    KUBERNETES_LABEL_VALUE_MAX_LENGTH - tfStateKeyLabelLength - 1;

  if (maxKindLength < 1) {
    return tfStateKey.substring(0, KUBERNETES_LABEL_VALUE_MAX_LENGTH);
  }

  return `${kind.substring(0, maxKindLength)}/${tfStateKey}`;
}
