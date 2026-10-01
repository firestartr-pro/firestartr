import { initSystemFS } from '../src';

import path from 'path';

import { EntityGHOrgVarsSection } from '../src/entities/ghorgvarsection';

jest.mock('github', () => ({
  __esModule: true,
  default: {
    org: {
      getOrgVariable: jest.fn(),
    },
  },
}));

import github from 'github';

const mockGetOrgVariable = github.org.getOrgVariable as jest.Mock;

describe('EntityGHOrgVarsSection entity', () => {
  let entity: EntityGHOrgVarsSection;

  function setupResolveSelfOutputs(value: any) {
    (entity.cr as any).fResolveSelfOutputs = jest
      .fn()
      .mockReturnValue(value);
  }

  beforeEach(async () => {
    mockGetOrgVariable.mockReset();
    entity = (await initSystemFS(
      path.join(__dirname, 'fixtures/ghorgvarsection/cr.yaml'),
      path.join(__dirname, 'fixtures/ghorgvarsection/deps.yaml'),
    )) as EntityGHOrgVarsSection;
  });

  describe('config generation', () => {
    it('builds config for all three visibility modes', async () => {
      await entity.loadResources('plan');

      expect(entity.document).toStrictEqual({
        config: {
          variables: {
            DEPLOY_KEY: {
              value: 'deploy-key-value',
              visibility: 'all',
            },
            STAGING_HOST: {
              value: 'staging.example.com',
              visibility: 'selected',
              selectedRepositoryIds: [
                'firestartr-test/component-a',
                'firestartr-test/component-b',
              ],
            },
            INTERNAL_FLAG: {
              value: 'true',
              visibility: 'private',
            },
          },
        },
      });
    });

    it('verifies selectedRepositoryIds is renamed from selectedRepositories', async () => {
      await entity.loadResources('plan');

      const variables = (entity.document as any).config.variables;
      expect(variables.STAGING_HOST.selectedRepositoryIds).toEqual([
        'firestartr-test/component-a',
        'firestartr-test/component-b',
      ]);
      expect(variables.STAGING_HOST).not.toHaveProperty(
        'selectedRepositories',
      );
    });

    it('does not include selectedRepositoryIds when visibility is not selected', async () => {
      await entity.loadResources('plan');

      const variables = (entity.document as any).config.variables;
      expect(variables.DEPLOY_KEY).not.toHaveProperty('selectedRepositoryIds');
      expect(variables.INTERNAL_FLAG).not.toHaveProperty(
        'selectedRepositoryIds',
      );
    });

    it('produces empty config when actionsVariables is empty', async () => {
      entity.cr.spec.actionsVariables = [];
      await entity.loadResources('plan');

      expect(entity.document).toStrictEqual({
        config: {
          variables: {},
        },
      });
    });
  });

  describe('adoption logic', () => {
    it('adopts all declared variables found on GitHub when managed_variables is undefined (first reconciliation)', async () => {
      setupResolveSelfOutputs(undefined);
      mockGetOrgVariable.mockImplementation(async (_org: string, name: string) => {
        if (name === 'STAGING_HOST') return { name: 'STAGING_HOST' };
        throw Object.assign(new Error('Not Found'), { status: 404 });
      });

      await entity.loadResources('apply');

      expect(mockGetOrgVariable).toHaveBeenCalledWith('firestartr-test', 'DEPLOY_KEY');
      expect(mockGetOrgVariable).toHaveBeenCalledWith('firestartr-test', 'STAGING_HOST');
      expect(mockGetOrgVariable).toHaveBeenCalledWith('firestartr-test', 'INTERNAL_FLAG');
      expect(entity.importDocument).toStrictEqual({
        imports: [
          {
            to: 'github_actions_organization_variable.this["STAGING_HOST"]',
            id: 'STAGING_HOST',
          },
        ],
      });
    });

    it('adopts all declared variables found on GitHub when managed_variables is empty array', async () => {
      setupResolveSelfOutputs([]);
      mockGetOrgVariable.mockImplementation(async (_org: string, name: string) => {
        if (name === 'DEPLOY_KEY') return { name: 'DEPLOY_KEY' };
        throw Object.assign(new Error('Not Found'), { status: 404 });
      });

      await entity.loadResources('apply');

      expect(mockGetOrgVariable).toHaveBeenCalledWith('firestartr-test', 'DEPLOY_KEY');
      expect(mockGetOrgVariable).toHaveBeenCalledWith('firestartr-test', 'STAGING_HOST');
      expect(mockGetOrgVariable).toHaveBeenCalledWith('firestartr-test', 'INTERNAL_FLAG');
      expect(entity.importDocument).toStrictEqual({
        imports: [
          {
            to: 'github_actions_organization_variable.this["DEPLOY_KEY"]',
            id: 'DEPLOY_KEY',
          },
        ],
      });
    });

    it('imports a new-to-module variable found on GitHub', async () => {
      setupResolveSelfOutputs(['DEPLOY_KEY']);
      mockGetOrgVariable.mockImplementation(async (_org: string, name: string) => {
        if (name === 'STAGING_HOST') return { name: 'STAGING_HOST' };
        throw Object.assign(new Error('Not Found'), { status: 404 });
      });

      await entity.loadResources('apply');

      expect(mockGetOrgVariable).toHaveBeenCalledWith(
        'firestartr-test',
        'STAGING_HOST',
      );
      expect(entity.importDocument).toStrictEqual({
        imports: [
          {
            to: 'github_actions_organization_variable.this["STAGING_HOST"]',
            id: 'STAGING_HOST',
          },
        ],
      });
    });

    it('skips adoption when API returns 403', async () => {
      setupResolveSelfOutputs(['DEPLOY_KEY']);
      mockGetOrgVariable.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { status: 403 }),
      );

      await entity.loadResources('apply');

      expect(entity.importDocument).toStrictEqual({ imports: [] });
    });

    it('skips adoption when all variables are already managed', async () => {
      mockGetOrgVariable.mockRejectedValue(
        Object.assign(new Error('Not Found'), { status: 404 }),
      );
      setupResolveSelfOutputs(['DEPLOY_KEY', 'STAGING_HOST', 'INTERNAL_FLAG']);

      await entity.loadResources('apply');

      expect(mockGetOrgVariable).not.toHaveBeenCalled();
      expect(entity.importDocument).toStrictEqual({ imports: [] });
    });
  });

  describe('postProvision and loadAddressesToImport', () => {
    it('postProvision is a no-op', async () => {
      await expect(entity.postProvision('apply')).resolves.toBeUndefined();
    });

    it('loadAddressesToImport is a no-op', async () => {
      await expect(entity.loadAddressesToImport()).resolves.toBeUndefined();
    });
  });
});
