import { join } from 'path';

/** Absolute path to a checked-in fs-forge config fixture. */
export function contextFixture(name: string): string {
  return join(__dirname, 'context', name);
}

const ENV_KEYS = ['FS_FORGE_CONFIG', 'FSCRT_ORG', 'GITHUB_TOKEN'] as const;

/**
 * Snapshots the environment the context tests touch; `restore()` puts it back,
 * so a developer's own org or token never leaks in or out of a test.
 */
export function captureEnv(): { restore(): void } {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  return {
    restore() {
      for (const [key, value] of saved) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}
