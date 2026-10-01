import { Entity, PatchOperations } from '../../base';

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
        //const teamSlug = fsGithubRepository.resolveRef(permission.ref, 'slug');
        //const teamId = fsGithubRepository.resolveRef(permission.ref, 'id');

        log.info(
          `[gh-provisioner] ${fsGithubRepository.k8sId} provisions a team ${permission.ref.name} with role ${permission.role}`,
        );

        const refTeam = Entity.refResolver(permission.ref);

        if (!refTeam) {
          log.warn(
            `[gh-provisioner] ${fsGithubRepository.k8sId} could not resolve team ref ${permission.ref.name}, skipping`,
          );
          continue;
        }

        const config = {
          teamId: refTeam.getOutput('id'),

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

        const refUser = Entity.refResolver(permission.ref);

        if (!refUser) {
          log.warn(
            `[gh-provisioner] ${fsGithubRepository.k8sId} could not resolve membership ref ${permission.ref.name}, skipping`,
          );
          continue;
        }

        const config = {
          username: refUser.getDepName(),

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
