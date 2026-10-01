import  GroupCollectionGithubDecanter from "../src/decanter/gh/github_group_collection"
import  RepoCollectionGithubDecanter from "../src/decanter/gh/github_repo_collection"
import { setClaimsPath } from "../src/decanter/config";
import * as path from "path";

describe('Test for import all kinds',() => {
  jest.setTimeout(300000);

  it.skip("it should be able to filter and import groups", async () => {
    setClaimsPath(path.join(__dirname, "fixtures/claims"));

    const gh_groups = new GroupCollectionGithubDecanter({}, "firestartr-test")

    let collection:any[] = await gh_groups.collection()
    let groups: any[] = [];

    for(const group of collection){
      await group.gather();
      group.decant();
      groups.push(await group.adapt());
      group.render();
    }

    console.dir(collection, { depth: null })
    console.dir(groups, { depth: null })
  })

  it.skip("it should be able to filter and import repos", async () => {
    setClaimsPath(path.join(__dirname, "fixtures/claims"));

    const gh_repos = new RepoCollectionGithubDecanter({}, "firestartr-test")

    let collection: any[] = await gh_repos.collection();
    let repos: any[] = [];

    for(const repo of collection){
      await repo.gather();
      repo.decant();
      repos.push(await repo.adapt());
      repo.render();
    }
  })
});
