import { PatchOperations } from '../../base';

import log from '../../../logger';

import { EntityGHRepo } from '../';

export function provisionPermissions(fsGithubRepository: EntityGHRepo): void {
  const cr = fsGithubRepository.cr;

  log.info(
    `[gh-provisioner] provisionPermissions for repo name ${fsGithubRepository.k8sId} in org ${cr.spec.org}`,
  );

  for (const permission of cr.spec.permissions) {
    if ('ref' in permission) {
      if (permission.ref.kind === 'FirestartrGithubGroup') {
        log.info(
          `[gh-provisioner] ${fsGithubRepository.k8sId} provisions a team ${permission.ref.name} with role ${permission.role}`,
        );

        const config = {
          teamId: fsGithubRepository.requireOutput(permission.ref, 'id'),

          permission: permission.role,
        };

        fsGithubRepository.patchData({
          op: PatchOperations.add,

          path: '/config/teams/-',

          value: config,
        });
      } else if (permission.ref.kind === 'FirestartrGithubMembership') {
        log.info(
          `[gh-provisioner] ${fsGithubRepository.k8sId} provisions a member ${permission.ref.name} with role ${permission.role}`,
        );

        const config = {
          username: fsGithubRepository.requireRef(permission.ref).getDepName(),

          permission: permission.role,
        };

        fsGithubRepository.patchData({
          op: PatchOperations.add,

          path: '/config/collaborators/-',

          value: config,
        });
      }
    } else {
      log.info(
        `[gh-provisioner] ${fsGithubRepository.k8sId} provisions a member ${permission.collaborator} with role ${permission.role}`,
      );

      const config = {
        username: permission.collaborator,

        permission: permission.role,
      };

      fsGithubRepository.patchData({
        op: PatchOperations.add,

        path: '/config/collaborators/-',

        value: config,
      });
    }
  }
}
