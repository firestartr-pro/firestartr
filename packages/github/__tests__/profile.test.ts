import { createProfile, getProfile, _clearProfiles } from '../src/profile';
import { withProfile } from '../src/with_profile';
import { resolveGithubConfigFromProfile } from '../src/config_resolver';

describe('github profile store (logic/isolation)', () => {
  const ORIGINAL_ENV = {
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PEM_FILE: process.env.GITHUB_APP_PEM_FILE,
    ORG: process.env.ORG,
    PREFAPP_BOT_PAT: process.env.PREFAPP_BOT_PAT,
  };

  beforeEach(() => _clearProfiles());

  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  it('creates and retrieves a snapshot profile (logic)', () => {
    const ENV = { GITHUB_APP_ID: 'A', GITHUB_APP_PEM_FILE: 'B', ORG: 'O', PREFAPP_BOT_PAT: 'PAT' };
    createProfile('snap', { type: 'snapshot', config: { ...ENV } });
    const profile = getProfile('snap');
    expect(profile).toBeDefined();
    expect(profile && profile.type).toBe('snapshot');
    expect(profile && profile.config).toEqual(ENV);
  });

  it('creates and retrieves an ambient profile (logic)', () => {
    createProfile('amb', { type: 'ambient' });
    const profile = getProfile('amb');
    expect(profile).toBeDefined();
    expect(profile && profile.type).toBe('ambient');
    expect(profile && profile.config).toBeUndefined();
  });

  it('snapshot profiles do NOT change when process.env mutates', () => {
    process.env.GITHUB_APP_ID = 'ORIGINAL';
    process.env.GITHUB_APP_PEM_FILE = 'ORIGINALK';
    process.env.ORG = 'ORIGORG';
    process.env.PREFAPP_BOT_PAT = 'O-PAT';
    createProfile('snap-iso', {
      type: 'snapshot',
      config: {
        GITHUB_APP_ID: process.env.GITHUB_APP_ID,
        GITHUB_APP_PEM_FILE: process.env.GITHUB_APP_PEM_FILE,
        ORG: process.env.ORG,
        PREFAPP_BOT_PAT: process.env.PREFAPP_BOT_PAT,
      }
    });
    // Mutate env after creation
    process.env.GITHUB_APP_ID = 'NEW';
    process.env.GITHUB_APP_PEM_FILE = 'NEWK';
    process.env.ORG = 'NEWORG';
    process.env.PREFAPP_BOT_PAT = 'NEWPAT';
    // The resolved config MUST NOT change
    const resolved = resolveGithubConfigFromProfile('snap-iso');
    expect(resolved.appId).toBe('ORIGINAL');
    expect(resolved.privateKey).toBe('ORIGINALK');
    expect(resolved.org).toBe('ORIGORG');
    expect(resolved.patPrefapp).toBe('O-PAT');
  });

  it('ambient profiles DO reflect process.env changes at every resolve', () => {
    createProfile('ambient-live', { type: 'ambient' });
    process.env.GITHUB_APP_ID = 'LIVE1';
    process.env.GITHUB_APP_PEM_FILE = 'LX';
    process.env.ORG = 'ZZZ';
    process.env.PREFAPP_BOT_PAT = 'PAT1';
    let resolved = resolveGithubConfigFromProfile('ambient-live');
    expect(resolved.appId).toBe('LIVE1');
    expect(resolved.privateKey).toBe('LX');
    expect(resolved.org).toBe('ZZZ');
    expect(resolved.patPrefapp).toBe('PAT1');
    // Mutate env again
    process.env.GITHUB_APP_ID = 'NEWIDXX';
    process.env.GITHUB_APP_PEM_FILE = 'NEWPRIV';
    process.env.ORG = 'NEWORDER';
    process.env.PREFAPP_BOT_PAT = 'ANOTHER';
    resolved = resolveGithubConfigFromProfile('ambient-live');
    expect(resolved.appId).toBe('NEWIDXX');
    expect(resolved.privateKey).toBe('NEWPRIV');
    expect(resolved.org).toBe('NEWORDER');
    expect(resolved.patPrefapp).toBe('ANOTHER');
  });

  it('idempotent profile creation for identical snapshot', () => {
    createProfile('idemp', { type: 'snapshot', config: { a: '1' } });
    expect(() => createProfile('idemp', { type: 'snapshot', config: { a: '1' } })).not.toThrow();
  });

  it('throws for conflicting snapshot', () => {
    createProfile('snapx', { type: 'snapshot', config: { a: 'xx' } });
    expect(() => createProfile('snapx', { type: 'snapshot', config: { a: 'yy' } })).toThrow();
  });

  it('throws for conflicting ambient/snapshot', () => {
    createProfile('mix', { type: 'ambient' });
    expect(() => createProfile('mix', { type: 'snapshot', config: { a: '1' } })).toThrow();
  });

  it('withProfile throws for unknown profile', () => {
    expect(() => withProfile('zzz')).toThrow(/No github auth profile found/);
  });
});
