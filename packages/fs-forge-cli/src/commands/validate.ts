import { Command, Flags } from '@oclif/core';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createClaimValidator } from '../utils/ajvValidation.js';
import { getFeatureReferences } from '../utils/features.js';
import {
  resolveLatestFeatureSchema,
  validateFeatureArgs,
} from '../utils/featureSchema.js';
import { DEFAULT_FEATURE_SOURCE } from '../utils/featureSource.js';
import YAML from 'yaml';

export default class Validate extends Command {
  static description = 'Validate a YAML claim file against its schema';

  static flags = {
    file: Flags.string({
      char: 'f',
      multiple: true,
      required: true,
      description:
        'Path to a YAML claim file (can be specified multiple times)',
    }),
    source: Flags.string({
      description: 'Feature source URL or local path',
      default: DEFAULT_FEATURE_SOURCE,
    }),
    refresh: Flags.boolean({
      description: 'Refresh cached Feature schemas',
    }),
  };

  static examples = [
    '<%= config.bin %> <%= command.id %> -f claim.yaml',
    '<%= config.bin %> <%= command.id %> -f component.yaml -f group.yaml',
  ];

  async run(): Promise<void> {
    const { flags } = await this.parse(Validate);
    const files = flags.file as string[];

    const validator = createClaimValidator({
      schemasDir: join(this.config.root, 'schemas'),
    });

    const results: Array<{
      file: string;
      kind: string | null;
      valid: boolean;
      errors: string[];
    }> = [];

    for (const filePath of files) {
      try {
        if (!existsSync(filePath)) {
          results.push({
            file: filePath,
            kind: null,
            valid: false,
            errors: [`File not found: ${filePath}`],
          });
          continue;
        }

        const content = await readFile(filePath, 'utf8');
        let claim: Record<string, unknown>;

        try {
          claim = YAML.parse(content) as Record<string, unknown>;
        } catch (parseErr) {
          results.push({
            file: filePath,
            kind: null,
            valid: false,
            errors: [`Invalid YAML: ${(parseErr as Error).message}`],
          });
          continue;
        }

        if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
          results.push({
            file: filePath,
            kind: null,
            valid: false,
            errors: ['File does not contain a valid YAML object'],
          });
          continue;
        }

        const kind = (claim.kind as string | undefined) ?? null;
        if (!kind) {
          results.push({
            file: filePath,
            kind: null,
            valid: false,
            errors: ['Claim is missing the required "kind" field'],
          });
          continue;
        }

        const result = await validator.validate(claim, kind);
        const errors = [...result.errors];
        if (kind === 'ComponentClaim') {
          let features: ReturnType<typeof getFeatureReferences> = [];
          try {
            features = getFeatureReferences(claim);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
          for (const feature of features) {
            try {
              const schema = await resolveLatestFeatureSchema(
                flags.source,
                feature.name,
                flags.refresh,
              );
              const featureResult = validateFeatureArgs(
                schema,
                feature.args ?? {},
              );
              errors.push(
                ...featureResult.errors.map(
                  (error) => `Feature ${feature.name}: ${error}`,
                ),
              );
            } catch (error) {
              errors.push(
                `Feature ${feature.name}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        }
        results.push({
          file: filePath,
          kind,
          valid: errors.length === 0,
          errors,
        });
      } catch (err) {
        results.push({
          file: filePath,
          kind: null,
          valid: false,
          errors: [(err as Error).message],
        });
      }
    }

    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

    const anyInvalid = results.some((r) => !r.valid);
    if (anyInvalid) {
      this.exit(1);
    }
  }
}
