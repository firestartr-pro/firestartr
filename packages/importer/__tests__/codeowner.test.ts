import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getClaimsDefaultsPath,
  setClaimsDefaultsPath,
  loadClaimsDefaultsOnce,
  resolveDefaultOwnerHandles,
  resetClaimsDefaultsCache,
} from '../src/decanter/config';
import { emptyRenderedClaims, setRenderedClaim } from 'cdk8s_renderer';

import { extractFromCodeOwners } from '../src/utils/codeowner';
import RepoGithubDecanter from '../src/decanter/gh/github_repo';
import log from '../src/logger';

describe('extractFromCodeOwners', () => {
  it('extracts user handles from CODEOWNERS content', () => {
    const content = '* @alice @bob\n/docs @charlie\n';
    const owners = extractFromCodeOwners(content);

    const names = owners.map(o => o.name);
    expect(names).toContain('@alice');
    expect(names).toContain('@bob');
    expect(names).toContain('@charlie');
  });

  it('marks team handles (containing "/") as isTeam=true', () => {
    const content = '* @myorg/backend-team @myorg/frontend-team\n';
    const owners = extractFromCodeOwners(content);

    expect(owners.every(o => o.isTeam)).toBe(true);
  });

  it('marks plain user handles (no "/") as isTeam=false', () => {
    const content = '* @alice @bob\n';
    const owners = extractFromCodeOwners(content);

    expect(owners.every(o => !o.isTeam)).toBe(true);
  });

  it('handles a mix of users and teams', () => {
    const content = '* @alice @myorg/backend-team\n';
    const owners = extractFromCodeOwners(content);

    const user = owners.find(o => o.name === '@alice');
    const team = owners.find(o => o.name === '@myorg/backend-team');

    expect(user?.isTeam).toBe(false);
    expect(team?.isTeam).toBe(true);
  });

  it('returns an empty array for content with no owner references', () => {
    const content = '# Just a comment\n/docs somefile\n';
    const owners = extractFromCodeOwners(content);

    expect(owners).toHaveLength(0);
  });

  it('ignores @handles that appear on full-line comment lines', () => {
    const content = '# @alice is the owner\n* @bob\n';
    const owners = extractFromCodeOwners(content);

    const names = owners.map(o => o.name);
    expect(names).not.toContain('@alice');
    expect(names).toContain('@bob');
  });

  it('ignores @handles that appear in inline comments', () => {
    const content = '* @alice # @should-be-ignored\n';
    const owners = extractFromCodeOwners(content);

    const names = owners.map(o => o.name);
    expect(names).toContain('@alice');
    expect(names).not.toContain('@should-be-ignored');
  });
});

describe('RepoGithubDecanter.__decantValidateCodeowners', () => {
  function makeDecanter(codeowners: string | undefined, teamsAndMembers: any) {
    return new RepoGithubDecanter(
      {
        org: 'myorg',
        codeowners,
        teamsAndMembers,
        repoDetails: {
          name: 'test-repo',
          description: '',
          visibility: 'public',
          default_branch: 'main',
        },
        branchStrategy: { kind: 'none' },
        oidc: { use_default: false, include_claim_keys: false },
      },
      'myorg',
    );
  }

  it('does not throw when codeowners is undefined', () => {
    const decanter = makeDecanter(undefined, {
      teams: [],
      directMembers: [],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
  });

  it('does not throw when all referenced users are direct members', () => {
    const decanter = makeDecanter('* @alice\n', {
      teams: [],
      directMembers: [{ name: 'alice', role: 'member' }],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
  });

  it('does not throw when a referenced user is an outside collaborator', () => {
    const decanter = makeDecanter('* @bob\n', {
      teams: [],
      directMembers: [],
      outsideMembers: [{ name: 'bob', role: 'member' }],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
  });

  it('does not throw when all referenced teams exist (matched by slug)', () => {
    const decanter = makeDecanter('* @myorg/backend-team\n', {
      teams: [{ name: 'Backend Team', slug: 'backend-team' }],
      directMembers: [],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
  });

  it('does not throw when all referenced teams exist (matched by slug)', () => {
    const decanter = makeDecanter('* @myorg/backend-team\n', {
      teams: [{ name: 'Backend Team', slug: 'backend-team' }],
      directMembers: [],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
  });

  it('throws when a referenced user is not a collaborator', () => {
    const decanter = makeDecanter('* @unknown-user\n', {
      teams: [],
      directMembers: [],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
      /CODEOWNERS file references user @unknown-user which is not present in the repository's collaborators/,
    );
  });

  it('throws when a referenced team is not in the repository teams', () => {
    const decanter = makeDecanter('* @myorg/missing-team\n', {
      teams: [{ name: 'Other Team', slug: 'other-team' }],
      directMembers: [],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
      /CODEOWNERS file references team @myorg\/missing-team which is not present in the repository's teams/,
    );
  });

  it('throws on the first invalid reference when there are multiple owners', () => {
    const decanter = makeDecanter('* @alice @unknown\n', {
      teams: [],
      directMembers: [{ name: 'alice', role: 'member' }],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
      /CODEOWNERS file references user @unknown/,
    );
  });

  it('does not throw when the CODEOWNERS user handle differs only in case from the stored login', () => {
    const decanter = makeDecanter('* @Alice\n', {
      teams: [],
      directMembers: [{ name: 'alice', role: 'member' }],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
  });

  it('does not throw when the CODEOWNERS team slug differs only in case from the stored slug', () => {
    const decanter = makeDecanter('* @myorg/Backend-Team\n', {
      teams: [{ name: 'Backend Team', slug: 'backend-team' }],
      directMembers: [],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
  });

  it('does not validate @handles that appear in CODEOWNERS comment lines', () => {
    // The comment-line @unknown-ghost should not trigger validation
    const decanter = makeDecanter('# @unknown-ghost\n* @alice\n', {
      teams: [],
      directMembers: [{ name: 'alice', role: 'member' }],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
  });

  it('does not validate @handles that appear in inline comments', () => {
    const decanter = makeDecanter('* @alice # @unknown-ghost\n', {
      teams: [],
      directMembers: [{ name: 'alice', role: 'member' }],
      outsideMembers: [],
    });

    expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
  });

  describe('default owner warning (claims_defaults.yaml)', () => {
    let tmpDir: string | undefined;
    let warnSpy: jest.SpyInstance | undefined;
    let previousClaimsDefaultsPath: string | null = null;

    beforeEach(() => {
      // remember previous path if set (getClaimsDefaultsPath throws if not set)
      try {
        previousClaimsDefaultsPath = getClaimsDefaultsPath();
      } catch {
        previousClaimsDefaultsPath = null;
      }
      emptyRenderedClaims();
    });

    afterEach(() => {
      if (warnSpy) warnSpy.mockRestore();
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      tmpDir = undefined;
      resetClaimsDefaultsCache();
      emptyRenderedClaims();
      // restore previous value, and if it was unset, reset to empty string so getClaimsDefaultsPath throws as before
      if (previousClaimsDefaultsPath) {
        setClaimsDefaultsPath(previousClaimsDefaultsPath);
      } else {
        setClaimsDefaultsPath('');
      }
    });

    // Seeds the config default owner from claims_defaults.yaml and resolves it
    // through the claim-to-external-name mapping (mimics setPreviousCRs + org).
    function seedDefaultOwner(ownerRef: string | null) {
      const yamlContent =
        ownerRef === null
          ? 'ComponentClaim:\n  platformOwner: "group:platform"\n'
          : `ComponentClaim:\n  owner: "${ownerRef}"\n`;
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-defaults-'));
      fs.writeFileSync(path.join(tmpDir, 'claims_defaults.yaml'), yamlContent, 'utf-8');
      setClaimsDefaultsPath(tmpDir);
      loadClaimsDefaultsOnce();
      warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => {});
    }

    // Seeds a referenced claim CR (GroupClaim/UserClaim) with an external-name
    // annotation, then resolves the default owner handles, mimicking the import
    // orchestration (setPreviousCRs + resolveDefaultOwnerHandles).
    function seedReferencedClaim(
      ownerRef: string,
      externalName: string,
      org: string = 'myorg',
    ) {
      const [kind, name] = ownerRef.split(':');
      const claimKind = kind === 'group' ? 'GroupClaim' : 'UserClaim';
      setRenderedClaim(
        { kind: claimKind, name },
        {
          metadata: {
            name: name,
            annotations: {
              'firestartr.dev/external-name': externalName,
              'firestartr.dev/claim-ref': `${claimKind}/${name}`,
            },
          },
        },
      );
      resolveDefaultOwnerHandles(org);
    }

    it('warns instead of throwing when CODEOWNERS references default owner team without repo permission', () => {
      seedDefaultOwner('group:default-team');
      seedReferencedClaim('group:default-team', 'default-team');

      const decanter = makeDecanter('* @myorg/default-team\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('default owner team @myorg/default-team'),
      );
    });

    it('warns instead of throwing when CODEOWNERS references default owner user without permission', () => {
      seedDefaultOwner('user:alice');
      seedReferencedClaim('user:alice', 'alice');

      const decanter = makeDecanter('* @alice\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('default owner user @alice'),
      );
    });

    it('uses the claim name slug for the default owner handle, ignoring a differing external-name', () => {
      // The default owner handle comes from the claim-ref slug, so a differing
      // external-name (display name) does NOT become the CODEOWNERS handle.
      seedDefaultOwner('group:default-team');
      seedReferencedClaim('group:default-team', 'dt-201');

      // @myorg/dt-201 is built from the external-name and is NOT the default
      // owner, so it is treated as missing rather than warned about.
      const decanter = makeDecanter('* @myorg/dt-201 @alice\n', {
        teams: [],
        directMembers: [{ name: 'alice', role: 'member' }],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
        /CODEOWNERS file references team @myorg\/dt-201/,
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns for the default owner when CODEOWNERS uses the claim name slug', () => {
      seedDefaultOwner('group:default-team');
      seedReferencedClaim('group:default-team', 'dt-201');

      const decanter = makeDecanter('* @myorg/default-team\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('default owner team @myorg/default-team'),
      );
    });

    it('is case-insensitive for default owner team', () => {
      seedDefaultOwner('group:default-team');
      seedReferencedClaim('group:default-team', 'default-team');

      const decanter = makeDecanter('* @myorg/DEFAULT-TEAM\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('is case-insensitive for default owner user', () => {
      seedDefaultOwner('user:alice');
      seedReferencedClaim('user:alice', 'alice');

      const decanter = makeDecanter('* @ALICE\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('warns for default owner on any CODEOWNERS path', () => {
      seedDefaultOwner('group:default-team');
      seedReferencedClaim('group:default-team', 'default-team');

      const decanter = makeDecanter('docs/** @myorg/default-team\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('still throws for non-default team even when default is configured', () => {
      seedDefaultOwner('group:default-team');
      seedReferencedClaim('group:default-team', 'default-team');

      const decanter = makeDecanter('* @myorg/other-team\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
        /CODEOWNERS file references team @myorg\/other-team/,
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('still throws for non-default user even when default is configured', () => {
      seedDefaultOwner('user:alice');
      seedReferencedClaim('user:alice', 'alice');

      const decanter = makeDecanter('* @bob\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
        /CODEOWNERS file references user @bob/,
      );
    });

    it('throws when default owner is unset in claims_defaults.yaml', () => {
      seedDefaultOwner(null);

      const decanter = makeDecanter('* @myorg/default-team\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
        /CODEOWNERS file references team @myorg\/default-team/,
      );
    });

    it('throws when claims_defaults.yaml cannot be read (fallback to strict)', () => {
      // point to a non-existent directory so readFileSync throws ENOENT
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-defaults-'));
      fs.rmSync(tmpDir, { recursive: true, force: true });
      setClaimsDefaultsPath(tmpDir);
      loadClaimsDefaultsOnce();
      warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => {});

      const decanter = makeDecanter('* @unknown-user\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
        /CODEOWNERS file references user @unknown-user/,
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('throws when the referenced default owner claim cannot be resolved (fallback to strict)', () => {
      // default owner references a claim that is not among the imported/previous CRs
      seedDefaultOwner('group:missing-claim');

      const decanter = makeDecanter('* @myorg/missing-claim\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
        /CODEOWNERS file references team @myorg\/missing-claim/,
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns for default owner but still throws for subsequent invalid owner', () => {
      seedDefaultOwner('group:default-team');
      seedReferencedClaim('group:default-team', 'default-team');

      const decanter = makeDecanter('* @myorg/default-team @myorg/unknown\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
        /CODEOWNERS file references team @myorg\/unknown/,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('default owner team @myorg/default-team'),
      );
    });

    it('resolves the default owner via the crs map when the symbol table is empty', () => {
      seedDefaultOwner('group:default-team');

      // Mimics the post-setPreviousCRs state: renderer symbol table is cleared,
      // CRs are keyed by a UUID-suffixed metadata.name and only resolvable
      // through the firestartr.dev/claim-ref annotation.
      emptyRenderedClaims();
      const crs: any = {
        'FirestartrGithubGroup-default-team-590f181e-db0d-438f-a8e3-b7714b66e648': {
          kind: 'FirestartrGithubGroup',
          metadata: {
            name: 'default-team-590f181e-db0d-438f-a8e3-b7714b66e648',
            annotations: {
              'firestartr.dev/claim-ref': 'GroupClaim/default-team',
              'firestartr.dev/external-name': 'Default Team',
            },
          },
        },
      };

      resolveDefaultOwnerHandles('myorg', crs);

      const decanter = makeDecanter('* @myorg/default-team\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('default owner team @myorg/default-team'),
      );
    });

    it('uses the claim-ref slug (not external-name) for the resolved default owner via the crs map', () => {
      seedDefaultOwner('group:default-team');

      // claim name "default-team" is the GitHub slug; external-name carries the
      // display name "Platform Team". CODEOWNERS must use the slug.
      emptyRenderedClaims();
      const crs: any = {
        'FirestartrGithubGroup-platform-team-abc123': {
          kind: 'FirestartrGithubGroup',
          metadata: {
            name: 'platform-team-abc123',
            annotations: {
              'firestartr.dev/claim-ref': 'GroupClaim/default-team',
              'firestartr.dev/external-name': 'Platform Team',
            },
          },
        },
      };

      resolveDefaultOwnerHandles('myorg', crs);

      const decanter = makeDecanter('* @myorg/default-team\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('default owner team @myorg/default-team'),
      );
    });

    it('prefers the firestartr.dev/github-slug annotation over claim-ref via the crs map', () => {
      seedDefaultOwner('group:default-team');

      // When the operator has backfilled github-slug, it is the authoritative
      // slug and takes precedence over the claim-ref (claim-name) slug.
      emptyRenderedClaims();
      const crs: any = {
        'FirestartrGithubGroup-platform-team-abc123': {
          kind: 'FirestartrGithubGroup',
          metadata: {
            name: 'platform-team-abc123',
            annotations: {
              'firestartr.dev/claim-ref': 'GroupClaim/default-team',
              'firestartr.dev/external-name': 'Platform Team',
              'firestartr.dev/github-slug': 'platform',
            },
          },
        },
      };

      resolveDefaultOwnerHandles('myorg', crs);

      const decanter = makeDecanter('* @myorg/platform\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('default owner team @myorg/platform'),
      );
    });

    it('throws when the default owner claim is absent from the crs map', () => {
      seedDefaultOwner('group:default-team');

      emptyRenderedClaims();
      const crs: any = {
        'FirestartrGithubGroup-other-abc123': {
          kind: 'FirestartrGithubGroup',
          metadata: {
            name: 'other-abc123',
            annotations: {
              'firestartr.dev/claim-ref': 'GroupClaim/other',
              'firestartr.dev/external-name': 'Other',
            },
          },
        },
      };

      resolveDefaultOwnerHandles('myorg', crs);

      const decanter = makeDecanter('* @myorg/default-team\n', {
        teams: [],
        directMembers: [],
        outsideMembers: [],
      });

      expect(() => (decanter as any).__decantValidateCodeowners()).toThrow(
        /CODEOWNERS file references team @myorg\/default-team/,
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
