import log from '../../../logger';

import { EntityGHRepo } from '../';

import github from 'github';

// Main function to provision additional branches
export async function provisionAdditionalBranches(
  ghrepo: EntityGHRepo,
): Promise<void> {
  const cr = ghrepo.cr;

  log.debug(
    `[gh-provisioner] provision additional branches ${JSON.stringify(cr)}`,
  );

  // Verify that the cr and its properties exist
  if (!cr || !cr.spec || !cr.spec.repo) {
    log.info('[gh-provisioner] Invalid cr object: JSON.stringify(cr)');
    return;
  }

  // Obtain the additional branches from the repository configuration
  const branches = cr.spec.repo.additionalBranches;

  if (!Array.isArray(branches)) {
    log.info(
      `[gh-provisioner] ${ghrepo.k8sId} no additional branches found or branches is not an array`,
    );
    return;
  }

  const repoName = cr.name;
  const org = cr.spec.org;

  // Process each branch individually
  for (const branch of branches) {
    try {
      // Try to obtain the branch
      await github.branches.getBranch(repoName, branch.name, org);
      // If not error is thrown, the branch already exists
      log.debug(
        `[gh-provisioner] ${ghrepo.k8sId} Branch ${branch.name} already exists in ${org}/${repoName}, skipping...`,
      );
    } catch (error: any) {
      // If error is a 404, we can create the branch
      if (error.status === 404) {
        if (branch.orphan) {
          await github.branches.createOrphanBranch(repoName, branch.name, org);
          log.debug(
            `[gh-provisioner] ${ghrepo.k8sId} Created orphan branch ${branch.name} in ${org}/${repoName}`,
          );
        } else {
          await provisionRegularBranch(
            repoName,
            branch.name,
            cr.spec.repo.defaultBranch,
            org,
          );
          log.info(
            `[gh-provisioner] ${ghrepo.k8sId} Created regular branch ${branch.name} in ${org}/${repoName}`,
          );
        }
      } else {
        // If error is not a 404, we throw it
        throw error;
      }
    }
  }
}

// function to provision a regular branch
async function provisionRegularBranch(
  repo: string,
  branchName: string,
  sourceBranch: string,
  org: string,
) {
  // Obtaining the sha of the source branch
  const sourceBranchData = await github.branches.getBranch(
    repo,
    sourceBranch,
    org,
  );
  const sha = sourceBranchData.commit.sha;

  // Create the new branch
  await github.branches.createBranch(repo, branchName, sha, org);
}
