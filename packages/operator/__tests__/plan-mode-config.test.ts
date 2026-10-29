import {
  DEFAULT_PLAN_OUTPUT_DIR,
  InvalidPlanModeError,
  resolvePlanModeConfig,
} from '../src/plan-mode/config';

describe('Plan mode activation', () => {
  it('is off by default', () => {
    expect(resolvePlanModeConfig({})).toEqual({
      enabled: false,
      outputDir: DEFAULT_PLAN_OUTPUT_DIR,
    });
  });

  it('is turned on by the --plan-mode flag', () => {
    expect(resolvePlanModeConfig({ flag: true }).enabled).toBe(true);
  });

  it('is turned on by OPERATOR_PLAN_MODE=true', () => {
    expect(resolvePlanModeConfig({ env: 'true' }).enabled).toBe(true);
  });

  it('is on if either source enables it', () => {
    expect(resolvePlanModeConfig({ flag: true, env: 'false' }).enabled).toBe(
      true,
    );
    expect(resolvePlanModeConfig({ flag: false, env: 'true' }).enabled).toBe(
      true,
    );
  });

  it('stays off with OPERATOR_PLAN_MODE=false', () => {
    expect(resolvePlanModeConfig({ env: 'false' }).enabled).toBe(false);
  });

  it.each(['TRUE', '1', 'yes', 'ture', ''])(
    'refuses to start with OPERATOR_PLAN_MODE=%p',
    (value) => {
      expect(() => resolvePlanModeConfig({ env: value })).toThrow(
        InvalidPlanModeError,
      );
    },
  );

  it('refuses to start combined with import mode', () => {
    expect(() =>
      resolvePlanModeConfig({ env: 'true', importMode: true }),
    ).toThrow('Plan mode cannot be combined with --importMode');
    expect(resolvePlanModeConfig({ importMode: true }).enabled).toBe(false);
  });

  it('uses --plan-output-dir when given', () => {
    expect(resolvePlanModeConfig({ outputDir: '/data/plans' }).outputDir).toBe(
      '/data/plans',
    );
  });

  it('is frozen once set at startup', () => {
    jest.isolateModules(() => {
      const config = require('../src/plan-mode/config');

      const frozen = config.initPlanMode({ flag: true });

      expect(Object.isFrozen(frozen)).toBe(true);
      expect(config.isPlanMode()).toBe(true);
      expect(() => config.initPlanMode({ flag: false })).toThrow(
        /fixed at startup/,
      );
      expect(config.isPlanMode()).toBe(true);
    });
  });

  it('lets writes through when Plan mode is off', () => {
    jest.isolateModules(() => {
      const gateway = require('../src/plan-mode/write-gateway');

      expect(() => gateway.assertWriteAllowed('anything')).not.toThrow();
    });
  });
});
