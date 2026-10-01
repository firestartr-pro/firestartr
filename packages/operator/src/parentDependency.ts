import {
  WorkItem,
  WorkStatus,
  OperationType,
  getPluralFromKind,
} from './definitions';

const PARENT_KIND_MAP: Record<string, string> = {
  FirestartrGithubRepositoryFeature: 'FirestartrGithubRepository',
  FirestartrGithubRepositorySecretsSection: 'FirestartrGithubRepository',
  FirestartrDummyB: 'FirestartrDummyA',
  FirestartrDummyC: 'FirestartrDummyB',
};

const DEPENDENT_KINDS = new Set(Object.keys(PARENT_KIND_MAP));

const RELEVANT_KINDS = new Set<string>();
for (const [child, parent] of Object.entries(PARENT_KIND_MAP)) {
  RELEVANT_KINDS.add(child);
  RELEVANT_KINDS.add(parent);
}

export function getParentKindForDependent(kind: string): string | undefined {
  return PARENT_KIND_MAP[kind];
}

export function isDependentKind(kind: string): boolean {
  return DEPENDENT_KINDS.has(kind);
}

export function isRelevantKind(kind: string): boolean {
  return RELEVANT_KINDS.has(kind);
}

export function getParentRef(
  workItem: WorkItem,
): { kind: string; name: string } | null {
  const ref = workItem.item.spec?.repositoryTarget?.ref;
  if (ref?.kind && ref?.name) {
    return { kind: ref.kind, name: ref.name };
  }

  const needs = workItem.item.spec?.needs;
  if (needs?.kind && needs?.name) {
    return { kind: needs.kind, name: needs.name };
  }

  return null;
}

export function buildActiveParentKeys(queue: WorkItem[]): Set<string> {
  const keys = new Set<string>();
  for (const w of queue) {
    if (w.workStatus === WorkStatus.PENDING || w.isPicked) {
      keys.add(`${w.item.kind}/${w.item.metadata?.name}`);
    }
  }
  return keys;
}

/**
 * Scan the queue for dependent children whose parent is not in the active set
 * and verify whether each parent exists in the K8s cluster and has been
 * provisioned. Parents that are absent from the queue and either missing from
 * the cluster OR not yet provisioned are added to a deferred set, which
 * `hasActiveParent` uses to block the child from being dispatched.
 *
 * A parent CR exists in the cluster immediately after `kubectl apply`, but it
 * is not usable until the operator has reconciled it and set PROVISIONED=True.
 * Checking only for cluster existence would let children slip through while
 * the parent is still being processed. This function also checks the parent's
 * status conditions so that children are deferred until the parent is fully
 * provisioned.
 *
 * @param getItemByItemPath - function to look up a CR in the K8s cluster by
 *   its item path (namespace/pluralKind/name). Should return null (not throw)
 *   when the resource is absent or not yet available (e.g. 404/409), so that
 *   missing parents are deferred without generating spurious error logs.
 */
export async function buildDeferredParentKeys(
  queue: WorkItem[],
  activeParentKeys: Set<string>,
  getItemByItemPath: (itemPath: string) => Promise<any>,
): Promise<Set<string>> {
  const deferred = new Set<string>();
  const checked = new Set<string>();
  for (const w of queue) {
    if (w.operation !== OperationType.CREATED) continue;
    if (!isDependentKind(w.item.kind)) continue;
    const parentRef = getParentRef(w);
    if (!parentRef) continue;
    const parentKey = `${parentRef.kind}/${parentRef.name}`;
    if (checked.has(parentKey)) continue;
    checked.add(parentKey);
    if (activeParentKeys.has(parentKey)) continue;
    const namespace = w.item.metadata?.namespace || 'default';
    const pluralKind = getPluralFromKind(parentRef.kind);
    if (!pluralKind) continue;
    try {
      const parentCr = await getItemByItemPath(
        `${namespace}/${pluralKind}/${parentRef.name}`,
      );
      const isProvisioned = parentCr?.status?.conditions?.some(
        (c: any) => c.type === 'PROVISIONED' && c.status === 'True',
      );
      if (!isProvisioned) {
        deferred.add(parentKey);
      }
    } catch {
      deferred.add(parentKey);
    }
  }
  return deferred;
}

export function hasActiveParent(
  workItem: WorkItem,
  queueOrKeys: WorkItem[] | Set<string>,
  deferredParentKeys?: Set<string>,
): boolean {
  if (workItem.operation !== OperationType.CREATED) return false;
  if (!DEPENDENT_KINDS.has(workItem.item.kind)) return false;

  const parentRef = getParentRef(workItem);
  if (!parentRef) return false;

  const { kind: parentKind, name: parentName } = parentRef;
  const parentKey = `${parentKind}/${parentName}`;

  if (queueOrKeys instanceof Set) {
    if (queueOrKeys.has(parentKey)) return true;
    if (deferredParentKeys?.has(parentKey)) return true;
    return false;
  }

  const parentActive = queueOrKeys.some(
    (w: WorkItem) =>
      w.item.kind === parentKind &&
      w.item.metadata?.name === parentName &&
      (w.workStatus === WorkStatus.PENDING || w.isPicked),
  );
  if (parentActive) return true;
  if (deferredParentKeys?.has(parentKey)) return true;
  return false;
}
