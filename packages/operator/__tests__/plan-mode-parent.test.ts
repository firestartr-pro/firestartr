import { OperationType, WorkItem, WorkStatus } from '../src/definitions';
import {
  buildActiveParentKeys,
  buildDeferredParentKeys,
  hasActiveParent,
} from '../src/parentDependency';
import { initPlanMode } from '../src/plan-mode/config';

function childOf(kind: string, parent: string): WorkItem {
  return {
    item: {
      kind,
      metadata: { name: `${parent}-child`, namespace: 'default' },
      spec: {
        repositoryTarget: {
          ref: { kind: 'FirestartrGithubRepository', name: parent },
        },
      },
    },
    operation: OperationType.CREATED,
    workStatus: WorkStatus.PENDING,
    onDelete: () => {},
    upsertTime: 0,
  } as any as WorkItem;
}

describe('Plan mode parent readiness', () => {
  beforeAll(() => {
    initPlanMode({ flag: true });
  });

  it.each([
    ['missing', null],
    [
      'unprovisioned',
      { status: { conditions: [{ type: 'PROVISIONED', status: 'False' }] } },
    ],
  ])(
    'dispatches children whose parent is %s',
    async (_label, parentCr) => {
      const queue = [
        childOf('FirestartrGithubRepositoryFeature', 'repo'),
        childOf('FirestartrGithubRepositorySecretsSection', 'repo'),
      ];
      const lookup = jest.fn(async () => parentCr);

      const active = buildActiveParentKeys(queue);
      const deferred = await buildDeferredParentKeys(queue, active, lookup);

      expect(deferred.size).toBe(0);
      for (const w of queue) {
        expect(hasActiveParent(w, active, deferred)).toBe(false);
      }
    },
  );
});
