import { Command, Flags } from '@oclif/core';

import {
  buildPlanJsonOutput,
  formatPlanText,
  planApp,
  writePlanOutputFiles,
} from '../../app/plan/index.js';
import {
  orgFromContext,
  resolveClaimsRepository,
} from '../../context/resolve.js';
import { createGitHubApi } from '../../github/index.js';
import { actionsSchemasDir } from '../../schema/actionsSchemas.js';
import {
  appInputsSchemaDir,
  loadAppInputsFile,
  validateAppInputs,
} from '../../schema/appInputs.js';
import { claimSchemasDir } from '../../schema/claimSchemas.js';
import { dotFirestartrSchemasDir } from '../../schema/dotFirestartrSchemas.js';
import { vendorSchemasDir } from '../../schema/vendorSchemas.js';
import {
  createFeatureSource,
  DEFAULT_FEATURE_SOURCE,
} from '../../utils/featureSource.js';

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

export default class AppPlan extends Command {
  static description =
    'Render files, compare with repos, and run checks for an app (read-only)';

  static examples = [
    '<%= config.bin %> <%= command.id %> --inputs app-inputs.yaml',
    '<%= config.bin %> <%= command.id %> --inputs app-inputs.yaml --json',
    '<%= config.bin %> <%= command.id %> --inputs app-inputs.yaml --out ./rendered --org-plan free',
  ];

  static flags = {
    inputs: Flags.string({
      description: 'Path to the AppInputs YAML file',
      required: true,
    }),
    out: Flags.string({
      description:
        'Write rendered non-noop, non-conflict files to <dir>/<repo>/<path>',
    }),
    org: Flags.string({
      description:
        'GitHub organization (overrides inputs file; falls back to FSCRT_ORG or context config)',
    }),
    app: Flags.string({
      description: 'Application name (overrides inputs file)',
    }),
    'org-plan': Flags.string({
      description: 'Override GitHub organization plan detection',
      options: ['free', 'paid'],
    }),
    'claims-repo': Flags.string({
      description:
        'Repository name for the claims repo (default: config, then claims)',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AppPlan);

    const schemasDir = appInputsSchemaDir(this.config.root);
    const loaded = await loadAppInputsFile(flags.inputs, schemasDir);
    if (!loaded.valid) {
      this.error(`Invalid inputs file:\n${loaded.errors.join('\n')}`, {
        exit: 2,
      });
    }

    const inputs = {
      ...loaded.data,
      ...(flags.app !== undefined ? { app: flags.app } : {}),
    };

    if (flags.app !== undefined) {
      const revalidated = validateAppInputs(inputs, schemasDir);
      if (!revalidated.valid) {
        this.error(
          `Invalid --app value "${flags.app}":\n${revalidated.errors.join('\n')}`,
          { exit: 2 },
        );
      }
    }

    const org =
      flags.org ?? inputs.org ?? process.env.FSCRT_ORG ?? orgFromContext();
    if (!org) {
      this.error(
        'Organization is required: pass --org, set "org" in the inputs file, set FSCRT_ORG, or configure a default org.',
        { exit: 2 },
      );
    }

    const claimsTarget = resolveClaimsRepository(org, flags['claims-repo']);

    let planResult;
    try {
      planResult = await planApp({
        api: createGitHubApi(),
        featureSource: createFeatureSource(DEFAULT_FEATURE_SOURCE),
        inputs,
        org,
        orgPlan: flags['org-plan'] as 'free' | 'paid' | undefined,
        claimsRepoName: claimsTarget.repo,
        schemaDirs: {
          claimSchemasDir: claimSchemasDir(this.config.root),
          dotFirestartrSchemasDir: dotFirestartrSchemasDir(this.config.root),
          actionsSchemasDir: actionsSchemasDir(this.config.root),
          vendorDir: vendorSchemasDir(this.config.root),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error(message, { exit: 2 });
    }

    const output = buildPlanJsonOutput(planResult);

    if (flags.out) {
      let written: string[];
      try {
        written = await writePlanOutputFiles(flags.out, output.steps);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.error(message, { exit: 2 });
      }
      if (!flags.json) {
        for (const filePath of written) {
          writeLine(`Wrote ${filePath}`);
        }
      }
    }

    if (flags.json) {
      writeLine(JSON.stringify(output, null, 2));
    } else {
      writeLine(formatPlanText(output));
    }

    if (!output.ready) {
      this.exit(1);
    }
  }
}
