import { describe, expect, it, jest } from '@jest/globals';

// Inject Node's real Windows path implementation on Linux/macOS too.
jest.mock(
  'path',
  () => jest.requireActual<typeof import('path')>('path').win32,
);

import { matchOrganization } from '../src/context/match';

const HOME = String.raw`C:\Users\me`;
const ACME = {
  name: 'acme',
  paths: [String.raw`C:\Users\me\work\acme`],
};

describe('Windows context paths', () => {
  it('matches a descendant directory', () => {
    expect(
      matchOrganization([ACME], String.raw`C:\Users\me\work\acme\claims`, HOME),
    ).toEqual(expect.objectContaining({ kind: 'match', organization: ACME }));
  });

  it('matches paths case-insensitively', () => {
    expect(
      matchOrganization([ACME], 'c:\\users\\me\\work\\acme\\claims', HOME),
    ).toEqual(expect.objectContaining({ kind: 'match', organization: ACME }));
  });

  it('rejects sibling prefixes and paths on a different drive', () => {
    expect(
      matchOrganization([ACME], String.raw`C:\Users\me\work\acme-other`, HOME),
    ).toEqual({ kind: 'no-match' });
    expect(
      matchOrganization([ACME], String.raw`D:\Users\me\work\acme\claims`, HOME),
    ).toEqual({ kind: 'no-match' });
  });

  it('keeps the most-specific organization for a child starting with two dots', () => {
    const parent = { name: 'beta', paths: [String.raw`C:\Users\me\work`] };

    expect(
      matchOrganization(
        [parent, ACME],
        String.raw`C:\Users\me\work\acme\..work\project`,
        HOME,
      ),
    ).toEqual(expect.objectContaining({ kind: 'match', organization: ACME }));
  });

  it('does not treat one organization listing case-equivalent paths as ambiguous', () => {
    const organization = {
      ...ACME,
      paths: [...ACME.paths, 'c:\\users\\me\\work\\acme'],
    };

    expect(
      matchOrganization(
        [organization],
        String.raw`C:\Users\me\work\acme\claims`,
        HOME,
      ),
    ).toEqual(expect.objectContaining({ kind: 'match', organization }));
  });

  it('still reports ambiguity for different owners of case-equivalent paths', () => {
    const other = { name: 'beta', paths: ['c:\\users\\me\\work\\acme'] };

    expect(
      matchOrganization(
        [ACME, other],
        String.raw`C:\Users\me\work\acme\claims`,
        HOME,
      ),
    ).toEqual(
      expect.objectContaining({
        kind: 'ambiguous',
        organizations: [ACME, other],
      }),
    );
  });

  it('displays matched paths with a platform-native home prefix', () => {
    expect(
      matchOrganization([ACME], String.raw`C:\Users\me\work\acme\claims`, HOME),
    ).toEqual(
      expect.objectContaining({ matchedPath: String.raw`~\work\acme` }),
    );
  });

  it('expands a backslash home path', () => {
    const organization = { name: 'acme', paths: [String.raw`~\work\acme`] };

    expect(
      matchOrganization(
        [organization],
        String.raw`C:\Users\me\work\acme\claims`,
        HOME,
      ),
    ).toEqual(expect.objectContaining({ kind: 'match', organization }));
  });
});
