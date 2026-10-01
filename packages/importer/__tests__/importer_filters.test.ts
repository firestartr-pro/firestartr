const mockImportGithubGitopsRepository = jest.fn();
const mockIsInPreviousCRs = jest.fn();

jest.mock('../src/decanter', () => ({
  __esModule: true,
  importGithubGitopsRepository: mockImportGithubGitopsRepository,
  isInPreviousCRs: mockIsInPreviousCRs,
  collections: {
    RepoCollectionGithubDecanter: {collectionKind: 'gh-repo'},
    OrgSettingsCollectionGithubDecanter: {collectionKind: 'gh-org-settings'},
  },
}));

jest.mock('cdk8s_renderer', () => ({
  __esModule: true,
  default: {setPath: jest.fn()},
  AllowedProviders: {all: 'all'},
  configureProvider: jest.fn(),
}));

import {runImporter} from '../index';

describe('importer filters', () => {
  beforeEach(() => {
    mockImportGithubGitopsRepository.mockClear();
    mockIsInPreviousCRs.mockReturnValue(false);
  });

  it('skips org settings during focused repo imports', async () => {
    await runImporter(
      false,
      false,
      'claims',
      'crs',
      'config',
      'defaults',
      'firestartr-test',
      ['gh-repo,NAME=my-repo'],
    );

    const filters = mockImportGithubGitopsRepository.mock.calls[0][5];

    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'gh-repo',
          type: 'NAME',
          name: 'my-repo',
        }),
        expect.objectContaining({kind: 'gh-repo', type: 'FUNCTION'}),
        expect.objectContaining({kind: 'gh-org-settings', type: 'SKIP'}),
      ]),
    );
    expect(filters).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({kind: 'gh-org-settings', type: 'FUNCTION'}),
      ]),
    );
  });
});
