import { WorkItem } from './definitions';
import { isRelevantKind } from './parentDependency';

const WEIGHTS: any = {
  RENAMED: 15,
  UPDATED: 10,
  CREATED: 9,
  RETRY: 8,
  RETRY_SYNC: 8,
  MARKED_TO_DELETION: 6,
  SYNC: 1,
  NOTHING: 0,
};

// we need to assign weight to the deletion operation
// to avoid blockades
// https://github.com/prefapp/gitops-k8s/issues/1864
// ghrepo feat | grss -> ghrepo -> ghgroup -> membership
const DELETION_WEIGHTS: any = {
  // Leaf children first: C before B before A
  FirestartrDummyC: 6,
  FirestartrDummyB: 5,
  FirestartrDummyA: 4,
  FirestartrGithubRepositoryFeature: 5,
  FirestartrGithubRepositorySecretsSection: 4,
  FirestartrGithubRepository: 3,
  FirestartrGithubGroup: 2,
  FirestartrGithubMembership: 1,
  FirestartrTerraformWorkspace: 1,
  FirestartrGithubOrgWebhook: 1,
};

const CREATION_WEIGHTS: any = {
  // DummyA is root parent; DummyB is both child-of-A and parent-of-C
  FirestartrDummyA: 2,
  FirestartrDummyB: 1,
  FirestartrGithubRepository: 1,
};

export function sortQueue(queue: WorkItem[]): WorkItem[] {
  const sortedQueue = queue.sort((wa: WorkItem, wb: WorkItem) => {
    const weightA = WEIGHTS[wa.operation];
    const weightB = WEIGHTS[wb.operation];

    if (weightA !== weightB) {
      return weightB - weightA;
    }

    if (
      wa.operation === 'MARKED_TO_DELETION' &&
      wb.operation === 'MARKED_TO_DELETION'
    ) {
      const deletionWeightA = DELETION_WEIGHTS[wa.item.kind] || 0;
      const deletionWeightB = DELETION_WEIGHTS[wb.item.kind] || 0;

      if (deletionWeightA !== deletionWeightB) {
        return deletionWeightB - deletionWeightA;
      }
    }

    if (wa.operation === 'CREATED' && wb.operation === 'CREATED') {
      if (isRelevantKind(wa.item.kind) && isRelevantKind(wb.item.kind)) {
        const creationWeightA = CREATION_WEIGHTS[wa.item.kind] || 0;
        const creationWeightB = CREATION_WEIGHTS[wb.item.kind] || 0;

        if (creationWeightA !== creationWeightB) {
          return creationWeightB - creationWeightA;
        }
      }
    }

    return wa.upsertTime - wb.upsertTime;
  });

  return sortedQueue;
}
