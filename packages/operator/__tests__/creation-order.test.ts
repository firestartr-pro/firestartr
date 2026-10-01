import { WorkItem, WorkStatus, OperationType } from '../src/definitions';
import { sortQueue } from '../src/queueSort';
import { hasActiveParent, buildDeferredParentKeys } from '../src/parentDependency';

const KIND_PARENT = 'FirestartrGithubRepository';
const KIND_CHILD_FEAT = 'FirestartrGithubRepositoryFeature';
const KIND_CHILD_GRSS = 'FirestartrGithubRepositorySecretsSection';

const KIND_DUMMY_A = 'FirestartrDummyA';
const KIND_DUMMY_B = 'FirestartrDummyB';
const KIND_DUMMY_C = 'FirestartrDummyC';

const KIND_OTHER = 'SomeUnrelatedKind';

function makeWorkItem(
  kind: string,
  operation: OperationType = OperationType.CREATED,
  upsertTime: number = 0,
  name: string = 'test',
  parentName?: string,
  parentKind?: string,
): WorkItem {
  const item: any = { metadata: { name, namespace: 'default' }, kind };
  if (parentName) {
    if (kind === KIND_CHILD_FEAT || kind === KIND_CHILD_GRSS) {
      item.spec = {
        repositoryTarget: {
          ref: {
            kind: parentKind || KIND_PARENT,
            name: parentName,
            needsSecret: false,
          },
        },
      };
    } else if (kind === KIND_DUMMY_B || kind === KIND_DUMMY_C) {
      item.spec = {
        needs: { kind: parentKind || KIND_DUMMY_A, name: parentName },
      };
    }
  }
  return {
    item,
    operation,
    workStatus: WorkStatus.PENDING,
    onDelete: () => {},
    upsertTime,
  } as any as WorkItem;
}

describe('sortQueue — creation ordering', () => {
  it('sorts GHRepo before GHRepoFeat when both are CREATED', () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'child',
    );
    const parent = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      100,
      'parent',
    );
    const sorted = sortQueue([child, parent]);
    expect(sorted[0].item.metadata.name).toBe('parent');
    expect(sorted[1].item.metadata.name).toBe('child');
  });

  it('sorts GHRepo before GRSS when both are CREATED', () => {
    const child = makeWorkItem(
      KIND_CHILD_GRSS,
      OperationType.CREATED,
      0,
      'child',
    );
    const parent = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      100,
      'parent',
    );
    const sorted = sortQueue([child, parent]);
    expect(sorted[0].item.metadata.name).toBe('parent');
    expect(sorted[1].item.metadata.name).toBe('child');
  });

  it('sorts items of the same creation kind by upsertTime', () => {
    const late = makeWorkItem(KIND_PARENT, OperationType.CREATED, 100, 'late');
    const early = makeWorkItem(KIND_PARENT, OperationType.CREATED, 50, 'early');
    const sorted = sortQueue([late, early]);
    expect(sorted[0].item.metadata.name).toBe('early');
    expect(sorted[1].item.metadata.name).toBe('late');
  });

  it('sorts non-dependent kinds by upsertTime only', () => {
    const late = makeWorkItem(KIND_OTHER, OperationType.CREATED, 100, 'late');
    const early = makeWorkItem(KIND_OTHER, OperationType.CREATED, 50, 'early');
    const sorted = sortQueue([late, early]);
    expect(sorted[0].item.metadata.name).toBe('early');
    expect(sorted[1].item.metadata.name).toBe('late');
  });

  it('does not change deletion sort order', () => {
    const parent = makeWorkItem(
      KIND_PARENT,
      OperationType.MARKED_TO_DELETION,
      0,
      'parent',
    );
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.MARKED_TO_DELETION,
      100,
      'child',
    );
    const sorted = sortQueue([parent, child]);
    expect(sorted[0].item.metadata.name).toBe('child');
    expect(sorted[1].item.metadata.name).toBe('parent');
  });

  it('sorts by operation weight when operations differ', () => {
    const created = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      0,
      'created',
    );
    const updated = makeWorkItem(
      KIND_PARENT,
      OperationType.UPDATED,
      0,
      'updated',
    );
    const sorted = sortQueue([created, updated]);
    expect(sorted[0].item.metadata.name).toBe('updated');
    expect(sorted[1].item.metadata.name).toBe('created');
  });

  it('sorts DummyA before DummyB when both are CREATED', () => {
    const b = makeWorkItem(KIND_DUMMY_B, OperationType.CREATED, 0, 'dummy-b');
    const a = makeWorkItem(KIND_DUMMY_A, OperationType.CREATED, 100, 'dummy-a');
    const sorted = sortQueue([b, a]);
    expect(sorted[0].item.metadata.name).toBe('dummy-a');
    expect(sorted[1].item.metadata.name).toBe('dummy-b');
  });

  it('sorts DummyA before DummyC when both are CREATED', () => {
    const c = makeWorkItem(KIND_DUMMY_C, OperationType.CREATED, 0, 'dummy-c');
    const a = makeWorkItem(KIND_DUMMY_A, OperationType.CREATED, 100, 'dummy-a');
    const sorted = sortQueue([c, a]);
    expect(sorted[0].item.metadata.name).toBe('dummy-a');
    expect(sorted[1].item.metadata.name).toBe('dummy-c');
  });

  it('sorts DummyB before DummyC (B is parent of C)', () => {
    const c = makeWorkItem(KIND_DUMMY_C, OperationType.CREATED, 0, 'dummy-c');
    const b = makeWorkItem(KIND_DUMMY_B, OperationType.CREATED, 100, 'dummy-b');
    const sorted = sortQueue([c, b]);
    expect(sorted[0].item.metadata.name).toBe('dummy-b');
    expect(sorted[1].item.metadata.name).toBe('dummy-c');
  });

  it('sorts DummyC before DummyB on MARKED_TO_DELETION (child first)', () => {
    const parent = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.MARKED_TO_DELETION,
      0,
      'mid',
    );
    const child = makeWorkItem(
      KIND_DUMMY_C,
      OperationType.MARKED_TO_DELETION,
      100,
      'leaf',
    );
    const sorted = sortQueue([parent, child]);
    expect(sorted[0].item.metadata.name).toBe('leaf');
    expect(sorted[1].item.metadata.name).toBe('mid');
  });

  it('sorts DummyB before DummyA on MARKED_TO_DELETION (child first)', () => {
    const parent = makeWorkItem(
      KIND_DUMMY_A,
      OperationType.MARKED_TO_DELETION,
      0,
      'root',
    );
    const child = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.MARKED_TO_DELETION,
      100,
      'mid',
    );
    const sorted = sortQueue([parent, child]);
    expect(sorted[0].item.metadata.name).toBe('mid');
    expect(sorted[1].item.metadata.name).toBe('root');
  });

  it('sorts full chain C before B before A on MARKED_TO_DELETION', () => {
    const a = makeWorkItem(
      KIND_DUMMY_A,
      OperationType.MARKED_TO_DELETION,
      0,
      'root',
    );
    const b = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.MARKED_TO_DELETION,
      50,
      'mid',
    );
    const c = makeWorkItem(
      KIND_DUMMY_C,
      OperationType.MARKED_TO_DELETION,
      100,
      'leaf',
    );
    const sorted = sortQueue([a, b, c]);
    expect(sorted[0].item.metadata.name).toBe('leaf');
    expect(sorted[1].item.metadata.name).toBe('mid');
    expect(sorted[2].item.metadata.name).toBe('root');
  });
});

describe('hasActiveParent — parent-identity dependency check', () => {
  it('blocks GHRepoFeat when parent is PENDING', () => {
    const parent = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      0,
      'myrepo',
    );
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'myrepo',
    );
    expect(hasActiveParent(child, [parent, child])).toBe(true);
  });

  it('blocks GHRepoFeat when parent is isPicked (PROCESSING)', () => {
    const parent = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      0,
      'myrepo',
    );
    parent.isPicked = true;
    parent.workStatus = WorkStatus.PROCESSING;
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'myrepo',
    );
    expect(hasActiveParent(child, [parent, child])).toBe(true);
  });

  it('does NOT block GHRepoFeat when parent is FINISHED', () => {
    const parent = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      0,
      'myrepo',
    );
    parent.workStatus = WorkStatus.FINISHED;
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'myrepo',
    );
    expect(hasActiveParent(child, [parent, child])).toBe(false);
  });

  it('does NOT block GHRepoFeat when parent is absent from queue', () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'myrepo',
    );
    expect(hasActiveParent(child, [child])).toBe(false);
  });

  it('does NOT block GHRepo (parent kind, not a dependent kind)', () => {
    const parent = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      0,
      'myrepo',
    );
    expect(hasActiveParent(parent, [parent])).toBe(false);
  });

  it('does NOT block non-dependent kinds on CREATED', () => {
    const other = makeWorkItem(KIND_OTHER, OperationType.CREATED, 0, 'dummy');
    expect(hasActiveParent(other, [other])).toBe(false);
  });

  it('does NOT block dependent kinds on non-CREATED operations', () => {
    const parent = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      0,
      'myrepo',
    );
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.UPDATED,
      0,
      'myfeat',
      'myrepo',
    );
    expect(hasActiveParent(child, [parent, child])).toBe(false);
  });

  it('blocks GRSS when parent is PENDING', () => {
    const parent = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      0,
      'myrepo',
    );
    const child = makeWorkItem(
      KIND_CHILD_GRSS,
      OperationType.CREATED,
      0,
      'mysec',
      'myrepo',
    );
    expect(hasActiveParent(child, [parent, child])).toBe(true);
  });

  it('each child is blocked only by its own parent (multiple repo+feature pairs)', () => {
    const parentA = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      0,
      'repo-a',
    );
    const parentB = makeWorkItem(
      KIND_PARENT,
      OperationType.CREATED,
      0,
      'repo-b',
    );
    const childA = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'feat-a',
      'repo-a',
    );
    const childB = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'feat-b',
      'repo-b',
    );
    const queue = [parentA, parentB, childA, childB];
    expect(hasActiveParent(childA, queue)).toBe(true); // parentA is PENDING
    expect(hasActiveParent(childB, queue)).toBe(true); // parentB is PENDING
    parentA.workStatus = WorkStatus.FINISHED;
    expect(hasActiveParent(childA, queue)).toBe(false); // parentA FINISHED
    expect(hasActiveParent(childB, queue)).toBe(true); // parentB still PENDING
  });

  // ---- Dummy parent-dependency tests (spec.needs) ----

  it('blocks DummyB when parent DummyA is PENDING', () => {
    const parent = makeWorkItem(
      KIND_DUMMY_A,
      OperationType.CREATED,
      0,
      'dummy-a',
    );
    const child = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'dummy-b',
      'dummy-a',
    );
    expect(hasActiveParent(child, [parent, child])).toBe(true);
  });

  it('blocks DummyC when parent DummyB is PENDING', () => {
    const parent = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'dummy-b',
    );
    const child = makeWorkItem(
      KIND_DUMMY_C,
      OperationType.CREATED,
      0,
      'dummy-c',
      'dummy-b',
      KIND_DUMMY_B,
    );
    expect(hasActiveParent(child, [parent, child])).toBe(true);
  });

  it('blocks DummyB when parent DummyA is isPicked (PROCESSING)', () => {
    const parent = makeWorkItem(
      KIND_DUMMY_A,
      OperationType.CREATED,
      0,
      'dummy-a',
    );
    parent.isPicked = true;
    parent.workStatus = WorkStatus.PROCESSING;
    const child = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'dummy-b',
      'dummy-a',
    );
    expect(hasActiveParent(child, [parent, child])).toBe(true);
  });

  it('does NOT block DummyB when parent DummyA is FINISHED', () => {
    const parent = makeWorkItem(
      KIND_DUMMY_A,
      OperationType.CREATED,
      0,
      'dummy-a',
    );
    parent.workStatus = WorkStatus.FINISHED;
    const child = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'dummy-b',
      'dummy-a',
    );
    expect(hasActiveParent(child, [parent, child])).toBe(false);
  });

  it('does NOT block DummyB when parent DummyA is absent from queue', () => {
    const child = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'dummy-b',
      'dummy-a',
    );
    expect(hasActiveParent(child, [child])).toBe(false);
  });

  it('does NOT block DummyA (root kind, not a dependent kind)', () => {
    const parent = makeWorkItem(
      KIND_DUMMY_A,
      OperationType.CREATED,
      0,
      'dummy-a',
    );
    expect(hasActiveParent(parent, [parent])).toBe(false);
  });

  it('does NOT block DummyB on non-CREATED operation', () => {
    const parent = makeWorkItem(
      KIND_DUMMY_A,
      OperationType.CREATED,
      0,
      'dummy-a',
    );
    const child = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.UPDATED,
      0,
      'dummy-b',
      'dummy-a',
    );
    expect(hasActiveParent(child, [parent, child])).toBe(false);
  });

  it('full chain A->B->C: each child blocked by its own parent', () => {
    const a = makeWorkItem(KIND_DUMMY_A, OperationType.CREATED, 0, 'root');
    const b = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'mid',
      'root',
    );
    const c = makeWorkItem(
      KIND_DUMMY_C,
      OperationType.CREATED,
      0,
      'leaf',
      'mid',
      KIND_DUMMY_B,
    );
    const queue = [a, b, c];

    expect(hasActiveParent(b, queue)).toBe(true); // A is PENDING
    expect(hasActiveParent(c, queue)).toBe(true); // B is PENDING

    a.workStatus = WorkStatus.FINISHED;
    expect(hasActiveParent(b, queue)).toBe(false); // A is FINISHED, B unblocked
    expect(hasActiveParent(c, queue)).toBe(true); // B still PENDING

    b.workStatus = WorkStatus.FINISHED;
    expect(hasActiveParent(c, queue)).toBe(false); // B is FINISHED, C unblocked
  });

  it('each dummy child blocked only by its own specific parent', () => {
    const parentA1 = makeWorkItem(
      KIND_DUMMY_A,
      OperationType.CREATED,
      0,
      'root1',
    );
    const parentA2 = makeWorkItem(
      KIND_DUMMY_A,
      OperationType.CREATED,
      0,
      'root2',
    );
    const childB1 = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'b1',
      'root1',
    );
    const childB2 = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'b2',
      'root2',
    );
    const queue = [parentA1, parentA2, childB1, childB2];

    expect(hasActiveParent(childB1, queue)).toBe(true); // root1 is PENDING
    expect(hasActiveParent(childB2, queue)).toBe(true); // root2 is PENDING

    parentA1.workStatus = WorkStatus.FINISHED;
    expect(hasActiveParent(childB1, queue)).toBe(false); // root1 FINISHED, b1 unblocked
    expect(hasActiveParent(childB2, queue)).toBe(true); // root2 still PENDING
  });

  // ---- deferredParentKeys: cluster existence check ----

  it('blocks GHRepoFeat when parent not in queue and not in cluster (deferredParentKeys)', () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'nonexistent-repo',
    );
    const deferredKeys = new Set([
      'FirestartrGithubRepository/nonexistent-repo',
    ]);
    const activeKeys = new Set<string>();
    expect(hasActiveParent(child, activeKeys, deferredKeys)).toBe(true);
  });

  it('does NOT block GHRepoFeat when parent not in queue but exists in cluster (no deferredParentKeys entry)', () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'existing-repo',
    );
    const activeKeys = new Set<string>();
    const deferredKeys = new Set<string>();
    expect(hasActiveParent(child, activeKeys, deferredKeys)).toBe(false);
  });

  it('does NOT block GHRepoFeat when parent is in active set regardless of deferredParentKeys', () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'active-repo',
    );
    const activeKeys = new Set(['FirestartrGithubRepository/active-repo']);
    const deferredKeys = new Set<string>();
    expect(hasActiveParent(child, activeKeys, deferredKeys)).toBe(true);
  });

  it('blocks DummyB when parent not in queue and not in cluster (deferredParentKeys)', () => {
    const child = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'dummy-b',
      'nonexistent-a',
    );
    const deferredKeys = new Set(['FirestartrDummyA/nonexistent-a']);
    const activeKeys = new Set<string>();
    expect(hasActiveParent(child, activeKeys, deferredKeys)).toBe(true);
  });

  it('does NOT block DummyB when parent not in queue but exists in cluster', () => {
    const child = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'dummy-b',
      'existing-a',
    );
    const activeKeys = new Set<string>();
    const deferredKeys = new Set<string>();
    expect(hasActiveParent(child, activeKeys, deferredKeys)).toBe(false);
  });
});

describe('buildDeferredParentKeys — cluster existence and provisioning check', () => {
  const mockGetItemProvisioned = async (path: string) => ({
    kind: 'FirestartrGithubRepository',
    metadata: { name: path.split('/').pop() },
    status: { conditions: [{ type: 'PROVISIONED', status: 'True' }] },
  });

  const mockGetItemNotProvisioned = async (path: string) => ({
    kind: 'FirestartrGithubRepository',
    metadata: { name: path.split('/').pop() },
    status: { conditions: [] },
  });

  const mockGetItemNotFound = async (path: string) => { throw new Error('Not found'); };

  it('returns empty set when all parents are in the active set', async () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'myrepo',
    );
    const activeKeys = new Set(['FirestartrGithubRepository/myrepo']);
    const result = await buildDeferredParentKeys([child], activeKeys, mockGetItemProvisioned);
    expect(result.size).toBe(0);
  });

  it('returns empty set when parent is provisioned in cluster', async () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'myrepo',
    );
    const activeKeys = new Set<string>();
    const result = await buildDeferredParentKeys([child], activeKeys, mockGetItemProvisioned);
    expect(result.size).toBe(0);
  });

  it('defers child when parent exists but is NOT provisioned', async () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'unprovisioned-repo',
    );
    const activeKeys = new Set<string>();
    const result = await buildDeferredParentKeys([child], activeKeys, mockGetItemNotProvisioned);
    expect(result.size).toBe(1);
    expect(result.has('FirestartrGithubRepository/unprovisioned-repo')).toBe(true);
  });

  it('adds parent key when parent does not exist in cluster', async () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'nonexistent-repo',
    );
    const activeKeys = new Set<string>();
    const result = await buildDeferredParentKeys([child], activeKeys, mockGetItemNotFound);
    expect(result.size).toBe(1);
    expect(result.has('FirestartrGithubRepository/nonexistent-repo')).toBe(true);
  });

  it('deduplicates multiple children referencing the same missing parent', async () => {
    const child1 = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'feat-a',
      'missing-repo',
    );
    const child2 = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'feat-b',
      'missing-repo',
    );
    const activeKeys = new Set<string>();
    const getItemMock = jest.fn().mockRejectedValue(new Error('Not found'));
    const result = await buildDeferredParentKeys([child1, child2], activeKeys, getItemMock);
    expect(result.size).toBe(1);
    expect(result.has('FirestartrGithubRepository/missing-repo')).toBe(true);
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  it('skips non-dependent kinds', async () => {
    const other = makeWorkItem(KIND_OTHER, OperationType.CREATED, 0, 'other');
    const activeKeys = new Set<string>();
    const result = await buildDeferredParentKeys([other], activeKeys, mockGetItemNotFound);
    expect(result.size).toBe(0);
  });

  it('skips non-CREATED operations', async () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.UPDATED,
      0,
      'myfeat',
      'missing-repo',
    );
    const activeKeys = new Set<string>();
    const result = await buildDeferredParentKeys([child], activeKeys, mockGetItemNotFound);
    expect(result.size).toBe(0);
  });

  it('calls getItemByItemPath with the correct item path', async () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'test-repo',
      KIND_PARENT,
    );
    child.item.metadata.namespace = 'test-ns';
    const activeKeys = new Set<string>();
    const getItemMock = jest.fn().mockRejectedValue(new Error('Not found'));
    await buildDeferredParentKeys([child], activeKeys, getItemMock);
    expect(getItemMock).toHaveBeenCalledWith('test-ns/githubrepositories/test-repo');
  });

  it('handles dummy B blocked when parent DummyA is missing from cluster', async () => {
    const child = makeWorkItem(
      KIND_DUMMY_B,
      OperationType.CREATED,
      0,
      'dummy-b',
      'missing-a',
    );
    const activeKeys = new Set<string>();
    const result = await buildDeferredParentKeys([child], activeKeys, mockGetItemNotFound);
    expect(result.size).toBe(1);
    expect(result.has('FirestartrDummyA/missing-a')).toBe(true);
  });

  it('does not call getItemByItemPath when parent is already in active set', async () => {
    const child = makeWorkItem(
      KIND_CHILD_FEAT,
      OperationType.CREATED,
      0,
      'myfeat',
      'active-repo',
    );
    const activeKeys = new Set(['FirestartrGithubRepository/active-repo']);
    const getItemMock = jest.fn();
    const result = await buildDeferredParentKeys([child], activeKeys, getItemMock);
    expect(result.size).toBe(0);
    expect(getItemMock).not.toHaveBeenCalled();
  });

  it('defers GRSS when parent GHRepo is not provisioned', async () => {
    const child = makeWorkItem(
      KIND_CHILD_GRSS,
      OperationType.CREATED,
      0,
      'mysec',
      'unprovisioned-repo',
    );
    const activeKeys = new Set<string>();
    const result = await buildDeferredParentKeys([child], activeKeys, mockGetItemNotProvisioned);
    expect(result.size).toBe(1);
    expect(result.has('FirestartrGithubRepository/unprovisioned-repo')).toBe(true);
  });

  it('allows GRSS when parent GHRepo is provisioned', async () => {
    const child = makeWorkItem(
      KIND_CHILD_GRSS,
      OperationType.CREATED,
      0,
      'mysec',
      'provisioned-repo',
    );
    const activeKeys = new Set<string>();
    const result = await buildDeferredParentKeys([child], activeKeys, mockGetItemProvisioned);
    expect(result.size).toBe(0);
  });
});
