import type { Dependency, Dependencies } from './loader';

import { ResolvedRef } from './resolved';

import log from '../logger';

export type Ref = {
  kind: string;
  name: string;
  needsSecret?: boolean;
};

/**
 * Resolves a ref against one execution's dependency map. The map is passed in
 * by the caller (an Entity instance), never held as module state: concurrent
 * runs in the same process must not see each other's dependencies.
 *
 * Empty or missing refs resolve to `null`; callers decide whether an
 * unresolved ref is fatal.
 */
export function resolveRefIn(
  deps: Dependencies | null | undefined,
  ref: Ref,
): ResolvedRef | null {
  if (!deps || Object.keys(deps).length === 0) {
    log.error(
      `[gh-provisioner] cannot resolve '${ref.kind}/${ref.name}': this execution has no dependencies bound`,
    );

    return null;
  }

  const { kind, name } = ref;

  const index = `${kind}-${name}`;

  if (!(index in deps)) {
    return null;
  }

  const dep = deps[index] as Dependency;

  if (!dep.cr && !dep.secret) {
    return null;
  }

  return new ResolvedRef(dep, deps);
}
