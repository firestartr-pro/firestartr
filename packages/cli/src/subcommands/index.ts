import { CommandLineOptions } from 'command-line-args';
import { Subcommand, Subcommands } from '../types';
import common from 'catalog_common';
import { importSubcommand } from './importer-subcommands';
import { scaffoldSubcommand } from './scaffolder-subcommands';
import { operatorSubcommands } from './operator-subcommands';
import { cdk8s_rendererSubcommands } from './cdk8s_renderer-subcommands';
import { crs_analyzerSubcommand } from './crs_analyzer-subcommands';
import { crsStatusSubcommand } from './crs_status_service-subcommands';
import { version as cliVersion } from '../../package.json';
import { version as firestartrVersion } from '../../../../package.json';
import { validateVersionConstraint } from '../version';
export { validateVersionConstraint };
const versionSubcommand: Subcommand = {
  description: 'Show CLI version or validate a version constraint',
  requiredEnv: [],
  subparameters: [
    { name: 'help', type: Boolean },
    { name: 'validate', type: String },
    { name: 'cli-version', type: String },
    { name: 'ignore-snapshots', type: Boolean },
  ],
  run: async (options: CommandLineOptions) => {
    if (options['help']) {
      showVersionHelp();
      return;
    }
    if (options['validate']) {
      const constraint = options['validate'] as string;
      const targetVersion = (options['cli-version'] as string) || cliVersion;
      const ignoreSnapshots = options['ignore-snapshots'] as boolean;
      if (
        validateVersionConstraint(constraint, targetVersion, {
          ignoreSnapshots,
        })
      ) {
        console.log(
          `CLI version ${targetVersion} satisfies constraint "${constraint}"`,
        );
      } else {
        throw new Error(
          `Version constraint "${constraint}" not met by CLI version ${targetVersion}`,
        );
      }
      return;
    }
    showCliVersion();
  },
};

const SUBCOMMANDS: Subcommands = {
  import: importSubcommand,
  importer: importSubcommand,
  scaffold: scaffoldSubcommand,
  operator: operatorSubcommands,
  cdk8s: cdk8s_rendererSubcommands,
  analyzer: crs_analyzerSubcommand,
  'crs-status': crsStatusSubcommand,
  version: versionSubcommand,
};

// Check that the subcommand exists and it's env is defined
export function validateAndGetSubcommand(name: string): Subcommand {
  // Check that subcommand is valid
  if (typeof SUBCOMMANDS[name] === 'undefined') {
    throw `Unknown command ${name}`;
  }

  // Check environment variables for the command
  SUBCOMMANDS[name]['requiredEnv'].forEach((envVar: any) => {
    if (!common.environment.checkExistOnEnvironment(envVar)) {
      throw `ENV::${envVar} must be setted before calling ${name}`;
    }
  });

  return SUBCOMMANDS[name];
}

// Generates help for subcommands of CLI
export function showSubcommandsHelp() {
  const commandsList: { subcommand: string; description: string }[] = [];

  Object.keys(SUBCOMMANDS)
    .sort()
    .forEach((subcomamndName) => {
      commandsList.push({
        subcommand: subcomamndName,

        description: SUBCOMMANDS[subcomamndName]['description'],
      });
    });

  console.log('AVAILABLE COMMANDS');
  console.table(commandsList);
}

export function showCliVersion() {
  console.log(
    `CLI Version: ${cliVersion}. Firestartr Version: ${firestartrVersion}`,
  );
}

function showVersionHelp() {
  console.log(`Usage: firestartr-cli version [options]

Show the current CLI and Firestartr versions, or validate a version constraint.

Options:
  --help                   Show this help message
  --validate <constraint>  Validate that the CLI version satisfies a semver constraint (e.g. ">=2.6.4")
  --cli-version <version>  Override the version to check against (default: installed CLI version)
  --ignore-snapshots       Allow snapshot versions (e.g. "2.9.0-snapshot-01") to bypass validation

Examples:
  firestartr-cli version
  firestartr-cli version --validate ">=2.6.4"
  firestartr-cli version --validate ">=2.6.4" --cli-version "2.7.0"
  firestartr-cli version --validate ">=2.6.4" --ignore-snapshots`);
}
