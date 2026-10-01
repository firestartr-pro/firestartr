import { Entity, PatchOperations } from '../../base';

import log from '../../../logger';

import { EntityGHFeature } from '../';

export interface ManagedFilesResult {
  newlyProvisionedAddresses: string[];
  installedManagedFiles: string[];
}

/**
 * Migration reimport path for `import-with-reimport` operations.
 *
 * Populates `config.files` with ONLY non-user-managed files so the subsequent
 * `loadAddressesToImport` can generate correct import blocks for them.
 * Seeds `installed_managed_files` from ALL `userManaged: true` addresses in the
 * current CR spec so the TFM input is ready for the next regular apply cycle.
 */
export async function seedForMigrationReimport(
  ghFeature: EntityGHFeature,
): Promise<void> {
  const cr = ghFeature.cr;

  const repoInfo: any = cr.spec.repositoryTarget;

  // Only non-user-managed files go into TF config during migration reimport.
  // User-managed files receive no import block (see ADR 0005).
  for (const file of cr.spec.files) {
    if (!file.userManaged) {
      createFileProvision(ghFeature, file);
    }
  }

  // Seed installed_managed_files from ALL userManaged:true addresses in spec.
  // This ensures the TFM input is populated so the output is computable on the
  // operator's next regular apply (second cycle of the two-cycle migration).
  const allUserManagedAddresses: string[] = cr.spec.files
    .filter((f: any) => f.userManaged)
    .map((f: any) => `${f.path}/${f.targetBranch || repoInfo.branch}`);

  ghFeature.patchData({
    op: PatchOperations.replace,

    path: '/installed_managed_files',

    value: allUserManagedAddresses,
  });
}

export async function provisionManagedFiles(
  ghFeature: EntityGHFeature,
): Promise<ManagedFilesResult> {
  const cr = ghFeature.cr;

  const repoInfo: any = cr.spec.repositoryTarget;

  const repoRef = Entity.refResolver(cr.spec.repositoryTarget.ref);

  // Read the accumulated list of previously provisioned user-managed file addresses
  // from the entity's output secrets. Defaults to [] on first apply.
  const selfOutputs = Entity.refResolver({ kind: 'self', name: 'outputs' });

  const rawInstalledFiles = selfOutputs?.getOutput('installed_managed_files');

  const installedManagedFiles: string[] = Array.isArray(rawInstalledFiles)
    ? rawInstalledFiles
    : [];

  const newlyProvisionedAddresses: string[] = [];

  for (const file of cr.spec.files) {
    const branch = file.targetBranch || repoInfo.branch;
    const address = `${file.path}/${branch}`;

    if (file.userManaged) {
      if (installedManagedFiles.includes(address)) {
        // Already provisioned — skip from TF config entirely so Terraform
        // never overwrites or deletes user edits.
        continue;
      }

      // New user-managed file — provision once. Fetch existing content from
      // the repo if available so the seed commit preserves the current state.
      newlyProvisionedAddresses.push(address);

      try {
        const content = await ghFeature.getFileContentFromProvider(
          cr.spec.org,
          repoRef.getDepName(),
          branch,
          file.path,
        );

        file.content = Buffer.from(content, 'binary').toString('base64');
      } catch (e: any) {
        if (e?.status !== 404) {
          throw e;
        }

        log.info(
          `File ${file.path} not found in repo ${repoInfo.ref?.name} on branch ${branch}. Using declared content`,
        );
      }

      createFileProvision(ghFeature, file);
    } else {
      // Non-user-managed — add to TF config normally (Terraform manages content).
      createFileProvision(ghFeature, file);
    }
  }

  // Write the updated accumulated address list back into the document as a
  // top-level TFM input. The TFM output will grow this list monotonically
  // and subtract any files that transition away from userManaged.
  ghFeature.patchData({
    op: PatchOperations.replace,

    path: '/installed_managed_files',

    value: [...installedManagedFiles, ...newlyProvisionedAddresses],
  });

  return { newlyProvisionedAddresses, installedManagedFiles };
}

function createFileProvision(ghFeature: EntityGHFeature, file: any) {
  const cr = ghFeature.cr;

  const defaultBranchName = cr.spec.repositoryTarget.branch;

  const config = {
    branch: file.targetBranch || defaultBranchName,

    commitMessage: `ci: ${cr.spec.type} ${cr.spec.version}`,

    content: Buffer.from(file.content, 'base64').toString(),

    file: file.path,

    overwriteOnCreate: true,

    userManaged: file.userManaged ? true : false,
  };

  ghFeature.patchData({
    op: PatchOperations.add,

    path: '/config/files/-',

    value: config,
  });
}
