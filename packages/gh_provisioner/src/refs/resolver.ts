import type { Dependency, Dependencies } from './loader';

import { ResolvedRef } from './resolved';

import log from '../logger';

let _DEPENDENCIES: Dependencies | null = null;

export type Ref = {
  kind: string;
  name: string;
  needsSecret?: boolean;
};

export function isDependenciesEmpty(): boolean {
  return _DEPENDENCIES === null || Object.keys(_DEPENDENCIES).length === 0;
}

export function setDependencies(deps: Dependencies) {
  log.info('Setting dependencies');

  _DEPENDENCIES = deps;
}

export function refResolver(ref: Ref): ResolvedRef | null {
  if (isDependenciesEmpty()) {
    log.error('Entity has no dependencies, nothing can be resolved');

    throw new Error('Entity has no dependencies: nothing can be resolved');
  }

  const { kind, name } = ref;

  const index = `${kind}-${name}`;

  if (index in _DEPENDENCIES) {
    const dep = _DEPENDENCIES[index] as Dependency;

    if (!dep.cr && !dep.secret) {
      return null;
    } else {
      return new ResolvedRef(dep);
    }
  } else {
    return null;
  }
}
