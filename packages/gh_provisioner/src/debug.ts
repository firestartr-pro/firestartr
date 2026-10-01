import path from 'path';
import { writeFile, rm, mkdir } from 'node:fs/promises';

import { Entity } from './entities';

import { Dependencies } from './refs';

import common from 'catalog_common';
import os from 'os';

import log from './logger';

const DEBUG_DIR = path.join(os.tmpdir(), 'gh-debug');

// Returns the project path to use for debug artifacts (always SessionProjectPath for consistency)
function getDebugProjectPath(entity: Entity) {
  // Use the sessionProjectPath if present. sessionProjectPath will include
  // the tfStateKey suffix when in debug mode, as set by runGhProvisioner.
  return (
    entity.sessionProjectPath ||
    path.join(DEBUG_DIR, entity.k8sId.replace(/\//, '-') + '-id_missing')
  );
}

export async function initDebug(entity: Entity, deps: Dependencies) {
  // If a previous deterministic debug folder exists for this resource, wipe it
  // We intentionally remove only the per-claim debug folder (the whole folder)
  // to ensure a fresh debug run and avoid accumulating files between runs.
  await rm(getDebugProjectPath(entity), { recursive: true, force: true });
  // Create the (fresh) project path and debug artifacts dir
  await mkdir(getDebugProjectPath(entity), { recursive: true });
  const debugArtifactsDir = path.join(
    getDebugProjectPath(entity),
    'gh_provisioner_debug',
  );
  await mkdir(debugArtifactsDir, { recursive: true });

  // Write artifact files into the required debug project subdirectory
  await writeFile(
    path.join(debugArtifactsDir, 'cr.yaml'),
    common.io.toYaml(entity.cr.rawCr),
  );

  await writeFile(
    path.join(debugArtifactsDir, 'deps.yaml'),
    common.io.toYaml(deps),
  );

  log.enableFileLogging(path.join(debugArtifactsDir, 'debug.log'));
}

// Deprecated: Use getDebugProjectPath in all debug logic
export function getTFProjectPath(entity: Entity) {
  return getDebugProjectPath(entity);
}

export async function debugTerraformOutput(entity: Entity, output: string) {
  const pathToOutput = path.join(
    getDebugProjectPath(entity),
    'terraform-output.txt',
  );

  await writeFile(pathToOutput, output);

  log.debug(
    `[gh-provisioner] debug: Terraform error written to ${pathToOutput}`,
  );
}

export async function endDebug(entity: Entity) {
  await writeFile(
    path.join(getDebugProjectPath(entity), 'config.json'),
    JSON.stringify(entity.document, null, 4),
  );

  log.disableFileLogging();
}
