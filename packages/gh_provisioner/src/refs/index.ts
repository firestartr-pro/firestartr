import type { Dependency, Dependencies } from './loader';

import type { Ref } from './resolver';

import { loadDependencies } from './loader';

import { setDependencies } from './resolver';

import log from '../logger';

export type { Dependencies, Dependency };

export type RefResolver = (ref: Ref) => any;

export { loadDependencies } from './loader';

export { refResolver } from './resolver';
export { ResolvedRef } from './resolved';

export async function initDepsSystem(depsPath: string) {
  log.info('Initializing deps system');

  const deps = await loadDependencies(depsPath);

  setDependencies(deps);
}

export async function initDepsSystemFromMemory(deps: Dependencies) {
  setDependencies(deps as Dependencies);
}
