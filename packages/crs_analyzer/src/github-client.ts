import github from 'github';

export class GithubClient {
  async upsertIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
    labels: string[],
  ) {
    return github.issues.upsertByTitle(owner, repo, title, body, labels);
  }

  async listIssues(
    owner: string,
    repo: string,
    title: string,
    labels: string[],
  ) {
    return github.issues.filterBy(owner, repo, title, labels.join(','));
  }

  async closeIssue(owner: string, repo: string, issueNumber: number) {
    return github.issues.close(owner, repo, issueNumber);
  }
}
