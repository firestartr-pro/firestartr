import { validateVersionConstraint } from '../src/version';
import { version as cliVersion } from '../package.json';

describe('validateVersionConstraint', () => {
  it('passes when constraint is satisfied by provided version', () => {
    expect(validateVersionConstraint('>=2.6.4', '2.7.0')).toBe(true);
  });

  it('fails when constraint is not satisfied by provided version', () => {
    expect(validateVersionConstraint('>=2.6.4', '2.5.0')).toBe(false);
  });

  it('passes with ^ constraint', () => {
    expect(validateVersionConstraint('^2.5.0', '2.5.4')).toBe(true);
  });

  it('fails with ^ constraint for major bump', () => {
    expect(validateVersionConstraint('^2.5.0', '3.0.0')).toBe(false);
  });

  it('passes with ~ constraint', () => {
    expect(validateVersionConstraint('~2.5.0', '2.5.4')).toBe(true);
  });

  it('fails with ~ constraint for minor bump', () => {
    expect(validateVersionConstraint('~2.5.0', '2.6.0')).toBe(false);
  });

  it('passes with exact version', () => {
    expect(validateVersionConstraint('2.5.0', '2.5.0')).toBe(true);
  });

  it('passes with > constraint', () => {
    expect(validateVersionConstraint('>2.5.0', '2.5.1')).toBe(true);
  });

  it('fails with > constraint for equal version', () => {
    expect(validateVersionConstraint('>2.5.0', '2.5.0')).toBe(false);
  });

  it('passes with <= constraint', () => {
    expect(validateVersionConstraint('<=2.5.0', '2.4.9')).toBe(true);
  });

  it('passes with range intersection', () => {
    expect(validateVersionConstraint('>=2.5.0 <2.7.0', '2.6.0')).toBe(true);
  });

  it('fails with range intersection', () => {
    expect(validateVersionConstraint('>=2.5.0 <2.7.0', '2.7.0')).toBe(false);
  });

  it('throws on invalid constraint', () => {
    expect(() => validateVersionConstraint('not-a-valid-constraint', '2.5.0')).toThrow(
      'Invalid version constraint',
    );
  });

  it('throws on invalid version', () => {
    expect(() => validateVersionConstraint('>=2.5.0', 'not-a-version')).toThrow(
      'Invalid version',
    );
  });

  it('evaluates against CLI own version when version is omitted', () => {
    expect(validateVersionConstraint(`>=${cliVersion}`, undefined)).toBe(true);
    expect(validateVersionConstraint(`<${cliVersion}`)).toBe(false);
  });

  describe('snapshot handling', () => {
    it('passes snapshot when ignoreSnapshots is true', () => {
      expect(validateVersionConstraint('>=2.6.4', '2.9.0-snapshot-01', { ignoreSnapshots: true })).toBe(true);
    });

    it('throws on snapshot when ignoreSnapshots is false', () => {
      expect(() =>
        validateVersionConstraint('>=2.6.4', '2.9.0-snapshot-01'),
      ).toThrow('Snapshot version "2.9.0-snapshot-01" is not a valid semver release');
    });

    it('throws on snapshot when ignoreSnapshots is explicitly false', () => {
      expect(() =>
        validateVersionConstraint('>=2.6.4', '2.9.0-snapshot-01', { ignoreSnapshots: false }),
      ).toThrow('Snapshot version "2.9.0-snapshot-01" is not a valid semver release');
    });

    it('still checks normal versions when ignoreSnapshots is true', () => {
      expect(validateVersionConstraint('>=2.6.4', '2.7.0', { ignoreSnapshots: true })).toBe(true);
      expect(validateVersionConstraint('>=2.6.4', '2.5.0', { ignoreSnapshots: true })).toBe(false);
    });

    it('passes snapshot with v prefix when ignoreSnapshots is true', () => {
      expect(validateVersionConstraint('>=2.6.4', 'v2.9.0-snapshot-01', { ignoreSnapshots: true })).toBe(true);
    });

    it('throws on snapshot with v prefix when ignoreSnapshots is false', () => {
      expect(() =>
        validateVersionConstraint('>=2.6.4', 'v2.9.0-snapshot-01'),
      ).toThrow('Snapshot version "v2.9.0-snapshot-01" is not a valid semver release');
    });

    it('handles normal version with v prefix', () => {
      expect(validateVersionConstraint('>=2.5.0', 'v2.6.0')).toBe(true);
      expect(validateVersionConstraint('>=2.7.0', 'v2.6.0')).toBe(false);
    });

    it('treats v2.4.0-test-1 as a snapshot', () => {
      expect(validateVersionConstraint('>=2.4.0', 'v2.4.0-test-1', { ignoreSnapshots: true })).toBe(true);
      expect(() =>
        validateVersionConstraint('>=2.4.0', 'v2.4.0-test-1'),
      ).toThrow('Snapshot version "v2.4.0-test-1" is not a valid semver release');
    });

    it('treats 2.4.0-feat-test-1 as a snapshot', () => {
      expect(validateVersionConstraint('>=2.4.0', '2.4.0-feat-test-1', { ignoreSnapshots: true })).toBe(true);
      expect(() =>
        validateVersionConstraint('>=2.4.0', '2.4.0-feat-test-1'),
      ).toThrow('Snapshot version "2.4.0-feat-test-1" is not a valid semver release');
    });
  });
});
