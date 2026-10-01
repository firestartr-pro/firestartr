const entity = {
  deps: {},
  inDebugMode: false,
  k8sId: 'FirestartrGithubGroup/group-a',
  cr: { kind: 'FirestartrGithubGroup' },
  tfStateKey: 'mockStateKey',
  prepareToLoad: jest.fn(async () => undefined),
  loadResources: jest.fn(async () => undefined),
  postProvision: jest.fn(async () => undefined),
  synthEnd: jest.fn(),
};

jest.mock('../src', () => ({
  __esModule: true,
  initSystem: jest.fn(async () => entity),
}));

jest.mock('../src/tp_bridge', () => ({
  __esModule: true,
  buildContext: jest.fn(),
  runOnTerraform: jest.fn(async (_entity, command: string) => `${command} output`),
}));

jest.mock('../src/debug', () => ({
  __esModule: true,
  initDebug: jest.fn(),
  endDebug: jest.fn(),
  debugTerraformOutput: jest.fn(),
}));

jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock('catalog_common', () => ({
  __esModule: true,
  default: {
    generic: {
      getFirestartrAnnotation: jest.fn((name: string) => `firestartr.dev/${name}`),
    },
  },
}));

import { runGhProvisioner } from '..';
import { runOnTerraform } from '../src/tp_bridge';

describe('runGhProvisioner plan mode', () => {
  const cr = {
    kind: 'FirestartrGithubGroup',
    metadata: {
      annotations: {},
      name: 'group-a',
    },
    spec: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs a plan without post provision or output', async () => {
    const output = await runGhProvisioner({ mainCr: cr, deps: {} }, { plan: true });

    expect(output).toBe('plan output');
    expect(entity.prepareToLoad).toHaveBeenCalledWith('plan');
    expect(entity.loadResources).toHaveBeenCalledWith('plan');
    expect(runOnTerraform).toHaveBeenCalledWith(entity, 'plan', undefined, {
      plan: true,
    });
    expect(entity.postProvision).not.toHaveBeenCalled();
  });

  it('runs a destroy plan without post provision or output', async () => {
    const output = await runGhProvisioner(
      { mainCr: cr, deps: {} },
      { planDestroy: true },
    );

    expect(output).toBe('plan-destroy output');
    expect(entity.prepareToLoad).toHaveBeenCalledWith('plan-destroy');
    expect(entity.loadResources).toHaveBeenCalledWith('plan-destroy');
    expect(runOnTerraform).toHaveBeenCalledWith(entity, 'plan-destroy', undefined, {
      planDestroy: true,
    });
    expect(entity.postProvision).not.toHaveBeenCalled();
  });

  it('gives plan mode precedence over import annotations', async () => {
    const output = await runGhProvisioner(
      {
        mainCr: {
          ...cr,
          metadata: {
            ...cr.metadata,
            annotations: {
              'firestartr.dev/import': 'true',
            },
          },
        },
        deps: {},
      },
      { plan: true },
    );

    expect(output).toBe('plan output');
    expect(entity.prepareToLoad).toHaveBeenCalledWith('plan');
    expect(entity.loadResources).toHaveBeenCalledWith('plan');
    expect(runOnTerraform).toHaveBeenCalledWith(entity, 'plan', undefined, {
      plan: true,
    });
    expect(entity.postProvision).not.toHaveBeenCalled();
  });

  it('gives delete mode precedence over import annotations', async () => {
    const output = await runGhProvisioner(
      {
        mainCr: {
          ...cr,
          metadata: {
            ...cr.metadata,
            annotations: {
              'firestartr.dev/import': 'true',
            },
          },
        },
        deps: {},
      },
      { delete: true },
    );

    expect(entity.prepareToLoad).toHaveBeenCalledWith('destroy');
    expect(entity.loadResources).toHaveBeenCalledWith('destroy');
    expect(runOnTerraform).toHaveBeenCalledWith(entity, 'destroy', undefined, {
      delete: true,
    });
  });

  it('imports when firestartr.dev/import annotation is set even with opts.create', async () => {
    const output = await runGhProvisioner(
      {
        mainCr: {
          ...cr,
          metadata: {
            ...cr.metadata,
            annotations: {
              'firestartr.dev/import': 'true',
            },
          },
        },
        deps: {},
      },
      { create: true },
    );

    expect(output).toBe('import output');
    expect(entity.prepareToLoad).toHaveBeenCalledWith('import');
    expect(entity.loadResources).toHaveBeenCalledWith('import');
    expect(runOnTerraform).toHaveBeenCalledWith(entity, 'import', undefined, {
      create: true,
    });
  });

  it('imports when firestartr.dev/import annotation is set even with opts.update', async () => {
    const output = await runGhProvisioner(
      {
        mainCr: {
          ...cr,
          metadata: {
            ...cr.metadata,
            annotations: {
              'firestartr.dev/import': 'true',
            },
          },
        },
        deps: {},
      },
      { update: true },
    );

    expect(output).toBe('import output');
    expect(entity.prepareToLoad).toHaveBeenCalledWith('import');
    expect(entity.loadResources).toHaveBeenCalledWith('import');
    expect(runOnTerraform).toHaveBeenCalledWith(entity, 'import', undefined, {
      update: true,
    });
  });

  it('imports with reimport when needs-re-import annotation is set with opts.create', async () => {
    const output = await runGhProvisioner(
      {
        mainCr: {
          ...cr,
          metadata: {
            ...cr.metadata,
            annotations: {
              'firestartr.dev/import': 'true',
              'firestartr.dev/needs-re-import': 'true',
            },
          },
        },
        deps: {},
      },
      { create: true },
    );

    expect(output).toBe('import-with-reimport output');
    expect(entity.prepareToLoad).toHaveBeenCalledWith('import-with-reimport');
    expect(entity.loadResources).toHaveBeenCalledWith('import-with-reimport');
    expect(runOnTerraform).toHaveBeenCalledWith(
      entity,
      'import-with-reimport',
      undefined,
      { create: true },
    );
  });

  it('imports when opts.import is set even with opts.create', async () => {
    const output = await runGhProvisioner(
      { mainCr: cr, deps: {} },
      { import: true, create: true },
    );

    expect(output).toBe('import output');
    expect(entity.prepareToLoad).toHaveBeenCalledWith('import');
    expect(entity.loadResources).toHaveBeenCalledWith('import');
    expect(runOnTerraform).toHaveBeenCalledWith(entity, 'import', undefined, {
      import: true,
      create: true,
    });
  });

  it('applies with opts.create when no import annotation', async () => {
    const output = await runGhProvisioner(
      { mainCr: cr, deps: {} },
      { create: true },
    );

    expect(output).toBe('apply output');
    expect(entity.prepareToLoad).toHaveBeenCalledWith('apply');
    expect(entity.loadResources).toHaveBeenCalledWith('apply');
    expect(runOnTerraform).toHaveBeenCalledWith(entity, 'apply', undefined, {
      create: true,
    });
  });

  it('applies with opts.update when no import annotation', async () => {
    const output = await runGhProvisioner(
      { mainCr: cr, deps: {} },
      { update: true },
    );

    expect(output).toBe('apply output');
    expect(entity.prepareToLoad).toHaveBeenCalledWith('apply');
    expect(entity.loadResources).toHaveBeenCalledWith('apply');
    expect(runOnTerraform).toHaveBeenCalledWith(entity, 'apply', undefined, {
      update: true,
    });
  });

  it('preserves inner error messages without nested Error prefixes', async () => {
    entity.loadResources.mockRejectedValueOnce(
      new Error('missing GitHub team context'),
    );

    await expect(
      runGhProvisioner({mainCr: cr, deps: {}}, {plan: true}),
    ).rejects.toThrow(
      '[gh-provisioner] Error running runGhProvisioner: missing GitHub team context',
    );

    expect(entity.synthEnd).toHaveBeenCalledWith('missing GitHub team context');
  });
});
