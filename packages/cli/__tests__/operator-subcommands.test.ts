jest.mock('operator', () => ({
  runOperator: jest.fn(),
  execTfCommand: jest.fn(),
  pullRequestPlan: jest.fn(),
}));

import { execTfCommand, runOperator } from 'operator';
import { operatorSubcommands } from '../src/subcommands/operator-subcommands';

describe('operator subcommands', () => {
  it('rejects --plan-mode combined with --apply before running anything', async () => {
    await expect(
      operatorSubcommands.run({
        start: 'controller',
        'plan-mode': true,
        apply: true,
        claim: 'c',
        namespace: 'n',
      }),
    ).rejects.toBe('Error: --plan-mode cannot be combined with --apply');

    expect(execTfCommand).not.toHaveBeenCalled();
    expect(runOperator).not.toHaveBeenCalled();
  });

  describe('with OPERATOR_PLAN_MODE set', () => {
    const original = process.env.OPERATOR_PLAN_MODE;

    afterEach(() => {
      if (original === undefined) delete process.env.OPERATOR_PLAN_MODE;
      else process.env.OPERATOR_PLAN_MODE = original;
      jest.clearAllMocks();
    });

    it('rejects --apply when the environment enables Plan mode', async () => {
      process.env.OPERATOR_PLAN_MODE = 'true';

      await expect(
        operatorSubcommands.run({ apply: true, claim: 'c', namespace: 'n' }),
      ).rejects.toBe('Error: --plan-mode cannot be combined with --apply');

      expect(execTfCommand).not.toHaveBeenCalled();
    });

    it('rejects an invalid value before a one-off apply', async () => {
      process.env.OPERATOR_PLAN_MODE = 'yes';

      await expect(
        operatorSubcommands.run({ apply: true, claim: 'c', namespace: 'n' }),
      ).rejects.toThrow("OPERATOR_PLAN_MODE must be 'true' or 'false'");

      expect(execTfCommand).not.toHaveBeenCalled();
    });
  });
});
