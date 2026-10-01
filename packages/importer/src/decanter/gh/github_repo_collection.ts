import RepoGithubDecanter from './github_repo';
import { ICollection, applyCollectionMixins } from '../collections';
import { CollectionFilter } from '../filters';
import { GithubDecanter } from './base';

class RepoCollectionGithubDecanter extends GithubDecanter {
  static collectionKind = 'gh-repo';

  async collection(filters: CollectionFilter[] = []) {
    if (
      this.IS_SKIP_SET(filters, RepoCollectionGithubDecanter.collectionKind)
    ) {
      return [];
    }

    const { teams, repositories: directAccessRepos } =
      await this.github.org.getOrgTeamsDirectAccess(this.org);

    let repoList = await this.github.org.getRepositoryList(this.org);

    repoList = repoList.filter((el: any) => !el.archived);

    const repoMap: any = {};

    repoList.forEach((repo: any) => {
      repoMap[repo.name] = repo;
    });

    const repos: RepoGithubDecanter[] = [];

    const filteredRepos = await this.filter(
      RepoCollectionGithubDecanter.collectionKind,

      filters,

      repoList.map((repo: any) => repo.name),
    );

    for (const repoName of filteredRepos) {
      const repoInfo = await this.github.repo.getRepoInfo(this.org, repoName);

      const repoDecanter = new RepoGithubDecanter(
        { repoDetails: repoInfo },

        this.org,

        directAccessRepos?.[repoName],
      );

      repos.push(repoDecanter);
    }

    this.data['collection'] = repos;

    return repos;
  }
}

interface RepoCollectionGithubDecanter extends ICollection {}

applyCollectionMixins(RepoCollectionGithubDecanter);

export default RepoCollectionGithubDecanter;
