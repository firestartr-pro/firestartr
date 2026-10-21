const fakeLogger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn(), silly: jest.fn() };
jest.mock('../src/logger', () => ({ __esModule: true, default: fakeLogger }));

import { provisionCodeowners } from '../src/entities/ghrepo/helpers/codeowners';
import { EntityGHRepo } from '../src/entities/ghrepo';

// Helper to create a fake repo CR
function makeRepoCR(org: string, codeowners: string, permissions: any[]) {
  return {
    kind: 'FirestartrGithubRepository',
    apiVersion: 'firestartr.dev/v1',
    spec: {
      org,
      repo: { defaultBranch: 'main', codeowners },
      permissions,
    },
    metadata: { name: 'r', annotations: {} },
  };
}

// A group dependency: the external name comes from its CR annotation,
// the slug from its output secret.
function groupDep(externalName: string, slug?: string) {
  return {
    cr: {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubGroup',
      metadata: {
        name: externalName,
        annotations: { 'firestartr.dev/external-name': externalName },
      },
      spec: {},
    },
    secret: {
      apiVersion: 'v1',
      kind: 'Secret',
      data: {
        outputs: Buffer.from(JSON.stringify({ slug })).toString('base64'),
      },
    },
  };
}

function renderFileContent(repo: EntityGHRepo): string {
  return repo.document.config.files[0].content;
}

describe('provisionCodeowners', () => {
  afterEach(() => { jest.resetAllMocks(); });

  it('replaces all group owners by slug, preserving layout', async () => {
    // Mock data: two teams/groups
    const org = 'my-org';
    const extName1 = 'Data Eng';
    const slug1 = 'data-eng';
    const extName2 = 'QA_Team';
    const slug2 = 'qa_team';

    const codeownersRaw = [
      '# Generated CODEOWNERS',
      '* @my-org/Data Eng @my-org/QA_Team @someone',
      '/api/** @my-org/Data Eng',
      ''
    ].join('\n');

    const cr = makeRepoCR(org, codeownersRaw, [
      { ref: { kind: 'FirestartrGithubGroup', name: 'dataEng' } },
      { ref: { kind: 'FirestartrGithubGroup', name: 'qaTeam' } },
    ]);

    const deps = {
      'FirestartrGithubGroup-dataEng': groupDep(extName1, slug1),
      'FirestartrGithubGroup-qaTeam': groupDep(extName2, slug2),
    };

    const repo = new EntityGHRepo(cr, deps);

    await provisionCodeowners(repo);

    // The new CODEOWNERS content written should have both owners rewritten
    const newContent = renderFileContent(repo);
    expect(newContent).toContain('@my-org/data-eng');
    expect(newContent).toContain('@my-org/qa_team');
    expect(newContent).not.toContain('@my-org/Data Eng');
    expect(newContent).not.toContain('@my-org/QA_Team');
    // Comments and layout preserved
    expect(newContent.split('\n')[0]).toBe('# Generated CODEOWNERS');
    // User owner untouched
    expect(newContent).toContain('@someone');
  });

  it('logs and preserves owner if group slug missing', async () => {
    const org = 'o';
    const extName = 'Team A';
    const codeownersRaw = '* @o/Team A';
    const cr = makeRepoCR(org, codeownersRaw, [
      { ref: { kind: 'FirestartrGithubGroup', name: 'teamA' } }
    ]);

    const deps = {
      'FirestartrGithubGroup-teamA': groupDep(extName),
    };

    const repo = new EntityGHRepo(cr, deps);

    await provisionCodeowners(repo);

    const newContent = renderFileContent(repo);
    // Owner not replaced
    expect(newContent).toContain('@o/Team A');
    // Logger called
    expect(fakeLogger.error).toHaveBeenCalledWith(expect.stringContaining('Missing slug'));
  });

  it('keeps catching unresolved group refs instead of failing the run', async () => {
    const org = 'o';
    const codeownersRaw = '* @o/Missing Team';
    const cr = makeRepoCR(org, codeownersRaw, [
      { ref: { kind: 'FirestartrGithubGroup', name: 'missingTeam' } }
    ]);

    const repo = new EntityGHRepo(cr, {});

    await expect(provisionCodeowners(repo)).resolves.toBeUndefined();

    const newContent = renderFileContent(repo);
    expect(newContent).toBe(codeownersRaw);
    expect(fakeLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('missingTeam'),
    );
  });

  it('preserves unrelated CODEOWNERS content', async () => {
    const org = 'org';
    const codeownersRaw = ['# comment', '/x @org/foo', ''].join('\n');
    const cr = makeRepoCR(org, codeownersRaw, []);

    const repo = new EntityGHRepo(cr, {});

    await provisionCodeowners(repo);

    const newContent = renderFileContent(repo);
    expect(newContent).toBe(codeownersRaw);
  });
});
