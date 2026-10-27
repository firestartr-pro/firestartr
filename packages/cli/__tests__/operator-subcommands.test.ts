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
});
