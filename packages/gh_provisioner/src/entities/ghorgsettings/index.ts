import { Entity, PatchOperations } from '../base';

import log from '../../logger';

export class EntityGHOrgSettings extends Entity {
  constructor(artifact: any) {
    super(artifact, {
      config: {},
    });
  }

  async loadResources(tfOp: string): Promise<void> {
    log.info(`[gh-provisioner] running ${tfOp} on ${this.k8sId}`);

    try {
      const cr = this.cr;

      this.patchData({
        path: '/config',
        op: PatchOperations.replace,
        value: {
          billingEmail: cr.spec.billingEmail,
          company: cr.spec.company,
          blog: cr.spec.blog,
          email: cr.spec.email,
          twitterUsername: cr.spec.twitterUsername,
          location: cr.spec.location,
          name: cr.spec.name,
          description: cr.spec.description,
          hasOrganizationProjects: cr.spec.hasOrganizationProjects,
          hasRepositoryProjects: cr.spec.hasRepositoryProjects,
          defaultRepositoryPermission: cr.spec.defaultRepositoryPermission,
          membersCanCreateRepositories: cr.spec.membersCanCreateRepositories,
          membersCanCreatePublicRepositories:
            cr.spec.membersCanCreatePublicRepositories,
          membersCanCreatePrivateRepositories:
            cr.spec.membersCanCreatePrivateRepositories,
          membersCanCreateInternalRepositories:
            cr.spec.membersCanCreateInternalRepositories,
          membersCanCreatePages: cr.spec.membersCanCreatePages,
          membersCanCreatePublicPages: cr.spec.membersCanCreatePublicPages,
          membersCanCreatePrivatePages: cr.spec.membersCanCreatePrivatePages,
          membersCanForkPrivateRepositories:
            cr.spec.membersCanForkPrivateRepositories,
          webCommitSignoffRequired: cr.spec.webCommitSignoffRequired,
          advancedSecurityEnabledForNewRepositories:
            cr.spec.advancedSecurityEnabledForNewRepositories,
          dependabotAlertsEnabledForNewRepositories:
            cr.spec.dependabotAlertsEnabledForNewRepositories,
          dependabotSecurityUpdatesEnabledForNewRepositories:
            cr.spec.dependabotSecurityUpdatesEnabledForNewRepositories,
          dependencyGraphEnabledForNewRepositories:
            cr.spec.dependencyGraphEnabledForNewRepositories,
          secretScanningEnabledForNewRepositories:
            cr.spec.secretScanningEnabledForNewRepositories,
          secretScanningPushProtectionEnabledForNewRepositories:
            cr.spec.secretScanningPushProtectionEnabledForNewRepositories,
        },
      });

      log.debug(`[gh-provisioner] ${this.k8sId} loaded its data`);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);

      log.error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${message}`,
      );

      throw new Error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${message}`,
      );
    }
  }

  async postProvision(tfOp: string): Promise<void> {}

  async loadAddressesToImport(): Promise<void> {
    this.patchImportData({
      op: PatchOperations.add,
      path: '/imports/-',
      value: {
        to: 'github_organization_settings.this',
        id: this.cr.spec.org,
      },
    });
  }
}
