import commandLineArgs, { CommandLineOptions } from 'command-line-args';
import { showSubcommandsHelp, validateAndGetSubcommand } from './subcommands';
import { Subcommand } from './types';

class CommandLine {
  async run() {
    // Parse the command line arguments and determine the subcommand
    const mainDefinitions = [{ name: 'subcommand', defaultOption: true }];
    const mainOptions = commandLineArgs(mainDefinitions, {
      stopAtFirstUnknown: true,
    });
    const subcommand = mainOptions.subcommand;

    return await this.runSubcommand(subcommand, mainOptions);
  }

  async runSubcommand(
    subcommand: string | undefined,
    subcommandOptions: CommandLineOptions,
  ) {
    switch (subcommand) {
      case undefined:
      case 'help':
        showSubcommandsHelp();
        break;

      default: {
        // Get the subcommand data
        const subcommandData: Subcommand = validateAndGetSubcommand(subcommand);

        // Get subparameters for the subcommand
        const parameters: CommandLineOptions = commandLineArgs(
          subcommandData.subparameters,
          { argv: subcommandOptions._unknown || [] },
        );

        // Execute the command
        await subcommandData.run(parameters);
      }
    }

    return 'done';
  }
}

export default CommandLine;
