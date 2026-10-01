import { CommandLineOptions } from 'command-line-args';
import { Subcommand } from '../types';
import { runService } from 'crs_status_service';

export const crsStatusSubcommand: Subcommand = {
  description: 'CR status service subcommands',
  requiredEnv: [],
  subparameters: [{ name: 'start', alias: 's', type: Boolean }],

  run: async (options: CommandLineOptions) => {
    if (!options['start']) {
      throw 'Error: Missing arg: --start';
    }
    await runService();
  },
};
