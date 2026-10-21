jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    silly: jest.fn(),
  },
}));

jest.mock('terraform_provisioner', () => ({
  __esModule: true,
  runTerraformProvisioner: jest.fn(),
}));

jest.mock('../src/ctl', () => ({
  __esModule: true,
  addDestroyCommitStatus: jest.fn(),
  addPlanStatusCheck: jest.fn(),
}));

jest.mock('../src/user-feedback-ops/tf-checkrun', () => ({
  __esModule: true,
  TFCheckRun: jest.fn(async () => ({
    fnData: jest.fn(),
    fnEnd: jest.fn(),
    fnOnError: jest.fn(),
  })),
}));

jest.mock('../src/user-feedback-ops/user-feedback-ops', () => ({
  __esModule: true,
  tryPublishApply: jest.fn(),
  tryPublishDestroy: jest.fn(),
  tryPublishError: jest.fn(),
  tryCreateErrorSummary: jest.fn(),
}));

import { resolveReferences } from '../src/tfworkspaces/process-operation';

function workspaceCr(references: any[]) {
  return {
    kind: 'FirestartrTerraformWorkspace',
    metadata: { name: 'ws-a', namespace: 'default' },
    spec: { references },
  };
}

describe('tfworkspaces resolveReferences', () => {
  it('resolves a reference from the outputs of an existing dependency', () => {
    const outputs = Buffer.from(
      JSON.stringify({ id: { value: 'team-1' } }),
    ).toString('base64');

    const deps = {
      'FirestartrGithubGroup-team-a': {
        cr: {
          kind: 'FirestartrGithubGroup',
          metadata: { name: 'team-a' },
          spec: {},
        },
        secret: { metadata: { name: 'team-a-outputs' }, data: { outputs } },
      },
    };

    const item = workspaceCr([
      {
        name: 'team_id',
        ref: { kind: 'FirestartrGithubGroup', name: 'team-a', key: 'id' },
      },
    ]);

    expect(resolveReferences(item, deps)).toEqual({ team_id: 'team-1' });
  });

  it('throws a comprehensive error when a referenced dep is absent instead of a TypeError', () => {
    const item = workspaceCr([
      {
        name: 'team_id',
        ref: {
          kind: 'FirestartrGithubGroup',
          name: 'missing-team',
          key: 'id',
        },
      },
    ]);

    expect(() => resolveReferences(item, {})).toThrow(
      /Reference FirestartrGithubGroup-missing-team not found/,
    );
  });

  it('throws the reference error for an absent Secret before dereferencing it', () => {
    // Regression for the guard order: the Secret branch used to write
    // `ref.secret` before checking that `ref` exists, so an absent Secret
    // crashed with a TypeError instead of the reference error.
    const item = workspaceCr([
      {
        name: 'token',
        ref: { kind: 'Secret', name: 'missing-secret', key: 'token' },
      },
    ]);

    expect(() => resolveReferences(item, {})).toThrow(
      /Reference Secret-missing-secret not found/,
    );
  });
});
