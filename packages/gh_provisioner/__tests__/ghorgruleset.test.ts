import { initSystemFS } from '../src';
import { getEntity } from '../src/entities';

import path from 'path';

import { EntityGHOrgRuleset } from '../src/entities/ghorgruleset';

jest.mock('github', () => ({
  __esModule: true,
  default: {
    org: {
      getRulesetList: jest.fn(),
    },
  },
}));

import github from 'github';

const mockGetRulesetList = github.org.getRulesetList as jest.Mock;

describe('EntityGHOrgRuleset entity', () => {
  let entity: EntityGHOrgRuleset;

  beforeEach(async () => {
    mockGetRulesetList.mockReset();

    entity = (await initSystemFS(
      path.join(__dirname, 'fixtures/ghorgruleset/cr.yaml'),
      path.join(__dirname, 'fixtures/ghorgruleset/deps.yaml'),
    )) as EntityGHOrgRuleset;
  });

  it('is built by the factory for its kind', () => {
    expect(entity instanceof EntityGHOrgRuleset).toBe(true);
    expect(getEntity(entity.cr) instanceof EntityGHOrgRuleset).toBe(true);
  });

  it('copies spec.ruleset to the module config and resolves Team group refs', async () => {
    await entity.loadResources('apply');

    const { bypass_actors, ...rest } = entity.cr.spec.ruleset;

    expect(entity.document.config).toEqual({
      ...rest,
      bypass_actors: [
        { actor_type: 'Team', bypass_mode: 'always', actor_id: 19699572 },
      ],
    });
    expect(entity.document.config.bypass_actors[0].ref).toBeUndefined();
  });

  it('fails before the plan when the group dependency is missing', async () => {
    delete (entity as any)._deps[
      'FirestartrGithubGroup-platform-team-7f3a2c1e-9b4d-4a6f-8c2e-1d5b7a9f0c3e'
    ];

    await expect(entity.loadResources('apply')).rejects.toThrow(
      /could not resolve FirestartrGithubGroup\/platform-team/,
    );
  });

  it('fails when a Team bypass actor references another CR kind', async () => {
    entity.cr.spec.ruleset.bypass_actors[0].ref.kind =
      'FirestartrGithubRepository';

    await expect(entity.loadResources('apply')).rejects.toThrow(
      /expected FirestartrGithubGroup/,
    );
  });

  it('rejects a non-Team bypass actor with a ref', async () => {
    entity.cr.spec.ruleset.bypass_actors = [
      {
        actor_type: 'Integration',
        bypass_mode: 'always',
        ref: {
          kind: 'FirestartrGithubGroup',
          name: 'platform-team-7f3a2c1e-9b4d-4a6f-8c2e-1d5b7a9f0c3e',
        },
      },
    ];

    await expect(entity.loadResources('apply')).rejects.toThrow(
      /Integration bypass actors cannot reference another CR/,
    );
  });

  it.each(['destroy', 'plan-destroy'])(
    'does not require a referenced group for %s',
    async (tfOp) => {
      delete (entity as any)._deps[
        'FirestartrGithubGroup-platform-team-7f3a2c1e-9b4d-4a6f-8c2e-1d5b7a9f0c3e'
      ];

      await expect(entity.loadResources(tfOp)).resolves.toBeUndefined();
      expect(entity.document.config.bypass_actors).toEqual([]);
    },
  );

  describe('provider owner', () => {
    it('rejects a provider whose owner differs from spec.org', async () => {
      entity.provider.cr.spec.config = '{"owner":"other-org"}';

      await expect(entity.loadResources('apply')).rejects.toThrow(
        /owner "other-org" does not match spec\.org "firestartr-test"/,
      );

      mockGetRulesetList.mockResolvedValue([]);

      await expect(entity.loadAddressesToImport()).rejects.toThrow(
        /owner "other-org" does not match spec\.org "firestartr-test"/,
      );
    });

    it('rejects a provider without an owner in its config', async () => {
      entity.provider.cr.spec.config = '{}';

      await expect(entity.loadResources('apply')).rejects.toThrow(
        /provider config does not define owner/,
      );

      mockGetRulesetList.mockResolvedValue([]);

      await expect(entity.loadAddressesToImport()).rejects.toThrow(
        /provider config does not define owner/,
      );
    });

    it('rejects a provider with inline configuration', async () => {
      // WriterProvider uses the inline block instead of the config, so a
      // matching config owner does not prove which organization Terraform
      // will target.
      entity.provider.cr.spec.inline =
        'provider "github" { owner = "other-org" }';

      await expect(entity.loadResources('apply')).rejects.toThrow(
        /provider uses inline configuration/,
      );

      mockGetRulesetList.mockResolvedValue([]);

      await expect(entity.loadAddressesToImport()).rejects.toThrow(
        /provider uses inline configuration/,
      );
    });

    it('allows a Secret-backed owner that resolves to spec.org', async () => {
      entity.provider.cr.spec.config = '{"owner":"${{ secrets.OWNER }}"}';
      entity.provider.cr.spec.secrets = {
        OWNER: {
          secretRef: {
            name: 'github-app-credentials',
            namespace: 'default',
            key: 'OWNER',
          },
        },
      };

      await expect(entity.loadResources('apply')).resolves.toBeUndefined();

      expect(entity.document.config.bypass_actors[0].actor_id).toBe(19699572);
    });
  });

  describe('import', () => {
    it('imports the existing ruleset with the same name by id', async () => {
      mockGetRulesetList.mockResolvedValue([
        { id: 1, name: 'Other ruleset' },
        { id: 42, name: 'Standard - Default Branch Protection' },
      ]);

      await entity.loadAddressesToImport();

      expect(mockGetRulesetList).toHaveBeenCalledWith('firestartr-test');
      expect(entity.importDocument.imports).toEqual([
        { to: 'github_organization_ruleset.this', id: '42' },
      ]);
    });

    it('imports nothing when no ruleset has that name', async () => {
      mockGetRulesetList.mockResolvedValue([{ id: 1, name: 'Other ruleset' }]);

      await entity.loadAddressesToImport();

      expect(entity.importDocument.imports).toEqual([]);
    });

    it('fails when several rulesets have that name', async () => {
      mockGetRulesetList.mockResolvedValue([
        { id: 1, name: 'Standard - Default Branch Protection' },
        { id: 2, name: 'Standard - Default Branch Protection' },
      ]);

      await expect(entity.loadAddressesToImport()).rejects.toMatch(
        /2 rulesets named "Standard - Default Branch Protection" \(ids 1, 2\)/,
      );
    });
  });
});
