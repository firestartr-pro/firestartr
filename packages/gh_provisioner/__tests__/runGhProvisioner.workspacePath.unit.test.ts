import { Entity } from '../src/entities/base';

describe('gh-provisioner workspace path logic (unit mock)', () => {
  function mockEntity(kind: string, crName: string, tfStateKey: string, inDebugMode = false) {
    return {
      inDebugMode,
      cr: { kind, name: crName, spec: { firestartr: { tfStateKey } } },
      tfStateKey,
      k8sId: `${kind}/${crName}`,
      prepareToLoad: jest.fn(),
      loadResources: jest.fn(),
      postProvision: jest.fn(),
      synthEnd: jest.fn(),
    } as unknown as Entity;
  }

  function getSessionProjectPath(entity: Entity, sessionId: string) {
    if (entity.inDebugMode) {
      // Include tfStateKey as a suffix when present to avoid collisions
      const tfStateKey = (entity as any).cr?.spec?.firestartr?.tfStateKey;
      const safeKey = typeof tfStateKey === 'string' ? tfStateKey.replace(/\//g, '-') : '';
      return `/tmp/gh-debug/${entity.cr.kind.toLowerCase()}-${entity.cr.name}${safeKey ? `-${safeKey}` : ''}`;
    } else {
      return `/tmp/gh-workspaces/${entity.cr.kind.toLowerCase()}-${entity.cr.name}-${sessionId}`;
    }
  }

  it('creates distinct sessionProjectPath per-resource under same repo', () => {
    const entityA = mockEntity('FirestartrGithubRepositoryFeature', 'featA', 'samekey');
    const entityB = mockEntity('FirestartrGithubRepositoryFeature', 'featB', 'samekey');
    const sessionA = '04y8', sessionB = '1t9p';

    const pathA = getSessionProjectPath(entityA, sessionA);
    const pathB = getSessionProjectPath(entityB, sessionB);

    expect(pathA).toEqual('/tmp/gh-workspaces/firestartrgithubrepositoryfeature-featA-04y8');
    expect(pathB).toEqual('/tmp/gh-workspaces/firestartrgithubrepositoryfeature-featB-1t9p');
    expect(pathA).not.toEqual(pathB);
  });

  it('creates different sessionProjectPath for two runs of the same CR', () => {
    const entity = mockEntity('FirestartrGithubRepositoryFeature', 'featX', 'fooKey');
    const session1 = 'mvlf', session2 = 'q1l4';

    const path1 = getSessionProjectPath(entity, session1);
    const path2 = getSessionProjectPath(entity, session2);

    expect(path1).toEqual('/tmp/gh-workspaces/firestartrgithubrepositoryfeature-featX-mvlf');
    expect(path2).toEqual('/tmp/gh-workspaces/firestartrgithubrepositoryfeature-featX-q1l4');
    expect(path1).not.toEqual(path2);
  });

  it('supports debug mode (gh-debug path)', () => {
    const entity = mockEntity('FirestartrGithubRepositoryFeature', 'foobar', '3914ca50-cc80-4961-a139-464028818a92', true);
    const debugPath = getSessionProjectPath(entity, 'asdf');
    expect(debugPath).toEqual('/tmp/gh-debug/firestartrgithubrepositoryfeature-foobar-3914ca50-cc80-4961-a139-464028818a92');
  });

  it('creates correct sessionProjectPath for non-Feature CRs', () => {
    const entity = mockEntity('FirestartrGithubRepository', 'repoA', 'fakeKey');
    const session = 'xy12';
    const path = getSessionProjectPath(entity, session);
    expect(path).toEqual('/tmp/gh-workspaces/firestartrgithubrepository-repoA-xy12');
  });

  it('creates correct sessionProjectPath for non-Feature CRs in debug mode', () => {
    const entity = mockEntity('FirestartrGithubRepository', 'repoA', 'fakeKey', true);
    const debugPath = getSessionProjectPath(entity, 'z9uv');
    expect(debugPath).toEqual('/tmp/gh-debug/firestartrgithubrepository-repoA-fakeKey');
  });
});
