import github from 'github';
import { isNotFound, type GithubError } from '../gh/errors';
import { retryAsync } from '../utils/async-control';
import { E2EState } from './state';

import type {
  GhApi,
  GhOrgSettings,
  GhOrgVariable,
  GhOrgWebhook,
} from '../types';

type RawOrgSettings = Record<string, unknown>;

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

type RawOrgWebhook = {
  id?: number;
  name?: string;
  active?: boolean;
  events?: unknown;
  config?: {
    url?: string;
  };
};

type RawRepoInfo = {
  description?: unknown;
  topics?: unknown;
};

type RawRepoSecret = {
  name?: unknown;
  updated_at?: unknown;
};

type RawOrgVariable = {
  name?: unknown;
  visibility?: unknown;
};

type RawSelectedRepo = {
  full_name?: unknown;
};

function normalizeRepoTopics(topics: unknown): string[] {
  if (!Array.isArray(topics)) {
    return [];
  }

  return topics.filter((topic): topic is string => typeof topic === 'string');
}

function normalizeOrgVariable(raw: RawOrgVariable): GhOrgVariable | null {
  if (typeof raw.name !== 'string' || typeof raw.visibility !== 'string') {
    return null;
  }

  const visibility = raw.visibility as GhOrgVariable['visibility'];
  if (!['all', 'private', 'selected'].includes(visibility)) {
    return null;
  }

  return {
    name: raw.name,
    visibility,
  };
}

function normalizeOrgWebhook(rawWebhook: RawOrgWebhook): GhOrgWebhook | null {
  if (typeof rawWebhook.id !== 'number') {
    return null;
  }

  if (typeof rawWebhook.config?.url !== 'string') {
    return null;
  }

  return {
    id: rawWebhook.id,
    deliveryUrl: rawWebhook.config.url,
    active: typeof rawWebhook.active === 'boolean' ? rawWebhook.active : false,
    events: Array.isArray(rawWebhook.events)
      ? rawWebhook.events.filter(
          (event): event is string => typeof event === 'string',
        )
      : [],
    name: typeof rawWebhook.name === 'string' ? rawWebhook.name : undefined,
  };
}

async function listOrgWebhooksForOrg(org: string): Promise<GhOrgWebhook[]> {
  const octokit = await github.getOctokitForOrg(org, true);
  const rawWebhooks = await octokit.paginate('GET /orgs/{org}/hooks', {
    org,
    per_page: 100,
  });

  return rawWebhooks
    .map((rawWebhook) => normalizeOrgWebhook(rawWebhook as RawOrgWebhook))
    .filter((webhook): webhook is GhOrgWebhook => webhook !== null);
}

async function findOrgVariableByName(
  org: string,
  name: string,
): Promise<GhOrgVariable | null> {
  try {
    const octokit = await github.getOctokitForOrg(org, true);
    const response = await octokit.rest.actions.getOrgVariable({
      org,
      name,
    });
    return normalizeOrgVariable(response.data as RawOrgVariable);
  } catch (err) {
    if (isNotFound(err as GithubError)) {
      return null;
    }
    throw err;
  }
}

export function createGhApi(state: E2EState): GhApi {
  const listOrgWebhooks = async (): Promise<GhOrgWebhook[]> => {
    return listOrgWebhooksForOrg(state.org);
  };

  const findOrgWebhookByUrl = async (
    url: string,
  ): Promise<GhOrgWebhook | null> => {
    const webhooks = await listOrgWebhooks();
    return webhooks.find((webhook) => webhook.deliveryUrl === url) ?? null;
  };

  const getRepoFile = async (
    repoName: string,
    filePath: string,
    retryOptions?: { attempts?: number; delayMs?: number },
  ): Promise<string> => {
    const attempts = retryOptions?.attempts ?? 1;
    const delayMs = retryOptions?.delayMs ?? 0;
    return retryAsync(
      () => github.repo.getContent(filePath, repoName, state.org),
      {
        attempts,
        shouldRetry: (err) => isNotFound(err as GithubError),
        getDelayMs: () => delayMs,
      },
    );
  };

  return {
    async repoExists(name: string): Promise<boolean> {
      try {
        await github.repo.getRepoInfo(state.org, name);
        return true;
      } catch (err) {
        if (isNotFound(err as GithubError)) {
          return false;
        }
        throw err;
      }
    },

    async getRepoInfo(name: string) {
      const repoInfo = (await github.repo.getRepoInfo(
        state.org,
        name,
      )) as RawRepoInfo;

      return {
        description:
          typeof repoInfo.description === 'string'
            ? repoInfo.description
            : null,
        topics: normalizeRepoTopics(repoInfo.topics),
      };
    },

    async getRepoSecret(repoName: string, secretName: string) {
      const repoSecret = (await github.repo.getRepoSecret(
        state.org,
        repoName,
        secretName,
      )) as RawRepoSecret;

      if (
        typeof repoSecret.name !== 'string' ||
        typeof repoSecret.updated_at !== 'string'
      ) {
        throw new Error(
          `GitHub repository secret ${state.org}/${repoName}/${secretName} returned incomplete metadata`,
        );
      }

      return {
        name: repoSecret.name,
        updatedAt: repoSecret.updated_at,
      };
    },

    async groupExists(name: string): Promise<boolean> {
      try {
        await github.team.getTeamInfo(name, state.org);
        return true;
      } catch (err) {
        if (isNotFound(err as GithubError)) {
          return false;
        }
        throw err;
      }
    },

    async listRepos(): Promise<string[]> {
      const octokit = await github.getOctokitForOrg(state.org, true);
      const repos: any[] = await octokit.paginate(
        octokit.rest.repos.listForOrg,
        {
          org: state.org,
          type: 'all',
          per_page: 100,
        },
      );

      return repos
        .map((repo) => repo?.name)
        .filter((name): name is string => typeof name === 'string');
    },

    async listGroups(): Promise<string[]> {
      const octokit = await github.getOctokitForOrg(state.org, true);
      const teams: any[] = await octokit.paginate(octokit.rest.teams.list, {
        org: state.org,
        per_page: 100,
      });

      return teams
        .map((team) =>
          typeof team?.slug === 'string'
            ? team.slug
            : typeof team?.name === 'string'
              ? team.name
              : undefined,
        )
        .filter((name): name is string => typeof name === 'string');
    },

    async listOrgWebhooks(): Promise<GhOrgWebhook[]> {
      return listOrgWebhooks();
    },

    async findOrgWebhookByUrl(url: string): Promise<GhOrgWebhook | null> {
      return findOrgWebhookByUrl(url);
    },

    async orgWebhookExists(url: string): Promise<boolean> {
      return (await findOrgWebhookByUrl(url)) !== null;
    },

    async getOrgSettings(): Promise<GhOrgSettings> {
      const info = (await github.org.getOrgInfo(state.org)) as RawOrgSettings;

      return {
        description: asStringOrNull(info.description),
        company: asStringOrNull(info.company),
        hasOrganizationProjects: asBoolOrNull(info.has_organization_projects),
      };
    },

    async destroyRepo(name: string): Promise<void> {
      const octokit = await github.getOctokitForOrg(state.org);
      await octokit.rest.repos.delete({ owner: state.org, repo: name });
    },

    async destroyGroup(name: string): Promise<void> {
      const octokit = await github.getOctokitForOrg(state.org);
      await octokit.rest.teams.deleteInOrg({
        org: state.org,
        team_slug: name,
      });
    },

    async destroyOrgWebhookByUrl(url: string): Promise<void> {
      const matchingWebhooks = (await listOrgWebhooks()).filter(
        (webhook) => webhook.deliveryUrl === url,
      );

      if (matchingWebhooks.length === 0) {
        return;
      }

      const octokit = await github.getOctokitForOrg(state.org);

      for (const webhook of matchingWebhooks) {
        try {
          await octokit.request('DELETE /orgs/{org}/hooks/{hook_id}', {
            org: state.org,
            hook_id: webhook.id,
          });
        } catch (err) {
          if (isNotFound(err as GithubError)) {
            continue;
          }

          throw err;
        }
      }
    },

    async listOrgVariables(): Promise<GhOrgVariable[]> {
      const octokit = await github.getOctokitForOrg(state.org, true);
      const rawVariables: RawOrgVariable[] = [];

      for (let page = 1; ; page += 1) {
        const response = await octokit.rest.actions.listOrgVariables({
          org: state.org,
          per_page: 100,
          page,
        });
        const pageVariables = (response.data.variables ??
          []) as RawOrgVariable[];
        rawVariables.push(...pageVariables);
        if (pageVariables.length < 100) {
          break;
        }
      }

      return rawVariables
        .map((raw) => normalizeOrgVariable(raw))
        .filter((variable): variable is GhOrgVariable => variable !== null);
    },

    async findOrgVariableByName(name: string): Promise<GhOrgVariable | null> {
      return findOrgVariableByName(state.org, name);
    },

    async orgVariableExists(name: string): Promise<boolean> {
      return (await findOrgVariableByName(state.org, name)) !== null;
    },

    async createOrgVariable(
      name: string,
      value: string,
      visibility: 'all' | 'private' | 'selected',
      selectedRepositoryIds?: number[],
    ): Promise<void> {
      const octokit = await github.getOctokitForOrg(state.org);

      if (
        visibility === 'selected' &&
        (!selectedRepositoryIds || selectedRepositoryIds.length === 0)
      ) {
        throw new Error(
          'createOrgVariable: selectedRepositoryIds is required when visibility is "selected"',
        );
      }

      const payload = {
        org: state.org,
        name,
        value,
        visibility,
        ...(visibility === 'selected'
          ? { selected_repository_ids: selectedRepositoryIds! }
          : {}),
      };

      await octokit.rest.actions.createOrgVariable(payload as any);
    },

    async deleteOrgVariable(name: string): Promise<void> {
      const octokit = await github.getOctokitForOrg(state.org);
      try {
        await octokit.rest.actions.deleteOrgVariable({
          org: state.org,
          name,
        });
      } catch (err) {
        if (isNotFound(err as GithubError)) {
          return;
        }
        throw err;
      }
    },

    async getOrgVariableSelectedRepositories(name: string): Promise<string[]> {
      const octokit = await github.getOctokitForOrg(state.org, true);
      const repos = (await octokit.paginate(
        'GET /orgs/{org}/actions/variables/{name}/repositories',
        {
          org: state.org,
          name,
          per_page: 100,
        },
      )) as RawSelectedRepo[];

      return repos
        .map((repo) =>
          typeof repo.full_name === 'string' ? repo.full_name : undefined,
        )
        .filter((name): name is string => typeof name === 'string');
    },

    async getRateLimit() {
      const octokit = await github.getOctokitForOrg(state.org, true);
      const response = await octokit.rest.rateLimit.get();
      const core = response.data.resources.core;

      return {
        core: {
          limit: core.limit,
          remaining: core.remaining,
          reset: core.reset,
        },
      };
    },

    getRepoFile,

    async tryGetRepoFile(
      repoName: string,
      filePath: string,
    ): Promise<string | null> {
      try {
        return await getRepoFile(repoName, filePath);
      } catch (err) {
        if (isNotFound(err as GithubError)) {
          return null;
        }

        throw err;
      }
    },

    async getRepoLabels(repoName: string) {
      return github.repo.getRepoIssuesLabels(state.org, repoName);
    },

    async createRepoLabel(
      repoName: string,
      label: { name: string; color: string; description?: string },
    ): Promise<void> {
      await github.repo.createRepoLabel(
        state.org,
        repoName,
        label.name,
        label.color,
        label.description,
      );
    },
  };
}
