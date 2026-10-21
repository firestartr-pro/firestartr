import { afterEach, describe, expect, it, jest } from '@jest/globals';

/** Symlinks the config fixtures point at; the suite writes none on disk. */
let symlinks: Record<string, string> = {};

function realpathOrSelf(path: string): string {
  return symlinks[path] ?? path;
}

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  realpathSync: realpathOrSelf,
}));

import { contextConfigPath, loadContextConfig } from '../src/context/config';
import {
  ContextError,
  contextRepos,
  resolveOrganization,
} from '../src/context/resolve';
import { contextFixture } from './fixtures/contextFixtures';

import type { ResolveContextOptions } from '../src/context/resolve';

function failure(options: ResolveContextOptions): ContextError {
  try {
    resolveOrganization(options);
  } catch (error) {
    if (error instanceof ContextError) return error;
    throw error;
  }
  throw new Error('expected the context resolution to fail');
}

afterEach(() => {
  symlinks = {};
});

describe('context path matching', () => {
  it('matches a stored path on segment boundaries only', () => {
    const inside = resolveOrganization({
      configPath: contextFixture('defaults.yaml'),
      cwd: '/srv/acme/project',
    });
    expect(inside.org).toBe('acme');
    expect(inside.matchedPath).toBe('/srv/acme');

    const sibling = failure({
      configPath: contextFixture('defaults.yaml'),
      cwd: '/srv/acme-project',
    });
    expect(sibling.code).toBe('NO_MATCH');
  });

  it('expands ~ in stored paths', () => {
    const resolved = resolveOrganization({
      configPath: contextFixture('full.yaml'),
      home: '/home/me',
      cwd: '/home/me/work/acme/claims',
    });

    expect(resolved.org).toBe('acme');
    expect(resolved.matchedPath).toBe('~/work/acme');
  });

  it('prefers the longest matching path', () => {
    expect(
      resolveOrganization({
        configPath: contextFixture('nested.yaml'),
        cwd: '/srv/acme/project/sub',
      }).org,
    ).toBe('acme-project');

    expect(
      resolveOrganization({
        configPath: contextFixture('nested.yaml'),
        cwd: '/srv/acme/other',
      }).org,
    ).toBe('acme');
  });

  it('keeps the most-specific organization for a child starting with two dots', () => {
    expect(
      resolveOrganization({
        configPath: contextFixture('nested.yaml'),
        cwd: '/srv/acme/project/..work/sub',
      }),
    ).toEqual(
      expect.objectContaining({
        org: 'acme-project',
        matchedPath: '/srv/acme/project',
      }),
    );
  });

  it('matches a directory reached through a symlink', () => {
    symlinks = { '/srv/acme-link': '/srv/acme' };

    const resolved = resolveOrganization({
      configPath: contextFixture('symlink.yaml'),
      cwd: '/srv/acme',
    });

    expect(resolved.org).toBe('acme');
    expect(resolved.matchedPath).toBe('/srv/acme-link');
  });

  it('does not treat one organization listing a path twice as ambiguous', () => {
    expect(
      resolveOrganization({
        configPath: contextFixture('duplicate-path.yaml'),
        cwd: '/srv/acme/x',
      }),
    ).toEqual(expect.objectContaining({ org: 'acme', source: 'config' }));
  });

  it('reports AMBIGUOUS_MATCH when two organizations claim the longest path', () => {
    const error = failure({
      configPath: contextFixture('ambiguous.yaml'),
      cwd: '/srv/acme/project',
    });

    expect(error.code).toBe('AMBIGUOUS_MATCH');
    expect(error.message).toContain('acme');
    expect(error.message).toContain('beta');
    expect(error.message).toContain('/srv/acme');
  });
});

describe('context config loading', () => {
  it('reports NO_CONFIG when the file is missing', () => {
    const error = failure({
      configPath: contextFixture('absent.yaml'),
      cwd: '/srv/acme',
    });

    expect(error.code).toBe('NO_CONFIG');
    expect(error.message).toContain('absent.yaml');
  });

  it('reports NO_CONFIG for the old single-organization shape', () => {
    const error = failure({
      configPath: contextFixture('old-shape.yaml'),
      cwd: '/srv/acme',
    });

    expect(error.code).toBe('NO_CONFIG');
  });

  it('reports NO_CONFIG for malformed YAML and for an invalid schema', () => {
    expect(
      failure({ configPath: contextFixture('malformed.yaml'), cwd: '/srv/acme' })
        .code,
    ).toBe('NO_CONFIG');
    expect(
      failure({
        configPath: contextFixture('invalid-schema.yaml'),
        cwd: '/srv/acme',
      }).code,
    ).toBe('NO_CONFIG');
  });

  it('accepts the Windows home prefix in configured paths', () => {
    expect(
      loadContextConfig(contextFixture('windows-home.yaml'))?.organizations[0].paths,
    ).toEqual([String.raw`~\work\acme`]);
  });

  it('reports NO_CONFIG for duplicate organization names with conflicting repositories', () => {
    const error = failure({
      configPath: contextFixture('duplicate-name.yaml'),
      cwd: '/srv/acme',
    });

    expect(error.code).toBe('NO_CONFIG');
  });

  it('reports NO_CONFIG for organization names differing only in case', () => {
    expect(
      failure({
        configPath: contextFixture('duplicate-name-case.yaml'),
        cwd: '/srv/acme',
      }).code,
    ).toBe('NO_CONFIG');
  });

  it('reports NO_CONFIG for a relative organization path', () => {
    const error = failure({
      configPath: contextFixture('relative-path.yaml'),
      cwd: '/srv/acme',
    });

    expect(error.code).toBe('NO_CONFIG');
  });

  it('reports NO_MATCH when no configured path contains the directory', () => {
    const error = failure({
      configPath: contextFixture('defaults.yaml'),
      cwd: '/elsewhere/project',
    });

    expect(error.code).toBe('NO_MATCH');
    expect(error.message).toContain('/elsewhere/project');
    expect(error.message).toContain('acme');
  });

  it('honours FS_FORGE_CONFIG, then XDG_CONFIG_HOME, then ~/.config', () => {
    expect(contextConfigPath({ FS_FORGE_CONFIG: '/tmp/custom.yaml' })).toBe(
      '/tmp/custom.yaml',
    );
    expect(contextConfigPath({ XDG_CONFIG_HOME: '/xdg', HOME: '/home/me' })).toBe(
      '/xdg/fs-forge/config.yaml',
    );
    expect(contextConfigPath({ HOME: '/home/me' })).toBe(
      '/home/me/.config/fs-forge/config.yaml',
    );
  });
});

describe('context organization precedence', () => {
  it('prefers --org over FSCRT_ORG and the config match', () => {
    expect(
      resolveOrganization({
        configPath: contextFixture('defaults.yaml'),
        cwd: '/srv/acme',
        flag: 'flagged',
        env: { FSCRT_ORG: 'from-env' },
      }),
    ).toEqual({ org: 'flagged', source: 'flag', matchedPath: null });
  });

  it('prefers FSCRT_ORG over the config match', () => {
    expect(
      resolveOrganization({
        configPath: contextFixture('defaults.yaml'),
        cwd: '/srv/acme',
        env: { FSCRT_ORG: 'from-env' },
      }),
    ).toEqual({ org: 'from-env', source: 'env', matchedPath: null });
  });

  it.each(['flag', 'env'] as const)(
    'keeps configured repository overrides for a mixed-case %s organization',
    (source) => {
      const org = source === 'flag' ? 'ACME' : 'AcMe';
      const resolved = resolveOrganization({
        configPath: contextFixture('repo-overrides.yaml'),
        cwd: '/elsewhere',
        ...(source === 'flag'
          ? { flag: org, env: { FSCRT_ORG: 'beta' } }
          : { env: { FSCRT_ORG: org } }),
      });

      expect(resolved).toEqual(
        expect.objectContaining({ org, source, matchedPath: null }),
      );
      expect(contextRepos(resolved.org, resolved.organization)).toEqual({
        claims: 'shared/claims-fork',
        stateGithub: `${org}/state-github-fork`,
        stateInfra: 'other/state-infra-fork',
        catalog: `${org}/catalog-fork`,
      });
    },
  );

  it('falls back to the config match', () => {
    const resolved = resolveOrganization({
      configPath: contextFixture('defaults.yaml'),
      cwd: '/srv/acme',
      env: {},
    });

    expect(resolved.org).toBe('acme');
    expect(resolved.source).toBe('config');
    expect(resolved.matchedPath).toBe('/srv/acme');
  });
});

describe('context repos', () => {
  it('derives the conventional repos', () => {
    expect(contextRepos('acme')).toEqual({
      claims: 'acme/claims',
      stateGithub: 'acme/state-github',
      stateInfra: 'acme/state-infra',
      catalog: 'acme/catalog',
    });
  });

  it('qualifies bare repository overrides with the selected organization', () => {
    expect(
      contextRepos('acme', {
        name: 'acme',
        paths: ['/srv/acme'],
        claims_repo: 'claims-fork',
        state_github_repo: 'state-github-fork',
        state_infra_repo: 'state-infra-fork',
        catalog_repo: 'catalog-fork',
      }),
    ).toEqual({
      claims: 'acme/claims-fork',
      stateGithub: 'acme/state-github-fork',
      stateInfra: 'acme/state-infra-fork',
      catalog: 'acme/catalog-fork',
    });
  });

  it('honours the config overrides', () => {
    const resolved = resolveOrganization({
      configPath: contextFixture('full.yaml'),
      cwd: '/srv/acme',
    });

    expect(contextRepos(resolved.org, resolved.organization)).toEqual({
      claims: 'acme/claims-fork',
      stateGithub: 'acme/state-github-fork',
      stateInfra: 'acme/state-infra-fork',
      catalog: 'acme/catalog-fork',
    });
    expect(resolved.cliVersion).toBe('2.0.1');
  });
});
