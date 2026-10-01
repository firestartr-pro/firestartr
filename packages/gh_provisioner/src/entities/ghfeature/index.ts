import { Entity, PatchOperations } from '../base';

import log from '../../logger';

import github from 'github';

import { provisionManagedFiles, seedForMigrationReimport } from './helpers';

import { runOnTerraform } from '../../tp_bridge';

export class EntityGHFeature extends Entity {
  _newlyProvisionedAddresses: string[] = [];

  constructor(artifact: any) {
    super(artifact, {
      config: {
        files: [],
      },
      installed_managed_files: [],
    });
  }

  async loadResources(tfOp: string): Promise<void> {
    log.info(`[gh-provisioner] running ${tfOp} on ${this.k8sId}`);

    const repoRef = Entity.refResolver(this.cr.spec.repositoryTarget.ref);

    this.patchData({
      path: '/config/repository',

      op: PatchOperations.add,

      value: `${repoRef.cr.spec.org}/${repoRef.getDepName()}`,
    });

    try {
      if (tfOp === 'import-with-reimport') {
        // Migration reimport path: only non-user-managed files go into config;
        // installed_managed_files is seeded from all userManaged:true addresses.
        // preApplyStateRm and keepUntrackedFiles are both skipped — the
        // destroy-state-only step inside runOnTerraform handles legacy state cleanup.
        await seedForMigrationReimport(this);
      } else {
        const { newlyProvisionedAddresses, installedManagedFiles } =
          await provisionManagedFiles(this);

        this._newlyProvisionedAddresses = newlyProvisionedAddresses;

        if (tfOp === 'apply') {
          await this.preApplyStateRm(installedManagedFiles);
        }

        if (tfOp === 'destroy') {
          await this.keepUntrackedFiles(tfOp);
        }
      }

      log.debug(`[gh-provisioner] ${this.k8sId} loaded its data`);

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
    if (tfOp !== 'apply' || this._newlyProvisionedAddresses.length === 0) {
      return;
    }

    const addresses = this._newlyProvisionedAddresses.map(
      (addr) => `github_repository_file.user_managed["${addr}"]`,
    );

    log.info(
      `[gh-provisioner] ${this.k8sId} post-apply state rm for newly provisioned user-managed files: [${addresses.join(', ')}]`,
    );

    await runOnTerraform(
      this,
      'custom-command',
      ['state', 'rm'].concat(addresses),
    );
  }

  /**
   * Called by `runOnTerraform` during `import-with-reimport` after
   * `loadResources('import-with-reimport')` has already seeded `config.files`
   * with only non-user-managed files.
   *
   * Emits one import block per file:
   *   to:  github_repository_file.managed["<file>/<branch>"]
   *   id:  <repoName>:<file>:<branch>
   *
   * User-managed files are intentionally excluded (see ADR 0005).
   */
  async loadAddressesToImport(): Promise<void> {
    const repoRef = Entity.refResolver(this.cr.spec.repositoryTarget.ref);

    const repoName = repoRef.getDepName();

    for (const file of this.document.config.files) {
      this.patchImportData({
        op: PatchOperations.add,

        path: '/imports/-',

        value: {
          to: `github_repository_file.managed["${file.file}/${file.branch}"]`,

          id: `${repoName}:${file.file}:${file.branch}`,
        },
      });
    }
  }

  /**
   * Pre-apply state rm — runs inside loadResources before the main TF operation.
   *
   * Fetches the current TF state list, then removes any user-managed resource
   * addresses that are in installedManagedFiles AND are not currently
   * transitioning from userManaged:true to userManaged:false. This prevents
   * Terraform from planning a destroy for files that were dropped from the
   * feature definition or are still under user control from a previous apply.
   */
  async preApplyStateRm(installedManagedFiles: string[]): Promise<void> {
    if (installedManagedFiles.length === 0) return;

    try {
      const stateListOutput = await runOnTerraform(this, 'custom-command', [
        'state',
        'list',
      ]);

      const stateAddresses = parseStateList(stateListOutput);

      // Files that are transitioning from userManaged:true → false must NOT be
      // state-rm'd because Terraform needs them in state to manage them going forward.
      const transitioningToManaged = new Set(
        (this.cr.spec.files ?? [])
          .filter((f: any) => !f.userManaged)
          .map(
            (f: any) =>
              `${f.path}/${f.targetBranch || this.cr.spec.repositoryTarget.branch}`,
          ),
      );

      const addressesToRemove = stateAddresses.filter((addr) => {
        const match = addr.match(
          /^github_repository_file\.user_managed\["(.+)"\]$/,
        );

        if (!match) return false;

        const fileAddress = match[1];

        return (
          installedManagedFiles.includes(fileAddress) &&
          !transitioningToManaged.has(fileAddress)
        );
      });

      if (addressesToRemove.length > 0) {
        log.info(
          `[gh-provisioner] ${this.k8sId} pre-apply state rm: [${addressesToRemove.join(', ')}]`,
        );

        await runOnTerraform(
          this,
          'custom-command',
          ['state', 'rm'].concat(addressesToRemove),
        );
      }
    } catch (err) {
      throw new Error(
        `[gh-provisioner] ${this.k8sId} pre-apply state rm failed: ${err}`,
      );
    }
  }

  /**
   * Destroy path — removes user-managed file resources from TF state before
   * the destroy operation so Terraform does not delete them from GitHub.
   *
   * Uses `terraform state list` to discover what is actually in state rather
   * than reading config.files, making this robust whether the entity was last
   * provisioned with old or new code.
   */
  async keepUntrackedFiles(_tfOp: string) {
    try {
      log.debug(
        `[gh-provisioner] ${this.k8sId} loaded untrack files ${this.k8sId}`,
      );

      // Propagate session fields from parent if present
      if (this.parent) {
        this.sessionId = this.parent.sessionId;
        this.sessionProjectPath = this.parent.sessionProjectPath;
        this.__ghProvisionerSessionWorkspaceInitialized =
          this.parent.__ghProvisionerSessionWorkspaceInitialized;
      }

      const stateListOutput = await runOnTerraform(this, 'custom-command', [
        'state',
        'list',
      ]);

      const stateAddresses = parseStateList(stateListOutput);

      const untrackedFiles = stateAddresses.filter((addr) =>
        /^github_repository_file\.user_managed\[".+"\]$/.test(addr),
      );

      log.info(
        `[gh-provisioner] ${this.k8sId} keeping the following files [${untrackedFiles.join(', ')}]`,
      );

      if (untrackedFiles.length > 0) {
        const operationOutputs = await runOnTerraform(
          this,
          'custom-command',
          ['state', 'rm'].concat(untrackedFiles),
        );

        this.synthMessage(
          `\nkeeping files after feature uninstalled: \n - ${untrackedFiles.join('\n - ')}`,
        );

        log.debug(
          `[gh-provisioner] ${this.k8sId} state rm output ${operationOutputs}`,
        );
      }
    } catch (err) {
      throw new Error(
        `[gh-provisioner] ${this.k8sId} on untracking files: ${err}`,
      );
    }
  }

  async getFileContentFromProvider(
    org: string,
    repo: string,
    branch: string,
    path: string,
  ): Promise<string> {
    const content = await this.runWithGithubProvider(() =>
      github.repo.getContent(path, repo, org, branch),
    );

    return content as string;
  }
}

function parseStateList(output: any): string[] {
  if (!output || typeof output !== 'string') return [];

  return output
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean);
}
