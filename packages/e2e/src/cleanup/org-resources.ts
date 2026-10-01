import common from 'catalog_common';
import { getStatusCode as getHttpStatusCode } from '../errors/status-code';
import { isNotFound, type GithubError } from '../gh/errors';
import type { E2EApi } from '../types';
import { retryAsync } from '../utils/async-control';
import { isTransientError } from '../utils/transient-errors';
import { getDeletionOrder, resolveFixtureResources } from './fixture-plan';
import { normalizeResourceNames } from './resource-names';
import type { DestroyOrgResourcesOptions, FixtureResourceInput } from './types';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// 409/423 are GitHub-specific transient codes; 408/429/5xx are covered by
// isTransientError.
const EXTRA_RETRYABLE_STATUS_CODES = new Set([409, 423]);
const DELETE_RETRY_ATTEMPTS = 3;
const DELETE_RETRY_BACKOFF_MS = 1000;

type ListResourceNamesResult = {
  names: string[];
  listed: boolean;
};

function matchesResourceBase(name: string, baseName: string): boolean {
  if (name === baseName) {
    return true;
  }

  if (!name.startsWith(`${baseName}-`)) {
    return false;
  }

  const suffix = name.slice(baseName.length + 1);
  return UUID_V4_REGEX.test(suffix);
}

function isMissingAppConfigError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('appId option is required');
}

async function listResourceNames(
  list: () => Promise<string[]>,
  strict: boolean,
): Promise<ListResourceNamesResult> {
  try {
    return {
      names: await list(),
      listed: true,
    };
  } catch (err) {
    if (strict) {
      throw err;
    }

    if (isMissingAppConfigError(err)) {
      return {
        names: [],
        listed: false,
      };
    }

    // Some GitHub app installations do not grant list endpoints for org teams
    // or repos. Keep pre-clean best-effort by falling back to exact-name
    // deletion paths when listing is not available.
    return {
      names: [],
      listed: false,
    };
  }
}

function isRetryableDeleteError(err: unknown): boolean {
  if (isTransientError(err)) return true;
  const statusCode = getHttpStatusCode(err as { status?: number });
  return (
    statusCode !== undefined && EXTRA_RETRYABLE_STATUS_CODES.has(statusCode)
  );
}

async function tryDestroyDirect(
  destroy: () => Promise<void>,
  strict: boolean,
): Promise<void> {
  await retryAsync(
    async () => {
      try {
        await destroy();
      } catch (err) {
        if (isNotFound(err as GithubError)) {
          return;
        }

        if (!strict && isMissingAppConfigError(err)) {
          return;
        }

        throw err;
      }
    },
    {
      attempts: DELETE_RETRY_ATTEMPTS,
      shouldRetry: (err) => isRetryableDeleteError(err),
      getDelayMs: (_err, attempt) => DELETE_RETRY_BACKOFF_MS * attempt,
      onRetry: (err, attempt, delayMs) => {
        common.logger.warn(
          `Retrying GitHub resource deletion after ${delayMs}ms (attempt ${attempt + 1}/${DELETE_RETRY_ATTEMPTS}) due to: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      },
    },
  );
}

// Pre-clean helper: destroys matching GitHub groups/repos for each provided
// base name. When includePrefixed=true, it first lists org resources and also
// removes entries that start with "<base>-" (useful for uuid-suffixed names).
// With strict=false (default), it silences "appId option is required" errors
// so tests can run without GitHub App credentials pre-configured.
export async function destroyOrgResources(
  client: E2EApi,
  resourceNames: string[],
  options: DestroyOrgResourcesOptions = {},
): Promise<void> {
  const baseNames = normalizeResourceNames(resourceNames);
  const orgWebhookUrls = normalizeResourceNames(options.orgWebhookUrls ?? []);
  if (baseNames.length < 1 && orgWebhookUrls.length < 1) {
    return;
  }

  const includePrefixed = options.includePrefixed ?? false;
  const strict = options.strict ?? false;
  const [groupsResult, reposResult] = includePrefixed
    ? await Promise.all([
        listResourceNames(() => client.gh.listGroups(), strict),
        listResourceNames(() => client.gh.listRepos(), strict),
      ])
    : [
        { names: [], listed: false },
        { names: [], listed: false },
      ];
  const allGroups = groupsResult.names;
  const allRepos = reposResult.names;
  const canUseListedGroups = includePrefixed && groupsResult.listed;
  const canUseListedRepos = includePrefixed && reposResult.listed;

  const destroyedGroups = new Set<string>();
  const destroyedRepos = new Set<string>();
  const destroyedOrgWebhooks = new Set<string>();

  for (const url of getDeletionOrder(orgWebhookUrls)) {
    if (destroyedOrgWebhooks.has(url)) continue;
    await tryDestroyDirect(() => client.gh.destroyOrgWebhookByUrl(url), strict);
    destroyedOrgWebhooks.add(url);
  }

  // Delete in reverse declaration order so dependent resources are removed
  // before their parents (e.g. child groups before parent groups).
  for (const name of getDeletionOrder(baseNames)) {
    const groupCandidates = canUseListedGroups
      ? allGroups.filter((group) => matchesResourceBase(group, name))
      : [];
    const repoCandidates = canUseListedRepos
      ? allRepos.filter((repo) => matchesResourceBase(repo, name))
      : [];

    if (groupCandidates.length > 0) {
      for (const groupName of groupCandidates) {
        if (destroyedGroups.has(groupName)) continue;
        await tryDestroyDirect(() => client.gh.destroyGroup(groupName), strict);
        destroyedGroups.add(groupName);
      }
    } else if (!canUseListedGroups) {
      await tryDestroyDirect(() => client.gh.destroyGroup(name), strict);
      destroyedGroups.add(name);
    }

    if (repoCandidates.length > 0) {
      for (const repoName of repoCandidates) {
        if (destroyedRepos.has(repoName)) continue;
        await tryDestroyDirect(() => client.gh.destroyRepo(repoName), strict);
        destroyedRepos.add(repoName);
      }
    } else if (!canUseListedRepos) {
      await tryDestroyDirect(() => client.gh.destroyRepo(name), strict);
      destroyedRepos.add(name);
    }
  }
}

export async function destroyOrgFixtureResources(
  client: E2EApi,
  prefix: string,
  fixtures: FixtureResourceInput[],
  options: DestroyOrgResourcesOptions = {},
): Promise<void> {
  const resolvedFixtures = resolveFixtureResources(prefix, fixtures);
  const resourceNames = resolvedFixtures.map(({ claimName }) => claimName);
  await destroyOrgResources(client, resourceNames, options);
}
