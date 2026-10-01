jest.mock('cdk8s_renderer', () => ({
  __esModule: true,
  setRenderedClaim: jest.fn(),
  emptyRenderedClaims: jest.fn(),
  default: {setPath: jest.fn(), loadCRs: jest.fn().mockResolvedValue({})},
}));

jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {info: jest.fn(), warn: jest.fn(), error: jest.fn()},
}));

import {isInPreviousCRs, setPreviousCRs} from '../src/decanter';
import cdk8s_renderer from 'cdk8s_renderer';

function seedPreviousCRs(crs: Record<string, any>) {
  (cdk8s_renderer.loadCRs as jest.Mock).mockResolvedValue(crs);
}

describe('isInPreviousCRs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when a gh-group maps to a FirestartrGithubGroup on disk', async () => {
    seedPreviousCRs({
      'cr1': {
        kind: 'FirestartrGithubGroup',
        metadata: {
          name: 'backend-team',
          annotations: {'firestartr.dev/external-name': 'backend-team'},
        },
      },
    });

    await setPreviousCRs('/tmp/fake-path');

    expect(isInPreviousCRs('gh-group', 'backend-team')).toBe(true);
  });

  it('returns true when a gh-repo maps to a FirestartrGithubRepository on disk', async () => {
    seedPreviousCRs({
      'cr1': {
        kind: 'FirestartrGithubRepository',
        metadata: {
          name: 'my-app',
          annotations: {'firestartr.dev/external-name': 'my-app'},
        },
      },
    });

    await setPreviousCRs('/tmp/fake-path');

    expect(isInPreviousCRs('gh-repo', 'my-app')).toBe(true);
  });

  it('returns true when a gh-members maps to a FirestartrGithubMembership on disk', async () => {
    seedPreviousCRs({
      'cr1': {
        kind: 'FirestartrGithubMembership',
        metadata: {
          name: 'jdoe',
          annotations: {'firestartr.dev/external-name': 'jdoe'},
        },
      },
    });

    await setPreviousCRs('/tmp/fake-path');

    expect(isInPreviousCRs('gh-members', 'jdoe')).toBe(true);
  });

  it('returns true when a gh-org-settings maps to FirestartrGithubOrganizationSettings', async () => {
    seedPreviousCRs({
      'cr1': {
        kind: 'FirestartrGithubOrganizationSettings',
        metadata: {
          name: 'my-org-org-settings',
          annotations: {'firestartr.dev/external-name': 'my-org-org-settings'},
        },
      },
    });

    await setPreviousCRs('/tmp/fake-path');

    expect(isInPreviousCRs('gh-org-settings', 'my-org-org-settings')).toBe(
      true,
    );
  });

  it('returns false when the name does not match', async () => {
    seedPreviousCRs({
      'cr1': {
        kind: 'FirestartrGithubGroup',
        metadata: {
          name: 'backend-team',
          annotations: {'firestartr.dev/external-name': 'backend-team'},
        },
      },
    });

    await setPreviousCRs('/tmp/fake-path');

    expect(isInPreviousCRs('gh-group', 'other-team')).toBe(false);
  });

  it('returns false when the collection kind does not match the CR kind', async () => {
    seedPreviousCRs({
      'cr1': {
        kind: 'FirestartrGithubGroup',
        metadata: {
          name: 'backend-team',
          annotations: {'firestartr.dev/external-name': 'backend-team'},
        },
      },
    });

    await setPreviousCRs('/tmp/fake-path');

    expect(isInPreviousCRs('gh-repo', 'backend-team')).toBe(false);
  });

  it('returns false for an unknown collection kind', async () => {
    seedPreviousCRs({
      'cr1': {
        kind: 'FirestartrGithubGroup',
        metadata: {
          name: 'backend-team',
          annotations: {'firestartr.dev/external-name': 'backend-team'},
        },
      },
    });

    await setPreviousCRs('/tmp/fake-path');

    expect(isInPreviousCRs('unknown-kind', 'backend-team')).toBe(false);
  });

  it('returns false when previousCRs is empty', async () => {
    seedPreviousCRs({});

    await setPreviousCRs('/tmp/fake-path');

    expect(isInPreviousCRs('gh-group', 'backend-team')).toBe(false);
  });

  it('returns true for multiple CRs of different kinds simultaneously', async () => {
    seedPreviousCRs({
      'cr1': {
        kind: 'FirestartrGithubGroup',
        metadata: {
          name: 'backend-team',
          annotations: {'firestartr.dev/external-name': 'backend-team'},
        },
      },
      'cr2': {
        kind: 'FirestartrGithubRepository',
        metadata: {
          name: 'my-app',
          annotations: {'firestartr.dev/external-name': 'my-app'},
        },
      },
      'cr3': {
        kind: 'FirestartrGithubMembership',
        metadata: {
          name: 'jdoe',
          annotations: {'firestartr.dev/external-name': 'jdoe'},
        },
      },
    });

    await setPreviousCRs('/tmp/fake-path');

    expect(isInPreviousCRs('gh-group', 'backend-team')).toBe(true);
    expect(isInPreviousCRs('gh-repo', 'my-app')).toBe(true);
    expect(isInPreviousCRs('gh-members', 'jdoe')).toBe(true);
    expect(isInPreviousCRs('gh-group', 'my-app')).toBe(false);
    expect(isInPreviousCRs('gh-repo', 'backend-team')).toBe(false);
  });
});
