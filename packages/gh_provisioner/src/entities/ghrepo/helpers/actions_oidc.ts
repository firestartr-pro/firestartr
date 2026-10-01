import { Entity, PatchOperations } from '../../base';

import log from '../../../logger';

import { EntityGHRepo } from '../';

export function provisionOIDCSubjectClaim(fsGithubRepository: EntityGHRepo) {
  const claimKeys = fsGithubRepository.cr.spec.actions.oidc.includeClaimKeys;

  const useDefault = fsGithubRepository.cr.spec.actions.oidc.useDefault;

  const config: any = {
    useDefault,
  };

  if (claimKeys.length > 0) {
    config['includeClaimKeys'] = claimKeys;
  }

  fsGithubRepository.patchData({
    path: '/config/oidc_subject_claim_customization_template',

    op: PatchOperations.add,

    value: config,
  });
}
