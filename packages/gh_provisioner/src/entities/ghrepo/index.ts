import { Entity, PatchOperations } from '../base';

import log from '../../logger';

import github from 'github';

import {
  provisionDefaultBranch,
  provisionCodeowners,
  provisionVariables,
  provisionOIDCSubjectClaim,
  provisionPermissions,
  provisionLabels,
  provisionBranchProtections,
} from './helpers';

import { provisionAdditionalBranches } from './post';

export class EntityGHRepo extends Entity {
  private escapeTerraformBranchName(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  constructor(artifact: any) {
    super(artifact, {
      config: {
        files: [],

        variables: [],

        teams: [],

        collaborators: [],

        labels: [],

        branch_protections: [],
      },
    });
  }

  private async validatePages(
    tfOp: string,
    repoAlreadyExists: boolean,
  ): Promise<void> {
    const pages = this.cr.spec.pages;
    if (!pages) return;

    if (pages.https_enforced && !pages.cname) {
      throw new Error(
        `[gh-provisioner] ${this.k8sId} https_enforced requires cname to be set in pages configuration`,
      );
    }

    if (!pages.source || !pages.source.branch) return;
    const branch = pages.source.branch;
    const defaultBranch = this.cr.spec.repo.defaultBranch;
    const repo = this.cr.name;
    const org = this.cr.spec.org;

    log.info(
      `[gh-provisioner] ${this.k8sId} validating pages branch '${branch}' against default branch '${defaultBranch}' for operation '${tfOp}'`,
    );

    if (!repoAlreadyExists) {
      if (branch !== defaultBranch) {
        throw new Error(
          `Pages branch must equal default branch on creation. Provided: '${branch}', expected: '${defaultBranch}'`,
        );
      }
      return;
    } else if (branch !== defaultBranch) {
      log.info(
        `[gh-provisioner] ${this.k8sId} validating pages branch '${branch}' against default branch '${defaultBranch}' for operation '${tfOp}' - branch is different from default, checking existence in remote`,
      );
      try {
        await this.runWithGithubProvider(async () => {
          await github.branches.getBranch(repo, branch, org);
        });
      } catch (err: any) {
        if (err && err.status === 404) {
          throw new Error(
            `Pages branch '${branch}' does not exist in the repository '${org}/${repo}'.`,
          );
        }
        throw err;
      }
    }
  }

  async loadResources(tfOp: string): Promise<void> {
    let repoAlreadyExists = false;

    try {
      this.synthMessage('Loading resources to Synth...');

      repoAlreadyExists = (await this.runWithGithubProvider(async () => {
        return await github.repo.repoExists(this.cr.spec.org, this.cr.name);
      })) as boolean;

      if (tfOp !== 'destroy' && tfOp !== 'plan-destroy') {
        await this.validatePages(tfOp, repoAlreadyExists);
      }

      await this.provisionRepository();

      this.provisionPages();

      await provisionDefaultBranch(this);

      await provisionCodeowners(this);

      await provisionVariables(this);

      provisionBranchProtections(this);

      await provisionOIDCSubjectClaim(this);

      await provisionPermissions(this);

      await provisionLabels(this, repoAlreadyExists);

      this.synthMessage('Synth finished');

      this.synthEnd(JSON.stringify(this.document, null, 2));
    } catch (err) {
      log.error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${err}`,
      );

      throw `[gh-provisioner] ${this.k8sId} error loading resources: ${err}`;
    }
  }

  async postProvision(tfOp: string): Promise<void> {
    try {
      if (tfOp === 'apply') {
        log.info(
          `[gh-provisioner] ${this.k8sId} provisioning additional branches`,
        );

        await this.runWithGithubProvider(async () => {
          return await provisionAdditionalBranches(this);
        });
      }
    } catch (err) {
      log.error(
        `[gh-provisioner] ${this.k8sId} error on postProvision: ${err}`,
      );
    }
  }

  async loadAddressesToImport(): Promise<void> {
    this.patchImportData({
      op: PatchOperations.add,

      path: '/imports/-',

      value: {
        to: 'github_repository.this',
        id: this.cr.name,
      },
    });

    this.patchImportData({
      op: PatchOperations.add,

      path: '/imports/-',

      value: {
        to: 'github_branch_default.this',
        id: this.cr.name,
      },
    });

    this.patchImportData({
      op: PatchOperations.add,

      path: '/imports/-',

      value: {
        to: 'github_actions_repository_oidc_subject_claim_customization_template.this[0]',
        id: this.cr.name,
      },
    });

    // Import github_branch_protection ONLY for protections declared in CR, not GitHub state
    const protections = this.cr.spec.branchProtections;
    if (protections && Array.isArray(protections) && protections.length > 0) {
      for (const protection of protections) {
        const branch = protection.branch;
        this.patchImportData({
          op: PatchOperations.add,
          path: '/imports/-',
          value: {
            to: `github_branch_protection.this["${this.escapeTerraformBranchName(branch)}"]`,
            id: `${this.cr.name}:${this.escapeTerraformBranchName(branch)}`,
          },
        });
      }
    }

    // we cannot ensure the files exist, thus we need to check
    // it they exist before importing them
    //for (const file of this.document.config.files) {
    //  this.patchImportData({
    //    op: PatchOperations.add,

    //    path: '/imports/-',

    //    value: {
    //      to: `github_repository_file.this["${file.file}__${file.branch}"]`,

    //      id: `${this.cr.name}:${file.file}:${file.branch}`,
    //    },
    //  });
    //}

    for (const variable of this.document.config.variables) {
      this.patchImportData({
        op: PatchOperations.add,

        path: '/imports/-',

        value: {
          to: `github_actions_variable.this["${variable.variableName}"]`,

          id: `${this.cr.name}:${variable.variableName}`,
        },
      });
    }

    // Import Pages resource if configured.
    // When a repository is manually created with Pages already enabled,
    // we must import the existing resource to avoid a 409 conflict on apply.
    if (this.cr.spec.pages) {
      this.patchImportData({
        op: PatchOperations.add,

        path: '/imports/-',

        value: {
          to: 'github_repository_pages.this[0]',

          id: this.cr.name,
        },
      });
    }
  }

  async provisionRepository(): Promise<void> {
    this.patchData({
      path: '/config/repository',

      op: PatchOperations.add,

      value: {
        name: this.cr.name,

        description: this.cr.spec.repo.description,

        allowMergeCommit: this.cr.spec.repo.allowMergeCommit,

        allowSquashMerge: this.cr.spec.repo.allowSquashMerge,

        allowRebaseMerge: this.cr.spec.repo.allowRebaseMerge,

        allowAutoMerge: this.cr.spec.repo.allowAutoMerge,

        deleteBranchOnMerge: this.cr.spec.repo.deleteBranchOnMerge,

        autoInit: this.cr.spec.repo.autoInit,

        archiveOnDestroy: this.cr.spec.repo.archiveOnDestroy,

        allowUpdateBranch: this.cr.spec.repo.allowUpdateBranch,

        hasIssues: this.cr.spec.repo.hasIssues,

        visibility: this.cr.spec.repo.visibility,

        archived: this.cr.spec.repo.archived,

        gitignoreTemplate: this.cr.spec.repo.gitignoreTemplate,

        licenseTemplate: this.cr.spec.repo.licenseTemplate,

        template: this.cr.spec.repo.template,

        vulnerabilityAlerts: this.cr.spec.repo.vulnerabilityAlerts,

        topics: this.cr.spec.repo.topics,

        securityAndAnalysis: this.cr.spec.repo.securityAndAnalysis,

        hasProjects: this.cr.spec.repo.hasProjects,

        hasWiki: this.cr.spec.repo.hasWiki,

        hasDownloads: this.cr.spec.repo.hasDownloads,

        hasDiscussions: this.cr.spec.repo.hasDiscussions,

        mergeCommitMessage: this.cr.spec.repo.mergeCommitMessage,

        ignoreVulnerabilityAlertsDuringRead:
          this.cr.spec.repo.ignoreVulnerabilityAlertsDuringRead,

        mergeCommitTitle: this.cr.spec.repo.mergeCommitTitle,

        squashMergeCommitMessage: this.cr.spec.repo.squashMergeCommitMessage,
      },
    });
  }

  provisionPages(): void {
    if (this.cr.spec.pages) {
      const source = this.cr.spec.pages.source ?? {};
      const buildType = this.cr.spec.pages.buildType ?? 'legacy';
      const cname = this.cr.spec.pages.cname;
      const public_ = this.cr.spec.pages.public;
      const httpsEnforced = this.cr.spec.pages.https_enforced;

      this.patchData({
        path: '/config/pages',

        op: PatchOperations.add,

        value: {
          buildType: buildType,

          ...(buildType === 'legacy'
            ? {
                source: {
                  branch: source.branch || this.cr.spec.repo.defaultBranch,

                  path: source.path || '/',
                },
              }
            : {}),

          ...(cname !== undefined ? { cname } : {}),
          ...(public_ !== undefined ? { public: public_ } : {}),
          ...(httpsEnforced !== undefined
            ? { https_enforced: httpsEnforced }
            : {}),
        },
      });
    }
  }
}
