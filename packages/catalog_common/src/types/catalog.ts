export enum KindTypes {
  Users = 'USERS',
  Groups = 'GROUPS',
  Components = 'COMPONENTS',
  Systems = 'SYSTEMS',
}

export enum StatusTypes {
  Changed = 'CHANGED',
  Renamed = 'RENAMED',
  Created = 'CREATED',
  Deleted = 'DELETED',
}

export enum ArtifactStatuses {
  deletedStatus = 'DELETED',
  errorStatus = 'ERROR',
  pendingRenameStatus = 'PENDING_RENAME',
  pendingDeleteStatus = 'PENDING_DELETION',
  pendingProvisioningStatus = 'PENDING_PROVISIONING',
  pendingReviewStatus = 'PENDING_REVIEW',
  pendingCreationStatus = 'PENDING_CREATION',
  creatingStatus = 'CREATING',
  deletingStatus = 'DELETING',
  renamingStatus = 'RENAMING',
  provisionedStatus = 'PROVISIONED',
  provisioningStatus = 'PROVISIONING',
  unknownStatus = 'UNKNOWN',
}

export enum FeatureStatuses {
  pendingInstallStatus = 'PENDING_INSTALL',
  pendingUninstallStatus = 'PENDING_UNINSTALL',
  provisionedStatus = 'PROVISIONED',
}

export function getClaimKindFromCrKind(
  crKind: string,
): 'ComponentClaim' | 'GroupClaim' | 'UserClaim' {
  switch (crKind) {
    case 'FirestartrGithubRepository':
      return 'ComponentClaim';

    case 'FirestartrGithubGroup':
      return 'GroupClaim';

    case 'FirestartrGithubMembership':
      return 'UserClaim';

    case 'FirestartrTerraformModule':
      throw new Error('Not implemented yet');

    default:
      throw new Error(`Unknown CR kind: ${crKind}`);
  }
}

/**
 * @description Get the CR kind from the claim kind, it will need the provider to know which CR kind to return
 * @param claimKind could be ComponentClaim, GroupClaim, UserClaim, TerraformModuleClaim
 * @param provider could be github, aws, az, gpc
 * @returns the CR kind
 */
export function getCrKindFromClaimKind(claimKind: string, provider: string) {
  const providerClaimcRKindMap: any = {
    github: {
      ComponentClaim: 'FirestartrGithubRepository',

      GroupClaim: 'FirestartrGithubGroup',

      UserClaim: 'FirestartrGithubMembership',
    },
  };

  return providerClaimcRKindMap[provider][claimKind];
}

export function getProviderFromCrKind(
  crKind: string,
): 'github' | 'catalog' | 'aws' | 'az' | 'gpc' | 'doppleman' {
  switch (crKind) {
    case 'FirestartrGithubRepository':
    case 'FirestartrGithubGroup':
    case 'FirestartrGithubMembership':
    case 'FirestartrGithubRepositoryFeature':
      return 'github';

    case 'k8s-doppleman':
      return 'doppleman';

    default:
      throw new Error(`Unknown CR kind: ${crKind}`);
  }
}
