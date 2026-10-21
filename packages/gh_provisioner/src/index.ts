import { loadDependencies } from './refs';

import { getEntity } from './entities';

import common from 'catalog_common';

import log from './logger';

import { readFile } from 'node:fs/promises';

// from memory ( no files involved )
export async function initSystem(cr: any, deps: any) {
  return getEntity(cr, deps ?? {});
}

export async function initSystemFS(crPath: string, depsPath: string) {
  log.info(`[gh-provisioner] loading dependencies from ${depsPath}`);

  const deps = await loadDependencies(depsPath);

  const cr = await loadCr(crPath);

  return getEntity(cr, deps);
}

async function loadCr(crPath: string) {
  const entityCr: any = common.io.fromYaml(
    await readFile(
      crPath,

      'utf8',
    ),
  );

  return entityCr;
}
