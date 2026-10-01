import { Command } from '@oclif/core';

import {
  COMPONENT_ARG,
  FEATURE_READ_FLAGS,
  FEATURE_TARGET_RELATIONSHIP,
} from '../../utils/featureCommand.js';
import { loadComponentTarget } from '../../utils/featureClaims.js';
import { getFeatureReferences } from '../../utils/features.js';

export default class FeaturesList extends Command {
  static args = COMPONENT_ARG;
  static description = 'List Feature references on a ComponentClaim';
  static usage = '(COMPONENT | --file <path>)';
  static helpRelationships = [FEATURE_TARGET_RELATIONSHIP];
  static examples = [
    '<%= config.bin %> <%= command.id %> my-component --org my-org',
    '<%= config.bin %> <%= command.id %> --file component.yaml --json',
  ];
  static flags = {
    ...FEATURE_READ_FLAGS,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FeaturesList);
    const target = await loadComponentTarget({
      component: args.component,
      file: flags.file,
      org: flags.org,
    });
    const features = getFeatureReferences(target.claim);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(features, null, 2)}\n`);
      return;
    }

    const rows = features.map((feature) => [
      feature.name,
      feature.version ?? '',
      feature.ref ?? '',
      JSON.stringify(feature.args ?? {}),
    ]);
    const widths = ['NAME', 'VERSION', 'REF', 'ARGS'].map((header, index) =>
      Math.max(header.length, ...rows.map((row) => row[index].length)),
    );
    process.stdout.write(
      `${['NAME', 'VERSION', 'REF', 'ARGS']
        .map((header, index) => header.padEnd(widths[index]))
        .join('  ')}\n`,
    );
    for (const row of rows) {
      process.stdout.write(
        `${row
          .map((value, index) => value.padEnd(widths[index]))
          .join('  ')}\n`,
      );
    }
  }
}
