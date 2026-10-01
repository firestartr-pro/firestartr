import { Octokit } from '@octokit/rest';
import { getOctokitForOrg } from './auth';

import log from './logger';

async function create(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels: string[] = [],
  octokit?: any,
): Promise<any> {
  log.info(`Creating issue in ${owner}/${repo}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(owner);
  }

  return await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body,
    labels,
  });
}

async function update(
  owner: string,
  repo: string,
  issue_number: number,
  title: string,
  body: string,
  labels: string[] = [],
  octokit?: any,
): Promise<any> {
  log.info(`Updating issue ${issue_number} in ${owner}/${repo}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(owner);
  }

  return await octokit.rest.issues.update({
    owner,
    repo,
    issue_number,
    title,
    body,
    labels,
  });
}

async function filterBy(
  owner: string,
  repo: string,
  title: string,
  labels: string,
  state: 'open' | 'closed' | 'all' = 'open',
  creator: string | undefined = undefined,
  assignee: string | undefined = undefined,
  octokit?: any,
): Promise<any> {
  log.info(`Filtering issues by title in ${owner}/${repo}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(owner);
  }

  const resp = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state,
    creator,
    assignee,
    labels,
    per_page: 100,
    page: 0,
  });

  return resp.data.filter((issue: any) => issue.title.includes(title));
}

async function upsertByTitle(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels: string[] = [],
  octokit?: any,
): Promise<any> {
  log.info(`Upserting issue by title in ${owner}/${repo}`);

  const foundIssues = await filterBy(
    owner,
    repo,
    title,
    labels.join(','),
    'open',
    undefined,
    undefined,
    octokit,
  );

  if (foundIssues.length > 0) {
    return update(
      owner,
      repo,
      foundIssues[0].number,
      title,
      body,
      labels,
      octokit,
    );
  } else {
    return create(owner, repo, title, body, labels, octokit);
  }
}

async function close(
  owner: string,
  repo: string,
  issue_number: number,
  octokit?: any,
): Promise<any> {
  log.info(`Closing issue ${issue_number} in ${owner}/${repo}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(owner);
  }

  return await octokit.rest.issues.update({
    owner,
    repo,
    issue_number,
    state: 'closed',
  });
}

export default {
  create,
  update,
  close,
  filterBy,
  upsertByTitle,
};
