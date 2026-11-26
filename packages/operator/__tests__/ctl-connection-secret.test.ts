jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    silly: jest.fn(),
    warn: jest.fn(),
  },
}));

const readNamespacedSecret = jest.fn();
const createNamespacedSecret = jest.fn();

jest.mock('@kubernetes/client-node', () => ({
  __esModule: true,
  KubeConfig: jest.fn().mockImplementation(() => ({
    loadFromDefault: jest.fn(),
    applyToHTTPSOptions: jest.fn(),
    currentContext: 'default',
    contexts: [{ name: 'default', cluster: 'default' }],
    clusters: [{ name: 'default', server: 'https://k8s.test' }],
    makeApiClient: jest.fn(() => ({
      readNamespacedSecret,
      createNamespacedSecret,
    })),
  })),
  CoreV1Api: jest.fn(),
}));

import { writeConnectionSecret } from '../src/ctl';
import { outputsSecretName } from '../src/resolver';

function ruleset(name: string, recordedName: string) {
  return {
    apiVersion: 'firestartr.dev/v1',
    kind: 'FirestartrGithubOrgRuleset',
    metadata: { name, namespace: 'default', uid: 'uid-1' },
    spec: { writeConnectionSecretToRef: { name: recordedName } },
  };
}

describe('writeConnectionSecret', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readNamespacedSecret.mockRejectedValue({ code: 404 });
    createNamespacedSecret.mockResolvedValue({});
  });

  it.each([
    ['a short name', 'ruleset-a-uuid', 'recorded-outputs'],
    [
      'a name that exceeds the Kubernetes limit',
      'a'.repeat(240),
      `firestartrgithuborgruleset-${'a'.repeat(100)}-uuid-outputs`,
    ],
  ])(
    'writes the secret the resolver reads for %s',
    async (_, name, recorded) => {
      const item = ruleset(name, recorded);

      await writeConnectionSecret(item, { key: { value: 'v' } });

      const written = createNamespacedSecret.mock.calls[0][0].body;

      expect(written.metadata.name).toBe(outputsSecretName(item));
      expect(written.metadata.name.length).toBeLessThanOrEqual(253);
    },
  );
});
