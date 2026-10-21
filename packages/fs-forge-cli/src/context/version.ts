const CLI_PACKAGE = '@firestartr/fs-forge-cli';
const REGISTRY = 'https://registry.npmjs.org';
const VERSION_LOOKUP_TIMEOUT_MS = 3000;

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export interface LatestVersionOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * The registry's `latest` dist-tag for the CLI package, or `null` when the
 * lookup fails (offline, timeout, unexpected payload). Never fatal.
 */
export async function latestCliVersion(
  options: LatestVersionOptions = {},
): Promise<string | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const url = `${REGISTRY}/${CLI_PACKAGE}/latest`;
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(
        options.timeoutMs ?? VERSION_LOOKUP_TIMEOUT_MS,
      ),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (typeof payload !== 'object' || payload === null) return null;
    const version = (payload as Record<string, unknown>).version;
    return typeof version === 'string' && version ? version : null;
  } catch {
    return null;
  }
}
