import github from 'github';
import * as fs from 'fs';
import * as path from 'path';

import log from './logger';

export class Scaffolder {
  octokit: any;

  constructor(org: string) {
    this.octokit = github.getOctokitForOrg(org);
  }

  getFilesInDirectory(
    directoryPath: string,
    relativePath = '',
  ): Array<{ fullPath: string; relativePath: string }> {
    let fileList: Array<{ fullPath: string; relativePath: string }> = [];

    const files = fs.readdirSync(directoryPath);

    for (const file of files) {
      const fullPath = path.join(directoryPath, file);

      const fileRelativePath = path.join(relativePath, file);

      if (fs.lstatSync(fullPath).isDirectory()) {
        fileList = fileList.concat(
          this.getFilesInDirectory(fullPath, fileRelativePath),
        );
      } else {
        fileList.push({ fullPath, relativePath: fileRelativePath });
      }
    }

    return fileList;
  }

  createTree(
    files: Array<{ fullPath: string; relativePath: string }>,
    destinationPath: string,
  ): Array<any> {
    const tree: any[] = [];

    for (const { fullPath, relativePath } of files) {
      const fileContent = fs.readFileSync(fullPath, 'utf8');

      const content = Buffer.from(fileContent, 'utf8').toString('utf8');

      tree.push({
        path: path.join(destinationPath, relativePath),

        mode: '100644',

        type: 'blob',

        content: content,
      });
    }

    return tree;
  }

  async pushPendingSkeletons(
    scaffoldersPath: string,
    org: string,
  ): Promise<string[]> {
    const skeletonsPaths = this.getSkeletonsPaths(scaffoldersPath);

    const pushedSkeletons: string[] = [];

    for (const skeletonPath of skeletonsPaths) {
      try {
        await this.pushSkeletonToRepo(
          path.join(scaffoldersPath, skeletonPath),
          skeletonPath,
          org,
        );

        pushedSkeletons.push(skeletonPath);
      } catch (e: any) {
        log.error(`pushPendingSkeletons: ${e}`);
      }
    }

    return pushedSkeletons;
  }

  async syncSkeletons(scaffoldersPath: string, org: string) {
    const pushedSkeletons = await this.pushPendingSkeletons(
      scaffoldersPath,
      org,
    );

    this.removePushedSkeletonsFromCatalog(scaffoldersPath, pushedSkeletons);
  }

  removePushedSkeletonsFromCatalog(
    scaffoldersPath: string,
    pushedSkeletons: string[],
  ) {
    for (const pushedSkeleton of pushedSkeletons) {
      fs.rmdirSync(path.join(scaffoldersPath, pushedSkeleton), {
        recursive: true,
      });
    }
  }

  getSkeletonsPaths(scaffoldersPath: string) {
    const skeletonsPaths = fs
      .readdirSync(scaffoldersPath)
      .filter((skeletonPath) =>
        fs.lstatSync(path.join(scaffoldersPath, skeletonPath)).isDirectory(),
      );

    return skeletonsPaths;
  }

  async pushSkeletonToRepo(
    directoryPath: string,

    repo: string,

    owner: string,

    destinationPath = '',
  ) {
    try {
      if (
        !fs.existsSync(directoryPath) ||
        !fs.lstatSync(directoryPath).isDirectory()
      ) {
        log.error(
          `Directory ${directoryPath} does not exist or is not a directory`,
        );

        throw `${directoryPath} does not exist or is not a directory`;
      }

      log.info(
        `Pushing skeleton ${directoryPath} to ${owner}/${repo} at ${destinationPath}`,
      );

      const files = this.getFilesInDirectory(directoryPath);

      const tree = this.createTree(files, destinationPath);

      // Get the default branch name
      const repoData = await this.octokit.rest.repos.get({
        owner,

        repo,
      });

      const defaultBranch = repoData.data.default_branch;

      // Get reference to the branch
      const branchRef = await this.octokit.rest.git.getRef({
        owner,

        repo,

        ref: `heads/${defaultBranch}`,
      });

      //Get the commit that the branch points to
      const latestCommit = await this.octokit.rest.git.getCommit({
        owner,

        repo,

        commit_sha: branchRef.data.object.sha,
      });

      // Create a tree with the new file(s)
      const newTree = await this.octokit.rest.git.createTree({
        owner,

        repo,

        base_tree: latestCommit.data.tree.sha,

        tree,
      });

      // Create a new commit with the new tree
      const newCommit = await this.octokit.rest.git.createCommit({
        owner,

        repo,

        message: `Update files in ${destinationPath}`,

        tree: newTree.data.sha,

        parents: [latestCommit.data.sha],
      });

      // Update the branch reference to point to the new commit
      await this.octokit.rest.git.updateRef({
        owner,

        repo,

        ref: `heads/${defaultBranch}`,

        sha: newCommit.data.sha,
      });

      log.info(
        `Pushed skeleton ${directoryPath} to ${owner}/${repo} at ${destinationPath}`,
      );
    } catch (e: any) {
      log.error(
        `Error pushing skeleton ${directoryPath} to ${owner}/${repo} at ${destinationPath}: ${e.message}`,
      );

      throw e;
    }
  }
}
