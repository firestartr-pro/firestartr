import { getOctokitForOrg } from './auth';
import log from './logger';

const SHA1_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export async function listBranches(
  repo: string,
  owner = 'prefapp',
  octokit?: any,
) {
  log.info(`Getting branches for ${owner}/${repo}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(owner);
  }

  const response = await octokit.rest.repos.listBranches({
    owner,
    repo,
    per_page: 100,
    page: 0,
  });

  return response.data;
}

export async function getBranch(
  repo: string,
  branch: string,
  owner = 'prefapp',
  octokit?: any,
) {
  log.info(`Getting branch ${branch} for ${owner}/${repo}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(owner);
  }

  const response = await octokit.rest.repos.getBranch({
    owner,
    repo,
    branch,
  });

  return response.data;
}

export async function createBranch(
  repo: string,
  branch: string,
  sha: string,
  owner = 'prefapp',
  octokit?: any,
) {
  log.info(`Creating branch ${branch} for ${owner}/${repo}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(owner);
  }

  const response = await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha,
  });

  return response.data;
}

export async function createOrphanBranch(
  repo: string,
  branch: string,
  owner = 'prefapp',
  octokit?: any,
) {
  log.info(`Creating orphan branch ${branch} for ${owner}/${repo}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(owner);
  }

  // Create a commit with an empty tree
  const { data: commit } = await octokit.request(
    'POST /repos/{owner}/{repo}/git/commits',
    {
      owner,
      repo,
      message: `Inicializando rama huérfana ${branch}`,
      tree: SHA1_EMPTY_TREE,
      parents: [],
    },
  );

  // Create a reference to the commit
  const response = await octokit.request(
    'POST /repos/{owner}/{repo}/git/refs',
    {
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    },
  );

  return response.data;
}

export default {
  listBranches,
  getBranch,
  createBranch,
  createOrphanBranch,
};
