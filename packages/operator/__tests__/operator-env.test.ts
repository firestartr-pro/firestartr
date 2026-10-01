describe('operator-env', () => {
  afterEach(() => {
    delete process.env.ORG;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PEM_FILE;
    delete process.env.PREFAPP_BOT_PAT;
  });

  it('captures ORG, GITHUB_APP_ID, GITHUB_APP_PEM_FILE, PREFAPP_BOT_PAT', () => {
    process.env.ORG = 'test-org';
    process.env.GITHUB_APP_ID = '123';
    process.env.GITHUB_APP_PEM_FILE = '/path/to/key.pem';
    process.env.PREFAPP_BOT_PAT = 'ghp_test123';

    jest.resetModules();
    const { getOperatorEnvSnapshot } = require('../src/operator-env');
    const snapshot = getOperatorEnvSnapshot();
    expect(snapshot.ORG).toBe('test-org');
    expect(snapshot.GITHUB_APP_ID).toBe('123');
    expect(snapshot.GITHUB_APP_PEM_FILE).toBe('/path/to/key.pem');
    expect(snapshot.PREFAPP_BOT_PAT).toBe('ghp_test123');
  });

  it('does not change after process.env mutations (immutability)', () => {
    process.env.ORG = 'org-1';
    process.env.GITHUB_APP_ID = 'id-1';
    process.env.GITHUB_APP_PEM_FILE = 'pem-1';
    process.env.PREFAPP_BOT_PAT = 'pat-1';

    jest.resetModules();
    const { getOperatorEnvSnapshot } = require('../src/operator-env');
    expect(getOperatorEnvSnapshot()).toEqual({
      ORG: 'org-1',
      GITHUB_APP_ID: 'id-1',
      GITHUB_APP_PEM_FILE: 'pem-1',
      PREFAPP_BOT_PAT: 'pat-1',
    });

    process.env.ORG = 'org-2';
    process.env.GITHUB_APP_ID = 'id-2';
    process.env.GITHUB_APP_PEM_FILE = 'pem-2';
    process.env.PREFAPP_BOT_PAT = 'pat-2';

    expect(getOperatorEnvSnapshot()).toEqual({
      ORG: 'org-1',
      GITHUB_APP_ID: 'id-1',
      GITHUB_APP_PEM_FILE: 'pem-1',
      PREFAPP_BOT_PAT: 'pat-1',
    });
  });

  it('returns empty values for unset env vars', () => {
    jest.resetModules();
    const { getOperatorEnvSnapshot } = require('../src/operator-env');
    const snapshot = getOperatorEnvSnapshot();
    expect(snapshot.ORG).toBeUndefined();
    expect(snapshot.GITHUB_APP_ID).toBeUndefined();
    expect(snapshot.GITHUB_APP_PEM_FILE).toBeUndefined();
    expect(snapshot.PREFAPP_BOT_PAT).toBeUndefined();
  });
});
