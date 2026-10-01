import type { GhApiLike, GithubInfo } from './types';

export async function gatherGithubInfo(ghApi: GhApiLike): Promise<GithubInfo> {
  const [repos, groups, webhooks, users] = await Promise.all([
    ghApi.listRepos().catch(() => []),
    ghApi.listGroups().catch(() => []),
    ghApi.listOrgWebhooks().catch(() => []),
    ghApi.listUsers?.().catch(() => []) ?? Promise.resolve([]),
  ]);

  return {
    repos,
    groups,
    users,
    webhooks: webhooks.map((wh) => wh.deliveryUrl),
  };
}
