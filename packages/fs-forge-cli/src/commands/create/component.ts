import { Command, Flags } from '@oclif/core';
import { join } from 'path';

import { assertCreatePath } from '../../claims/deterministicPath.js';
import { runClaimCreation } from '../../mutations/creation.js';
import { MUTATION_CONTROL_FLAGS } from '../../mutations/support.js';
import { setSchemasDir, validateClaim } from '../../utils/ajvValidation.js';
import { buildClaimFromFlags } from '../../utils/buildClaim.js';
import {
  mutateFeatureReference,
  parseFeatureReference,
} from '../../utils/features.js';
import { runtimeFlags } from '../../utils/runtimeFlags.js';
import type { FlagSpec } from '../../utils/deriveFlags.js';

export default class CreateComponent extends Command {
  static FLAG_SPECS = [
    {
      path: 'name',
      type: 'string',
      required: true,
      multiple: false,
    },
    {
      path: 'description',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'type',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'lifecycle',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'version',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.name',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description: 'The github repo name',
      multiple: false,
    },
    {
      path: 'providers.github.org',
      type: 'string',
      required: false,
      conditionalRequired: true,
      description:
        'GitHub organization where the component repository is created; different from --org, the claims-repo organization.',
      multiple: false,
    },
    {
      path: 'providers.github.tfStateKey',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.orgPermissions',
      type: 'string',
      required: false,
      description: 'The level of org Permission',
      multiple: false,
    },
    {
      path: 'providers.github.sync.enabled',
      type: 'boolean',
      required: false,
      conditionalRequired: true,
      multiple: false,
    },
    {
      path: 'providers.github.sync.period',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.sync.policy',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.sync.schedule',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.sync.schedule_timezone',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.technology.stack',
      type: 'string',
      required: false,
      conditionalRequired: true,
      multiple: false,
    },
    {
      path: 'providers.github.technology.version',
      type: 'string',
      required: false,
      conditionalRequired: true,
      multiple: false,
    },
    {
      path: 'providers.github.defaultBranch',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.branchStrategy.name',
      type: 'string',
      required: false,
      conditionalRequired: true,
      multiple: false,
    },
    {
      path: 'providers.github.branchStrategy.defaultBranch',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.additionalBranches.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.github.additionalBranches (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.github.actions.oidc.useDefault',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.actions.oidc.includeClaimKeys',
      type: 'string',
      required: false,
      multiple: true,
    },
    {
      path: 'providers.github.archiveOnDestroy',
      type: 'boolean',
      required: false,
      description:
        'whether this repo should be archived when the claim is deleted',
      multiple: false,
    },
    {
      path: 'providers.github.allowMergeCommit',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.allowSquashMerge',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.allowRebaseMerge',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.allowAutoMerge',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.deleteBranchOnMerge',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.autoInit',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.allowUpdateBranch',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.hasIssues',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.hasWiki',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.hasDiscussions',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.pages.cname',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.pages.public',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.pages.https_enforced',
      type: 'boolean',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.pages.buildType',
      type: 'string',
      required: false,
      enumValues: ['workflow', 'legacy'],
      multiple: false,
    },
    {
      path: 'providers.github.pages.source.branch',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providers.github.pages.source.path',
      type: 'string',
      required: false,
      enumValues: ['/', '/docs'],
      multiple: false,
    },
    {
      path: 'providers.github.additionalRules.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.github.additionalRules (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.github.visibility',
      type: 'string',
      required: false,
      conditionalRequired: true,
      enumValues: ['private', 'public', 'internal'],
      multiple: false,
    },
    {
      path: 'providers.github.description',
      type: 'string',
      required: false,
      description: 'The purpose of this repo',
      multiple: false,
    },
    {
      path: 'providers.github.features.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.github.features (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.github.vars.actions.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.github.vars.actions (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.github.secrets.actions.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.github.secrets.actions (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.github.secrets.codespaces.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.github.secrets.codespaces (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.github.secrets.dependabot.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.github.secrets.dependabot (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.github.topics',
      type: 'string',
      required: false,
      multiple: true,
    },
    {
      path: 'providers.github.labels.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providers.github.labels (escape hatch for complex arrays)',
      multiple: false,
    },
    {
      path: 'providers.github.overrides.json',
      type: 'string',
      required: false,
      description: 'Raw JSON object for providers.github.overrides',
      multiple: false,
    },
    {
      path: 'profile.displayName',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'profile.email',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'profile.picture',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'annotations.json',
      type: 'string',
      required: false,
      description: 'Raw JSON object for annotations',
      multiple: false,
    },
    {
      path: 'system',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'owner',
      type: 'string',
      required: true,
      multiple: false,
    },
    {
      path: 'maintainedBy',
      type: 'string',
      required: false,
      multiple: true,
    },
    {
      path: 'platformOwner',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'subComponentOf',
      type: 'string',
      required: false,
      multiple: false,
    },
    {
      path: 'providesApis.json',
      type: 'string',
      required: false,
      description:
        'Raw JSON value for providesApis (escape hatch for union types)',
      multiple: false,
    },
    {
      path: 'consumesApis',
      type: 'string',
      required: false,
      multiple: true,
    },
  ] as unknown as FlagSpec[];

  static summary =
    'Describe a software component and the repository that hosts it.';

  static description = 'Create a new ComponentClaim.';

  static flags = {
    ...runtimeFlags(CreateComponent.FLAG_SPECS),
    feature: Flags.string({
      description:
        'Attach a Feature reference offline; validates claim shape only',
      multiple: true,
    }),
    org: MUTATION_CONTROL_FLAGS.org,
    commit: MUTATION_CONTROL_FLAGS.commit,
    'wait-for-checks': MUTATION_CONTROL_FLAGS['wait-for-checks'],
    'state-repos': MUTATION_CONTROL_FLAGS['state-repos'],
    path: Flags.string({
      description: 'Destination path for TFWorkspaceClaim or SecretsClaim',
    }),
  };

  static examples = [
    '<%= config.bin %> <%= command.id %> --name example --owner group:platform',
  ];

  async run(): Promise<void> {
    const { flags } = await this.parse(CreateComponent);

    assertCreatePath('ComponentClaim', flags.commit, flags.path);

    let claim: Record<string, unknown> = {
      kind: 'ComponentClaim',
      ...buildClaimFromFlags(
        flags as Record<string, unknown>,
        CreateComponent.FLAG_SPECS,
        ['providers'],
      ),
    };
    for (const value of flags.feature ?? []) {
      claim = mutateFeatureReference(
        claim,
        'add',
        parseFeatureReference(value),
      );
    }
    setSchemasDir(join(this.config.root, 'schemas'));
    const result = await validateClaim(claim, 'ComponentClaim');
    if (!result.valid) {
      this.error(result.errors.join('\n'));
    }
    await runClaimCreation({
      org: flags.org,
      kind: 'ComponentClaim',
      name: flags.name,
      claim,
      commit: flags.commit,
      waitForChecks: flags['wait-for-checks'],
      stateRepos: flags['state-repos'],
      path: flags.path,
      writeOutput: (output) => this.log(output),
      writeDiagnostic: (output) => process.stderr.write(output),
    });
  }
}
