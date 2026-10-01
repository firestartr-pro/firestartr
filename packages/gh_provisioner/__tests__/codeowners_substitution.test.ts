const fakeLogger = { debug: jest.fn(), error: jest.fn() };
jest.mock('../src/logger', () => ({ __esModule: true, default: fakeLogger }));

import { provisionCodeowners } from '../src/entities/ghrepo/helpers/codeowners';
import { Entity } from '../src/entities/base';

// Helper to create a fake repo CR
function makeRepoCR(org: string, codeowners: string, permissions: any[]) {
  return {
    spec: {
      org,
      repo: { defaultBranch: 'main', codeowners },
      permissions,
    },
    metadata: { name: 'r' },
  };
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
    // Mock refResolver
    Entity.refResolver = (ref: any) => {
      if (ref.name === 'dataEng') {
        return {
          cr: { metadata: { annotations: { 'firestartr.dev/external-name': extName1 } } },
          getOutput: (key: string) => (key === 'slug' ? slug1 : undefined),
        };
      } else if (ref.name === 'qaTeam') {
        return {
          cr: { metadata: { annotations: { 'firestartr.dev/external-name': extName2 } } },
          getOutput: (key: string) => (key === 'slug' ? slug2 : undefined),
        };
      }
      return undefined;
    };

    // Fake repo entity wrapper
    const fsGithubRepository = { cr, patchData: jest.fn() } as any;
    await provisionCodeowners(fsGithubRepository);
    // The new CODEOWNERS content written should have both owners rewritten
    const newContent = fsGithubRepository.patchData.mock.calls[0][0].value.content;
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
    Entity.refResolver = (_ref: any) => ({
      cr: { metadata: { annotations: { 'firestartr.dev/external-name': extName } } },
      getOutput: (_: string) => undefined,
    });
    const fsGithubRepository = { cr, patchData: jest.fn() } as any;
    await provisionCodeowners(fsGithubRepository);
    const newContent = fsGithubRepository.patchData.mock.calls[0][0].value.content;
    // Owner not replaced
    expect(newContent).toContain('@o/Team A');
    // Logger called
    expect(fakeLogger.error).toHaveBeenCalledWith(expect.stringContaining('Missing slug'));
  });

  it('preserves unrelated CODEOWNERS content', async () => {
    const org = 'org';
    const codeownersRaw = ['# comment', '/x @org/foo', ''].join('\n');
    const cr = makeRepoCR(org, codeownersRaw, []);
    const fsGithubRepository = { cr, patchData: jest.fn() } as any;
    await provisionCodeowners(fsGithubRepository);
    const newContent = fsGithubRepository.patchData.mock.calls[0][0].value.content;
    expect(newContent).toBe(codeownersRaw);
  });
});
