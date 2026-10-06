import { createClaimsApi } from '../../../src/api/claims-api';
import { E2EState } from '../../../src/api/state';
import { resolveE2eFixturesPath } from '../../../src/fixtures-path';

function makeState(fixturesBasePath?: string): E2EState {
  return new E2EState({
    org: 'firestartr-e2e',
    namespace: 'default',
    prefix: 'unit',
    kubeConfigProvider: () => {
      throw new Error('kube config should not be requested');
    },
    fixturesBasePath,
  });
}

describe('claims state accessors', () => {
  it('returns the init fixtures path, defaulting to the repo fixtures', () => {
    expect(
      createClaimsApi(makeState('/custom/fixtures')).getFixturesBasePath(),
    ).toBe('/custom/fixtures');
    expect(createClaimsApi(makeState()).getFixturesBasePath()).toBe(
      resolveE2eFixturesPath(),
    );
  });

  it('returns a render-artifact snapshot, not the live array', () => {
    const state = makeState();
    const claims = createClaimsApi(state);
    state.renderedArtifacts.push({
      crPath: '/tmp/a.yaml',
      outputPath: '/tmp/out',
    });

    const artifacts = claims.getRenderArtifacts();
    artifacts.push({ crPath: '/tmp/b.yaml', outputPath: '/tmp/out' });

    expect(claims.getRenderArtifacts()).toEqual([
      { crPath: '/tmp/a.yaml', outputPath: '/tmp/out' },
    ]);
  });
});
