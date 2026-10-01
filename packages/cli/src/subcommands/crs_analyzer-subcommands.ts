import { CommandLineOptions } from 'command-line-args';
import { Subcommand } from '../types';
import crs_analyzer from 'crs_analyzer';

export const crs_analyzerSubcommand: Subcommand = {
  description: 'CRS analyzer subcommands',
  requiredEnv: [],
  subparameters: [
    { name: 'org', alias: 'o', type: String },
    { name: 'repo', alias: 'r', type: String },
    { name: 'namespace', alias: 'n', type: String },
    { name: 'type', alias: 't', type: String },
  ],

  run: async (options: CommandLineOptions) => {
    for (const key of ['org', 'repo', 'namespace', 'type']) {
      if (!options[key]) {
        throw `Error: Missing arg: --${key}`;
      }
    }

    await crs_analyzer.runCrsAnalyzer(
      options['type'],
      options['namespace'],
      options['org'],
      options['repo'],
    );
  },
};
