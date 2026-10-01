import { Command, Flags } from '@oclif/core';
import {
  createFeatureSource,
  DEFAULT_FEATURE_SOURCE,
} from '../../utils/featureSource.js';

const DETAIL_FLAGS = ['versions', 'schema', 'readme', 'changelog'];

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

export default class FeaturesDiscover extends Command {
  static aliases = ['discovery:features'];
  static description = 'Discover available platform features';

  static flags = {
    source: Flags.string({
      description: 'Feature source URL or local path',
      default: DEFAULT_FEATURE_SOURCE,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
      exclusive: ['readme', 'changelog'],
    }),
    versions: Flags.string({
      description: 'Show version history for a feature',
      exclusive: DETAIL_FLAGS.filter((flag) => flag !== 'versions'),
    }),
    schema: Flags.string({
      description: 'Show the schema for a feature version (name@version)',
      exclusive: DETAIL_FLAGS.filter((flag) => flag !== 'schema'),
    }),
    readme: Flags.string({
      description: 'Show a feature README',
      exclusive: DETAIL_FLAGS.filter((flag) => flag !== 'readme'),
    }),
    changelog: Flags.string({
      description: 'Show a feature CHANGELOG',
      exclusive: DETAIL_FLAGS.filter((flag) => flag !== 'changelog'),
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FeaturesDiscover);

    try {
      const source = createFeatureSource(flags.source);

      if (flags.versions) {
        const versions = await source.readFeatureVersions(flags.versions);
        if (flags.json) {
          writeLine(JSON.stringify(versions, null, 2));
          return;
        }
        const verW = Math.max(...versions.map((v) => v.version.length), 7);
        const dateW = Math.max(...versions.map((v) => v.date.length), 4);
        writeLine(
          'VERSION'.padEnd(verW) + '  ' + 'DATE'.padEnd(dateW) + '  SCHEMA',
        );
        for (const v of versions) {
          writeLine(
            v.version.padEnd(verW) + '  ' + v.date.padEnd(dateW) + '  ' + v.url,
          );
        }
        return;
      }

      if (flags.schema) {
        const separator = flags.schema.lastIndexOf('@');
        if (separator <= 0 || separator === flags.schema.length - 1) {
          throw new Error('Schema must use the format name@version');
        }
        writeLine(
          JSON.stringify(
            await source.readFeatureSchema(
              flags.schema.slice(0, separator),
              flags.schema.slice(separator + 1),
            ),
            null,
            2,
          ),
        );
        return;
      }

      if (flags.readme || flags.changelog) {
        const filename = flags.readme ? 'README.md' : 'CHANGELOG.md';
        process.stdout.write(
          await source.readFeatureDocument(
            flags.readme ?? flags.changelog!,
            filename,
          ),
        );
        return;
      }

      const index = await source.readFeatureIndex();
      if (flags.json) {
        writeLine(JSON.stringify(index, null, 2));
        return;
      }

      const features = index.features;
      const nameW = Math.max(...features.map((f) => f.name.length), 4);
      const verW = Math.max(...features.map((f) => f.version.length), 7);
      writeLine(
        'NAME'.padEnd(nameW) + '  ' + 'VERSION'.padEnd(verW) + '  FILES',
      );
      for (const feature of features) {
        writeLine(
          feature.name.padEnd(nameW) +
            '  ' +
            feature.version.padEnd(verW) +
            '  ' +
            feature.files.map((file) => file.name).join(', '),
        );
      }
    } catch (error) {
      this.error(error instanceof Error ? error : String(error));
    }
  }
}
