jest.mock('../src/tp_bridge');
jest.mock('github', () => ({
  __esModule: true,
  default: {
    getOctokitForOrg: jest.fn(),
    repo: { getContent: jest.fn().mockRejectedValue({ status: 404 }) },
  },
}));

import github from 'github';

import { runOnTerraform } from '../src/tp_bridge';
import { EntityGHFeature } from '../src/entities/ghfeature';
import { Entity } from '../src/entities/base';

const mockRunOnTerraform = runOnTerraform as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FEATURE_CR_BASE = {
  kind: 'FirestartrGithubRepositoryFeature',
  apiVersion: 'firestartr.dev/v1',
  metadata: {
    name: 'test-feature',
    annotations: {},
  },
  spec: {
    org: 'testorg',
    type: 'my-feature',
    version: 'v1',
    repositoryTarget: {
      ref: {
        kind: 'FirestartrGithubRepository',
        name: 'target-repo',
      },
      branch: 'main',
    },
    context: {
      backend: { ref: { kind: 'FirestartrProviderConfig', name: 'kubernetes-provider' } },
      provider: { ref: { kind: 'FirestartrProviderConfig', name: 'github' } },
    },
    firestartr: {
      tfStateKey: 'test-tf-state-key',
    },
    files: [
      {
        path: 'README.md',
        content: Buffer.from('# Hello').toString('base64'),
        userManaged: true,
      },
      {
        path: 'CONTRIBUTING.md',
        content: Buffer.from('# Contributing').toString('base64'),
        userManaged: true,
      },
      {
        path: '.github/workflows/ci.yml',
        content: Buffer.from('name: CI').toString('base64'),
        userManaged: false,
      },
    ],
  },
};

const MOCK_REPO_REF = {
  cr: { spec: { org: 'testorg' } },
  getDepName: () => 'target-repo',
};

/**
 * Build a ref resolver that exposes:
 * - self-outputs with an optional installedManagedFiles list
 * - the repository target ref (FirestartrGithubRepository/target-repo)
 *
 * @param installedManagedFiles pass `null` for "first apply" (no prior outputs)
 */
function buildRefResolver(installedManagedFiles: string[] | null) {
  return (ref: any) => {
    if (ref.kind === 'self' && ref.name === 'outputs') {
      if (installedManagedFiles === null) return null;

      return {
        getOutput: (key: string) =>
          key === 'installed_managed_files' ? installedManagedFiles : null,
      };
    }

    if (ref.kind === 'FirestartrGithubRepository') {
      return MOCK_REPO_REF;
    }

    if (ref.kind === 'FirestartrProviderConfig') {
      return { cr: { spec: { secrets: {} } } };
    }

    return null;
  };
}

/**
 * Construct an EntityGHFeature with a custom installed-files list and an
 * optional override of the `files` array in the CR spec.
 */
function createEntity(
  installedManagedFiles: string[] | null,
  files?: any[],
): EntityGHFeature {
  Entity.setRefResolver(buildRefResolver(installedManagedFiles));

  const cr = files
    ? { ...FEATURE_CR_BASE, spec: { ...FEATURE_CR_BASE.spec, files } }
    : { ...FEATURE_CR_BASE, spec: { ...FEATURE_CR_BASE.spec, files: FEATURE_CR_BASE.spec.files.map(f => ({ ...f })) } };

  return new EntityGHFeature(cr);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntityGHFeature – provision-once-then-untrack', () => {
  let entity: EntityGHFeature;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Scenario 1 – First apply (no output secrets / no installed files)
  // -------------------------------------------------------------------------
  describe('first apply (no installed_managed_files)', () => {
    beforeEach(() => {
      entity = createEntity(null);
      jest
        .spyOn(entity, 'getFileContentFromProvider')
        .mockResolvedValue('current content');
      mockRunOnTerraform.mockResolvedValue('');
    });

    it('provisions all user-managed files and includes them in TF config', async () => {
      await entity.loadResources('apply');

      const files = entity.document.config.files;
      expect(files).toHaveLength(3);
      expect(files.map((f: any) => f.file)).toEqual(
        expect.arrayContaining(['README.md', 'CONTRIBUTING.md', '.github/workflows/ci.yml']),
      );
    });

    it('sets installed_managed_files in document to all newly provisioned addresses', async () => {
      await entity.loadResources('apply');

      expect(entity.document.installed_managed_files).toEqual(
        expect.arrayContaining(['README.md/main', 'CONTRIBUTING.md/main']),
      );
      expect(entity.document.installed_managed_files).not.toContain(
        '.github/workflows/ci.yml/main',
      );
    });

    it('fails instead of seeding declared content when reading an existing file fails', async () => {
      entity = createEntity(null, [
        {
          path: 'README.md',
          content: Buffer.from('module template').toString('base64'),
          userManaged: true,
        },
      ]);
      jest
        .spyOn(entity, 'getFileContentFromProvider')
        .mockRejectedValue(new Error('provider unavailable'));

      await expect(entity.loadResources('apply')).rejects.toEqual(
        expect.stringContaining('error loading resources'),
      );

      expect(entity.document.config.files).toHaveLength(0);
      expect(entity.document.installed_managed_files).toEqual([]);
    });

    it('does NOT call state list (no prior installed files to clean up)', async () => {
      await entity.loadResources('apply');

      const stateListCalls = mockRunOnTerraform.mock.calls.filter(
        ([, , args]: any) => args?.[0] === 'state' && args?.[1] === 'list',
      );
      expect(stateListCalls).toHaveLength(0);
    });

    it('post-apply state rm targets all newly provisioned user-managed addresses', async () => {
      await entity.loadResources('apply');
      await entity.postProvision('apply');

      expect(mockRunOnTerraform).toHaveBeenCalledWith(
        entity,
        'custom-command',
        expect.arrayContaining([
          'state',
          'rm',
          'github_repository_file.user_managed["README.md/main"]',
          'github_repository_file.user_managed["CONTRIBUTING.md/main"]',
        ]),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2 – Second apply (all user-managed files already installed)
  // -------------------------------------------------------------------------
  describe('second apply (all user-managed files already in installed_managed_files)', () => {
    const INSTALLED = ['README.md/main', 'CONTRIBUTING.md/main'];

    beforeEach(() => {
      entity = createEntity(INSTALLED);
    });

    it('excludes all already-installed user-managed files from TF config', async () => {
      mockRunOnTerraform.mockResolvedValue(''); // state list + potential state rm

      await entity.loadResources('apply');

      const files = entity.document.config.files;
      expect(files).toHaveLength(1);
      expect(files[0].file).toBe('.github/workflows/ci.yml');
    });

    it('does not call post-apply state rm when no new user-managed files', async () => {
      mockRunOnTerraform.mockResolvedValue('');

      await entity.loadResources('apply');
      await entity.postProvision('apply');

      expect(entity._newlyProvisionedAddresses).toHaveLength(0);

      const postApplyStateRm = mockRunOnTerraform.mock.calls.filter(
        ([, cmd, args]: any) =>
          cmd === 'custom-command' &&
          args?.[1] === 'rm' &&
          args.some((a: string) => a.includes('user_managed')),
      );
      expect(postApplyStateRm).toHaveLength(0);
    });

    it('pre-apply state rm fires for installed files found in legacy state', async () => {
      const legacyStateList =
        'github_repository_file.user_managed["README.md/main"]\n' +
        'github_repository_file.user_managed["CONTRIBUTING.md/main"]';

      mockRunOnTerraform
        .mockResolvedValueOnce(legacyStateList) // state list
        .mockResolvedValue(''); // state rm

      await entity.loadResources('apply');

      expect(mockRunOnTerraform).toHaveBeenCalledWith(
        entity,
        'custom-command',
        ['state', 'list'],
      );

      expect(mockRunOnTerraform).toHaveBeenCalledWith(
        entity,
        'custom-command',
        expect.arrayContaining([
          'state',
          'rm',
          'github_repository_file.user_managed["README.md/main"]',
          'github_repository_file.user_managed["CONTRIBUTING.md/main"]',
        ]),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3 – Feature update removes a user-managed file from the spec
  // -------------------------------------------------------------------------
  describe('feature update: v1→v2 removes a user-managed file', () => {
    it('pre-apply state rm fires for the removed file, not the remaining one', async () => {
      // v2 spec: README.md dropped, CONTRIBUTING.md still present
      const v2Files = [
        {
          path: 'CONTRIBUTING.md',
          content: Buffer.from('# Contributing').toString('base64'),
          userManaged: true,
        },
        {
          path: '.github/workflows/ci.yml',
          content: Buffer.from('name: CI').toString('base64'),
          userManaged: false,
        },
      ];

      entity = createEntity(['README.md/main', 'CONTRIBUTING.md/main'], v2Files);

      const stateListOutput =
        'github_repository_file.user_managed["README.md/main"]\n' +
        'github_repository_file.user_managed["CONTRIBUTING.md/main"]';

      mockRunOnTerraform
        .mockResolvedValueOnce(stateListOutput) // state list
        .mockResolvedValue(''); // state rm

      await entity.loadResources('apply');

      const stateRmCall = mockRunOnTerraform.mock.calls.find(
        ([, cmd, args]: any) => cmd === 'custom-command' && args?.[1] === 'rm',
      );

      expect(stateRmCall).toBeTruthy();
      // README.md was in installedManagedFiles but is no longer in spec → state rm
      expect(stateRmCall![2]).toContain(
        'github_repository_file.user_managed["README.md/main"]',
      );
      // CONTRIBUTING.md is still installed → also state rm'd (still user-managed, still in installed list)
      expect(stateRmCall![2]).toContain(
        'github_repository_file.user_managed["CONTRIBUTING.md/main"]',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4 – Feature update adds a new user-managed file
  // -------------------------------------------------------------------------
  describe('feature update: v1→v2 adds a new user-managed file', () => {
    beforeEach(() => {
      // README.md was already installed; CONTRIBUTING.md is new in v2
      entity = createEntity(['README.md/main']);
      jest
        .spyOn(entity, 'getFileContentFromProvider')
        .mockResolvedValue('seeded content');
      mockRunOnTerraform.mockResolvedValue('');
    });

    it('only the new file appears in TF config among user-managed files', async () => {
      await entity.loadResources('apply');

      const files = entity.document.config.files;
      expect(files.map((f: any) => f.file)).not.toContain('README.md');
      expect(files.map((f: any) => f.file)).toContain('CONTRIBUTING.md');
      expect(files.map((f: any) => f.file)).toContain('.github/workflows/ci.yml');
    });

    it('_newlyProvisionedAddresses contains only the new file', async () => {
      await entity.loadResources('apply');

      expect(entity._newlyProvisionedAddresses).toEqual(['CONTRIBUTING.md/main']);
    });

    it('post-apply state rm targets only the new file, not the already-known one', async () => {
      await entity.loadResources('apply');
      await entity.postProvision('apply');

      const stateRmCalls = mockRunOnTerraform.mock.calls.filter(
        ([, cmd, args]: any) =>
          cmd === 'custom-command' &&
          args?.[1] === 'rm' &&
          args.some((a: string) => a.includes('user_managed')),
      );

      expect(stateRmCalls).toHaveLength(1);
      expect(stateRmCalls[0][2]).toContain(
        'github_repository_file.user_managed["CONTRIBUTING.md/main"]',
      );
      expect(stateRmCalls[0][2]).not.toContain(
        'github_repository_file.user_managed["README.md/main"]',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5 – File transitions from userManaged:true to userManaged:false
  // -------------------------------------------------------------------------
  describe('file transitions from userManaged:true to userManaged:false', () => {
    it('transition file appears in TF config as non-managed; pre-apply state rm does NOT remove it', async () => {
      // README.md was user-managed (installed), now transitions to non-managed
      // CONTRIBUTING.md remains user-managed (installed)
      const transitionFiles = [
        {
          path: 'README.md',
          content: Buffer.from('# Hello').toString('base64'),
          userManaged: false,
        },
        {
          path: 'CONTRIBUTING.md',
          content: Buffer.from('# Contributing').toString('base64'),
          userManaged: true,
        },
      ];

      entity = createEntity(['README.md/main', 'CONTRIBUTING.md/main'], transitionFiles);

      const stateListOutput =
        'github_repository_file.user_managed["README.md/main"]\n' +
        'github_repository_file.user_managed["CONTRIBUTING.md/main"]';

      mockRunOnTerraform
        .mockResolvedValueOnce(stateListOutput) // state list
        .mockResolvedValue(''); // state rm

      await entity.loadResources('apply');

      // README.md must be in config as non-managed (Terraform takes over)
      const files = entity.document.config.files;
      const readmeEntry = files.find((f: any) => f.file === 'README.md');
      expect(readmeEntry).toBeDefined();
      expect(readmeEntry.userManaged).toBe(false);

      // CONTRIBUTING.md must NOT be in config (still installed and user-managed)
      expect(files.map((f: any) => f.file)).not.toContain('CONTRIBUTING.md');

      // Pre-apply state rm must NOT include README.md/main (it's transitioning)
      const stateRmCall = mockRunOnTerraform.mock.calls.find(
        ([, cmd, args]: any) => cmd === 'custom-command' && args?.[1] === 'rm',
      );

      // CONTRIBUTING.md is still installed + user-managed → state rm'd
      expect(stateRmCall).toBeTruthy();
      expect(stateRmCall![2]).toContain(
        'github_repository_file.user_managed["CONTRIBUTING.md/main"]',
      );
      // README.md is transitioning → NOT state rm'd so TF can import/manage it
      expect(stateRmCall![2]).not.toContain(
        'github_repository_file.user_managed["README.md/main"]',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6 – Destroy path
  // -------------------------------------------------------------------------
  describe('destroy path', () => {
    it('uses state list to discover user_managed resources and state-rms them', async () => {
      entity = createEntity(['README.md/main', 'CONTRIBUTING.md/main']);

      const stateListOutput =
        'github_repository_file.user_managed["README.md/main"]\n' +
        'github_repository_file.user_managed["CONTRIBUTING.md/main"]\n' +
        'github_repository_file.regular_managed["ci.yml/main"]';

      mockRunOnTerraform
        .mockResolvedValueOnce(stateListOutput) // state list
        .mockResolvedValue(''); // state rm

      await entity.loadResources('destroy');

      expect(mockRunOnTerraform).toHaveBeenCalledWith(
        entity,
        'custom-command',
        ['state', 'list'],
      );

      expect(mockRunOnTerraform).toHaveBeenCalledWith(
        entity,
        'custom-command',
        expect.arrayContaining([
          'state',
          'rm',
          'github_repository_file.user_managed["README.md/main"]',
          'github_repository_file.user_managed["CONTRIBUTING.md/main"]',
        ]),
      );

      // Non-user_managed addresses must not be removed
      const stateRmCall = mockRunOnTerraform.mock.calls.find(
        ([, cmd, args]: any) => cmd === 'custom-command' && args?.[1] === 'rm',
      );
      expect(stateRmCall![2]).not.toContain('github_repository_file.regular_managed');
    });

    it('is a no-op when state list contains no user_managed resources', async () => {
      entity = createEntity(null);

      mockRunOnTerraform.mockResolvedValueOnce(''); // state list returns empty

      await entity.loadResources('destroy');

      expect(mockRunOnTerraform).toHaveBeenCalledWith(
        entity,
        'custom-command',
        ['state', 'list'],
      );

      const stateRmCalls = mockRunOnTerraform.mock.calls.filter(
        ([, cmd, args]: any) => cmd === 'custom-command' && args?.[1] === 'rm',
      );
      expect(stateRmCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 7 – Migration destroy (files in legacy state, no installed list)
  // -------------------------------------------------------------------------
  describe('migration destroy (legacy state, no installed_managed_files output)', () => {
    it('still removes user_managed resources discovered in state before destroy', async () => {
      entity = createEntity(null); // simulates pre-fix output secrets (no list)

      const stateListOutput =
        'github_repository_file.user_managed["README.md/main"]\n' +
        'github_repository_file.user_managed["CONTRIBUTING.md/main"]';

      mockRunOnTerraform
        .mockResolvedValueOnce(stateListOutput) // state list
        .mockResolvedValue(''); // state rm

      await entity.loadResources('destroy');

      expect(mockRunOnTerraform).toHaveBeenCalledWith(
        entity,
        'custom-command',
        expect.arrayContaining([
          'state',
          'rm',
          'github_repository_file.user_managed["README.md/main"]',
          'github_repository_file.user_managed["CONTRIBUTING.md/main"]',
        ]),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 8 – Migration reimport — loadAddressesToImport
  // -------------------------------------------------------------------------
  describe('migration reimport — loadAddressesToImport', () => {
    it('emits import blocks only for non-user-managed files in correct format', async () => {
      // Simulate a migration reimport context: loadResources seeds config.files
      // with only non-user-managed files before loadAddressesToImport is called.
      entity = createEntity(null); // no prior outputs — legacy entity

      await entity.loadResources('import-with-reimport');
      await entity.loadAddressesToImport();

      const imports = entity.importDocument.imports;

      // Only the non-user-managed file (.github/workflows/ci.yml) should appear
      expect(imports).toHaveLength(1);
      expect(imports[0]).toEqual({
        to: 'github_repository_file.managed[".github/workflows/ci.yml/main"]',
        id: 'target-repo:.github/workflows/ci.yml:main',
      });

      // User-managed files must NOT produce import blocks
      const userManagedImports = imports.filter(
        (i: any) =>
          i.to.includes('README.md') || i.to.includes('CONTRIBUTING.md'),
      );
      expect(userManagedImports).toHaveLength(0);
    });

    it('does not call runOnTerraform during loadResources for import-with-reimport', async () => {
      entity = createEntity(null);

      await entity.loadResources('import-with-reimport');

      expect(mockRunOnTerraform).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 9 – Migration reimport — document seeding
  // -------------------------------------------------------------------------
  describe('migration reimport — document seeding', () => {
    it('seeds installed_managed_files with all userManaged:true addresses from spec', async () => {
      entity = createEntity(null);

      await entity.loadResources('import-with-reimport');

      expect(entity.document.installed_managed_files).toEqual(
        expect.arrayContaining(['README.md/main', 'CONTRIBUTING.md/main']),
      );
      expect(entity.document.installed_managed_files).not.toContain(
        '.github/workflows/ci.yml/main',
      );
    });

    it('config.files contains only non-user-managed files after loadResources for import-with-reimport', async () => {
      entity = createEntity(null);

      await entity.loadResources('import-with-reimport');

      const files = entity.document.config.files;
      expect(files).toHaveLength(1);
      expect(files[0].file).toBe('.github/workflows/ci.yml');
    });

    it('is idempotent — safe to run even when installed_managed_files already populated', async () => {
      // Simulates a re-triggered migration on an already-migrated entity
      entity = createEntity(['README.md/main', 'CONTRIBUTING.md/main']);

      await entity.loadResources('import-with-reimport');

      // installed_managed_files is always reseeded from current spec, not accumulated
      expect(entity.document.installed_managed_files).toEqual(
        expect.arrayContaining(['README.md/main', 'CONTRIBUTING.md/main']),
      );
      // config.files still only non-user-managed
      expect(entity.document.config.files).toHaveLength(1);
      expect(entity.document.config.files[0].file).toBe(
        '.github/workflows/ci.yml',
      );
    });
  });
});

describe('EntityGHFeature – existing file reads', () => {
  it('uses the Contents API for the requested repository branch', async () => {
    const getContent = github.repo.getContent as jest.Mock;
    getContent.mockResolvedValue('current content');
    const entity = createEntity(null);

    await expect(
      entity.getFileContentFromProvider(
        'testorg',
        'target-repo',
        'main',
        'README.md',
      ),
    ).resolves.toBe('current content');

    expect(getContent).toHaveBeenCalledWith(
      'README.md',
      'target-repo',
      'testorg',
      'main',
    );
  });
});
