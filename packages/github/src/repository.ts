import { getOctokitForOrg } from './auth';
import * as fs from 'fs';
import { OctokitResponse } from '@octokit/types';

import log from './logger';

type commitStatusState = 'error' | 'failure' | 'pending' | 'success';

export async function listReleases(repo: string, owner = 'prefapp') {
  log.info(`Getting releases for ${owner}/${repo}`);

  const octokit = await getOctokitForOrg(owner);

  const response = await octokit.rest.repos.listReleases({
    owner,
    repo,
    per_page: 100,
    page: 0,
  });

  return response.data;
}

export async function getReleaseByTag(
  releaseTag: string,
  repo: string,
  owner = 'prefapp',
) {
  log.info(`Getting release ${releaseTag} for ${owner}/${repo}`);

  const octokit = await getOctokitForOrg(owner);

  const response = await octokit.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag: releaseTag,
  });

  return response.data;
}

// Not exported, internal user for getContent and deleteFile
async function getFileFromGithub(
  path: string,
  repo: string,
  owner = 'prefapp',
) {
  const octokit = await getOctokitForOrg(owner);

  return await octokit.rest.repos.getContent({ owner, repo, path });
}

export async function getContent(
  path: string,
  repo: string,
  owner = 'prefapp',
  ref = '',
) {
  log.info(`Getting content for ${owner}/${repo}/${path}`);

  const octokit = await getOctokitForOrg(owner);

  const opts: any = {
    owner,
    repo,
    path,
  };

  if (ref) {
    opts.ref = ref;
  }

  const content: any = await octokit.rest.repos.getContent(opts);

  return Buffer.from(content.data.content, 'base64').toString('utf8');
}

export async function getRepoInfo(owner: string, name: string) {
  log.info(`Getting repo info for ${owner}/${name}`);

  const octokit = await getOctokitForOrg(owner);

  const res = await octokit.repos.get({ owner: owner, repo: name });

  return res['data'];
}

export async function getRepoSecret(
  owner: string,
  repo: string,
  secretName: string,
) {
  log.info(`Getting repo secret ${owner}/${repo}/${secretName}`);

  const octokit = await getOctokitForOrg(owner);
  const response = await octokit.rest.actions.getRepoSecret({
    owner,
    repo,
    secret_name: secretName,
  });

  return response.data;
}

export async function repoExists(
  owner: string,
  name: string,
): Promise<boolean> {
  log.info(`Checking if repo exists: ${owner}/${name}`);

  try {
    await getRepoInfo(owner, name);
    return true;
  } catch (error) {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? (error as { status?: number }).status
        : undefined;

    if (status === 404) {
      return false;
    }

    log.error(`Failed to determine if repo exists: ${owner}/${name}`, error);
    throw error;
  }
}

export async function getPages(owner: string, name: string) {
  log.info(`Getting pages for ${owner}/${name}`);

  const octokit = await getOctokitForOrg(owner);

  const res = await octokit.repos.getPages({ owner: owner, repo: name });

  return res['data'];
}

export async function getOIDCRepo(
  owner: string,
  name: string,
): Promise<OctokitResponse<any>> {
  log.info(`Getting repo info for ${owner}/${name}`);

  const octokit = await getOctokitForOrg(owner);

  return await octokit.request(
    `GET /repos/${owner}/${name}/actions/oidc/customization/sub`,
    {
      owner: owner,

      repo: name,

      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
}

export async function getBranchProtection(
  owner: string,
  repo: string,
  branch = 'main',
) {
  log.info(`Getting branch protection for ${owner}/${repo}/${branch}`);

  const octokit = await getOctokitForOrg(owner);

  const res = await octokit.repos.getBranchProtection({
    owner: owner,
    repo: repo,
    branch: branch,
  });
  return res['data'];
}

export async function getTeams(owner: string, repo: string) {
  log.info(`Getting teams for ${owner}/${repo}`);

  const octokit = await getOctokitForOrg(owner);

  const res = await octokit.repos.listTeams({ owner: owner, repo: repo });

  return res['data'];
}

export async function getCollaborators(
  owner: string,
  repo: string,
  affiliation: 'outside' | 'direct' | 'all' | undefined = 'direct',
) {
  log.info(`Getting collaborators for ${owner}/${repo}`);

  const octokit = await getOctokitForOrg(owner);

  const res = await octokit.repos.listCollaborators({
    owner: owner,
    repo: repo,
    affiliation: affiliation,
  });

  return res['data'];
}

export async function setContent(
  path: string,
  fileContent: string,
  repo: string,
  owner = 'prefapp',
  branch = 'main',
  message = '',
) {
  const base64Content = Buffer.from(fileContent, 'utf8').toString('base64');

  log.info(`Setting content for ${owner}/${repo}/${path}`);

  if (message === '') {
    message = `Update ${path}`;
  }

  let sha: undefined | string = undefined;

  try {
    const currentContent: any = await getFileFromGithub(path, repo, owner);
    sha = currentContent.data.sha;
    log.debug('File already exists, updating it');
  } catch {
    log.debug('File does not exist, creating it');
  }

  const octokit = await getOctokitForOrg(owner);

  await octokit.rest.repos.createOrUpdateFileContents({
    owner: owner,
    repo: repo,
    path: path,
    message: message,
    content: base64Content,
    sha: sha,
    branch: branch,
  });
}

export async function uploadFile(
  destinationPath: string,
  filePath: string,
  repo: string,
  owner = 'prefapp',
  branch = 'main',
  message = '',
) {
  if (!fs.existsSync(filePath)) {
    log.error(`File ${filePath} does not exists or is not readable`);
    throw `${filePath} does not exists or is not readable`;
  }

  // Read file contents and call setContent
  const fileContent = fs.readFileSync(filePath, 'utf8');
  await setContent(destinationPath, fileContent, repo, owner, branch, message);
}

export async function deleteFile(
  path: string,
  repo: string,
  owner = 'prefapp',
  branch = 'main',
  message = '',
) {
  let sha: undefined | string = undefined;

  log.info(`Deleting file ${owner}/${repo}/${path}`);

  try {
    const currentContent: any = await getFileFromGithub(path, repo, owner);
    sha = currentContent.data.sha;
  } catch {
    log.error(`File ${path} does not exist in ${repo}`);
  }

  if (!sha) {
    log.error(`File ${path} does not exist in ${repo}`);
    throw `File ${path} does not exist in ${repo}`;
  }

  if (message === '') {
    message = `Delete ${path}`;
  }

  const octokit = await getOctokitForOrg(owner);

  await octokit.rest.repos.deleteFile({
    owner: owner,
    repo: repo,
    path: path,
    message: message,
    sha: sha,
    branch: branch,
  });
}

export async function addStatusCheck(
  output: any,
  is_failure: boolean,
  head_sha: string,
  name: string,
  status: string,
  repo: string,
  owner = 'prefapp',
) {
  log.info(`Adding status checks to commit ${head_sha} in ${owner}/${repo}`);

  const octokit = await getOctokitForOrg(owner);
  const payload: any = { output, head_sha, name, owner, repo, status };

  if (status === 'completed') {
    payload['conclusion'] = is_failure ? 'failure' : 'success';
  }

  await octokit.rest.checks.create(payload);
}

export async function addCommitStatus(
  state: commitStatusState,
  sha: string,
  repo: string,
  owner = 'prefapp',
  target_url = '',
  description = '',
  context = '',
) {
  log.info(
    `Adding commit status with state ${state} to SHA ${sha} in ${owner}/${repo}`,
  );

  const octokit = await getOctokitForOrg(owner);

  await octokit.rest.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    target_url,
    description,
    context,
  });
}

export async function getRepoIssuesLabels(owner: string, repo: string) {
  log.info(`Getting issues labels for ${owner}/${repo}`);

  const octokit = await getOctokitForOrg(owner);

  const res = await octokit.issues.listLabelsForRepo({
    owner: owner,
    repo: repo,
  });

  const metadataLabels = res.data.map((label) => ({
    name: label.name,
    description: label.description || '',
    color: label.color,
  }));

  log.info(`Got ${metadataLabels.length} labels for ${owner}/${repo}`);

  return metadataLabels;
}

export async function createRepoLabel(
  owner: string,
  repo: string,
  name: string,
  color: string,
  description?: string,
) {
  log.info(`Creating label '${name}' in ${owner}/${repo}`);

  const octokit = await getOctokitForOrg(owner);

  const res = await octokit.issues.createLabel({
    owner,
    repo,
    name,
    color,
    description,
  });

  return res.data;
}

export async function updateRepoLabel(
  owner: string,
  repo: string,
  name: string,
  color: string,
  description?: string,
) {
  log.info(
    `Updating label '${name}' in ${owner}/${repo} color=${color} description=${description}`,
  );

  const octokit = await getOctokitForOrg(owner);

  const res = await octokit.issues.updateLabel({
    owner,
    repo,
    name,
    color,
    description,
  });

  log.info(
    `Updated label '${name}' in ${owner}/${repo} — GitHub response: color=${res.data.color} description=${res.data.description}`,
  );

  return res.data;
}

export async function isEmptyRepo(
  owner: string,
  name: string,
): Promise<boolean> {
  log.info(`Checking if repo is empty: ${owner}/${name}`);
  const octokit = await getOctokitForOrg(owner);
  const response = await octokit.rest.repos.listBranches({
    owner,
    repo: name,
    per_page: 1,
  });
  return response.data.length === 0;
}

export default {
  listReleases,
  getReleaseByTag,
  getContent,
  setContent,
  uploadFile,
  deleteFile,
  getRepoInfo,
  getRepoSecret,
  repoExists,
  getPages,
  getBranchProtection,
  getTeams,
  getCollaborators,
  getOIDCRepo,
  addStatusCheck,
  addCommitStatus,
  getRepoIssuesLabels,
  createRepoLabel,
  updateRepoLabel,
  isEmptyRepo,
};
