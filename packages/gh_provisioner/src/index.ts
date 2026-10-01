import { initDepsSystem, initDepsSystemFromMemory, refResolver } from './refs';

import { Entity, getEntity } from './entities';

import common from 'catalog_common';

import log from './logger';

import { readFile } from 'node:fs/promises';

// from memory ( no files involved )
export async function initSystem(cr: any, deps: any) {
  await initDepsSystemFromMemory(deps);

  Entity.setRefResolver(refResolver);

  return getEntity(cr);
}

export async function initSystemFS(crPath: string, depsPath: string) {
  await initDepsSystem(depsPath);

  Entity.setRefResolver(refResolver);

  const cr = await loadCr(crPath);

  return getEntity(cr);
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
