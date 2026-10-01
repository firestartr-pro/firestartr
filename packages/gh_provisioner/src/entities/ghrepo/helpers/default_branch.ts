import { Entity, PatchOperations } from '../../base';

import log from '../../../logger';

import { EntityGHRepo } from '../';

export function provisionDefaultBranch(fsGithubRepository: EntityGHRepo) {
  const branchConfig = {
    branch: fsGithubRepository.cr.spec.repo.defaultBranch,

    rename: false,
  };

  log.debug(
    `[gh-provisioner] ${fsGithubRepository.k8sId} default branch provision: ${JSON.stringify(branchConfig)}`,
  );

  fsGithubRepository.patchData({
    path: '/config/default_branch',

    op: PatchOperations.add,

    value: branchConfig,
  });
}
