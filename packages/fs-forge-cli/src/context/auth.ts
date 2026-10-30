import { execFileSync } from 'child_process';

export type AuthSource = 'GITHUB_TOKEN' | 'gh';

export interface ResolvedAuth {
  token: string;
  source: AuthSource;
}

const GH_TIMEOUT_MS = 5000;

export const NO_AUTH_MESSAGE =
  'GITHUB_TOKEN is required (or log in with `gh auth login`)';

/**
 * The token `gh` has stored, or undefined when `gh` is missing, logged out, or
 * too slow. Never logs the token.
 */
export function readGhAuthToken(): string | undefined {
  try {
    const token = execFileSync(
      'gh',
      ['auth', 'token', '--hostname', 'github.com'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GH_TIMEOUT_MS,
      },
    ).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/** `GITHUB_TOKEN`, else the `gh auth token` fallback, else undefined. */
export function resolveAuth(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAuth | undefined {
  const token = env.GITHUB_TOKEN;
  if (token) return { token, source: 'GITHUB_TOKEN' };
  const fromGh = readGhAuthToken();
  return fromGh ? { token: fromGh, source: 'gh' } : undefined;
}
