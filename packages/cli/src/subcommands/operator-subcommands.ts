import { CommandLineOptions } from 'command-line-args';
import { Subcommand } from '../types';
import { runOperator, execTfCommand, pullRequestPlan } from 'operator';
import common from 'catalog_common';

export const operatorSubcommands: Subcommand = {
  description: 'Operator subcommands',

  requiredEnv: [],

  subparameters: [
    { name: 'start', alias: 's', type: String },
    { name: 'importMode', type: Boolean, defaultValue: false },
    { name: 'importModeSkipPlan', type: Boolean, defaultValue: false },
    { name: 'plan-mode', type: Boolean, defaultValue: false },
    { name: 'plan-output-dir', type: String },
    { name: 'withMetrics', type: Boolean },
    { name: 'plan', type: Boolean },
    { name: 'apply', type: Boolean },
    { name: 'claim', alias: 'c', type: String },
    { name: 'namespace', alias: 'n', type: String },
    { name: 'pull-request-plan', type: Boolean, defaultValue: false },
    { name: 'repo', type: String },
    { name: 'owner', type: String },
    { name: 'ref', type: String },
    { name: 'prNumber', type: String },
  ],

  run: async (options: CommandLineOptions) => {
    // This will show the command line options passed to the command
    console.table(options);

    const planModeEnv = common.environment.getFromEnvironment(
      common.types.envVars.operatorPlanMode,
    );
    if (
      planModeEnv !== undefined &&
      planModeEnv !== 'true' &&
      planModeEnv !== 'false'
    ) {
      throw new Error(
        `OPERATOR_PLAN_MODE must be 'true' or 'false' (or unset), got '${planModeEnv}'; refusing to start`,
      );
    }
    if (
      (options['plan-mode'] || planModeEnv === 'true') &&
      options['apply']
    )
      throw 'Error: --plan-mode cannot be combined with --apply';

    if (options['plan'] || options['apply']) {
      if (!options['claim']) throw 'Error: Missing arg: --claim';

      if (!options['namespace']) throw 'Error: Missing arg: --namespace';

      const command = options['plan'] ? 'plan' : 'apply';

      await execTfCommand(
        command,

        options['claim'],

        options['namespace'] || 'default',
      );
      return;
    }

    if (!options['start']) {
      throw `Error: Unknown arg: ${JSON.stringify(options, null, 4)}`;
    } else if (options['start'] === 'controller') {
      const kindList =
        common.environment
          .getFromEnvironment(common.types.envVars.operatorKindList)
          ?.split(',') || [];

      const namespace = common.environment.getFromEnvironment(
        common.types.envVars.operatorNamespace,
      );

      const dummyExec = common.environment.getFromEnvironmentAsBoolean(
        common.types.envVars.operatorDummyExec,
      );

      const ignoreLease = common.environment.getFromEnvironmentAsBoolean(
        common.types.envVars.operatorIgnoreLease,
      );

      runOperator({
        ignoreLease,
        dummyExec,
        namespace,
        kindList,
        planMode: options['plan-mode'],
        planOutputDir: options['plan-output-dir'],
        ...options,
      });
    }

    if (options['pull-request-plan']) {
      await pullRequestPlan({
        prNumber: parseInt(options['prNumber']),
        repo: options['repo'],
        owner: options['owner'],
        namespace: options['namespace'] || 'default',
        ref: options['ref'],
      });
    }
  },
};
