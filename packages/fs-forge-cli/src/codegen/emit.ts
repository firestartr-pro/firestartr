import type { FlagSpec } from '../utils/deriveFlags.js';

import type { ClaimCommandModel } from './model.js';

function flagSpecToSource(f: FlagSpec): string {
  const entries: string[] = [];
  entries.push(`path: '${f.path}'`);
  entries.push(`type: '${f.type}'`);
  entries.push(`required: ${f.required}`);
  if (f.conditionalRequired) entries.push('conditionalRequired: true');
  if (f.description)
    entries.push(`description: '${f.description.replace(/'/g, "\\'")}'`);
  if (f.enumValues && f.enumValues.length > 0) {
    entries.push(
      `enumValues: [${f.enumValues.map((v) => `'${v}'`).join(', ')}]`,
    );
  }
  if (f.defaultValue !== undefined) {
    const def =
      typeof f.defaultValue === 'string'
        ? `'${f.defaultValue}'`
        : String(f.defaultValue);
    entries.push(`defaultValue: ${def}`);
  }
  if (f.conditionalDefault) entries.push('conditionalDefault: true');
  entries.push(`multiple: ${f.multiple}`);
  if (f.integer) entries.push('integer: true');
  if (f.char) entries.push(`char: '${f.char}'`);
  const inner = entries.join(',\n    ');
  return `  {\n    ${inner},\n  }`;
}

function exampleValue(flag: FlagSpec, kind: string): string {
  if (flag.path === 'kind') return kind;
  if (flag.path === 'owner') return 'group:platform';
  if (flag.path.endsWith('.secretRef')) {
    return 'ref:secretsclaim:webhook:secret';
  }
  if (flag.enumValues?.[0]) return flag.enumValues[0];
  if (flag.path.endsWith('.json')) {
    return flag.path.endsWith('.providers.json') ? '"[]"' : '"{}"';
  }
  if (flag.path.endsWith('.url')) return 'https://example.com';
  if (flag.path.endsWith('.source')) return 'remote';
  return flag.type === 'number' ? '1' : 'example';
}

function exampleFlags(kind: string, flags: FlagSpec[]): string {
  const required = flags
    .filter((flag) => flag.required && flag.defaultValue === undefined)
    .map((flag) =>
      flag.type === 'boolean'
        ? `--${flag.path}`
        : `--${flag.path} ${exampleValue(flag, kind)}`,
    );
  if (kind === 'SecretsClaim') {
    required.push(
      '--providers.external_secrets.json "{\\"name\\":\\"example\\",\\"secretStore\\":{\\"name\\":\\"example\\"},\\"externalSecrets\\":{}}"',
    );
  }
  return required.join(' ');
}

export function emitCreateCommand(model: ClaimCommandModel): string {
  const { kind, summary, flagSpecs } = model;
  const kindName = kind.replace(/Claim$/, '');
  const commandFlags = flagSpecs.filter((flag) => flag.path !== 'kind');
  const requiredFlags = exampleFlags(kind, commandFlags);
  const hasFeatureReferences = commandFlags.some(
    (flag) => flag.path === 'providers.github.features.json',
  );
  const specsSource = commandFlags.map(flagSpecToSource).join(',\n');

  return `import { Command, Flags } from '@oclif/core';
import { join } from 'path';

import { assertCreatePath } from '../../claims/deterministicPath.js';
import { runClaimCreation } from '../../mutations/creation.js';
import { MUTATION_CONTROL_FLAGS } from '../../mutations/support.js';
import { setSchemasDir, validateClaim } from '../../utils/ajvValidation.js';
import { buildClaimFromFlags } from '../../utils/buildClaim.js';
${hasFeatureReferences ? "import { mutateFeatureReference, parseFeatureReference } from '../../utils/features.js';\n" : ''}import { runtimeFlags } from '../../utils/runtimeFlags.js';
import type { FlagSpec } from '../../utils/deriveFlags.js';

export default class Create${kindName} extends Command {
  static FLAG_SPECS = [
${specsSource},
  ] as unknown as FlagSpec[];

  static summary = ${JSON.stringify(summary)};

  static description = ${JSON.stringify(`Create a new ${kind}.`)};

  static flags = {
    ...runtimeFlags(Create${kindName}.FLAG_SPECS),
${hasFeatureReferences ? "  feature: Flags.string({ description: 'Attach a Feature reference offline; validates claim shape only', multiple: true })," : ''}
    org: MUTATION_CONTROL_FLAGS.org,
    commit: MUTATION_CONTROL_FLAGS.commit,
    'wait-for-checks': MUTATION_CONTROL_FLAGS['wait-for-checks'],
    'state-repos': MUTATION_CONTROL_FLAGS['state-repos'],
    path: Flags.string({ description: 'Destination path for TFWorkspaceClaim or SecretsClaim' }),
  };

  static examples = [
    ${JSON.stringify(`<%= config.bin %> <%= command.id %> ${requiredFlags}`)},
  ];

  async run(): Promise<void> {
    const { flags } = await this.parse(Create${kindName});

    assertCreatePath('${kind}', flags.commit, flags.path);

    ${hasFeatureReferences ? 'let claim: Record<string, unknown>' : 'const claim'} = {
      kind: '${kind}',
      ...buildClaimFromFlags(
        flags as Record<string, unknown>,
        Create${kindName}.FLAG_SPECS,
        ${JSON.stringify(model.requiredContainers)},
      ),
    };
${hasFeatureReferences ? "    for (const value of flags.feature ?? []) {\n      claim = mutateFeatureReference(claim, 'add', parseFeatureReference(value));\n    }\n" : ''}    setSchemasDir(join(this.config.root, 'schemas'));
    const result = await validateClaim(claim, '${kind}');
    if (!result.valid) {
      this.error(result.errors.join('\\n'));
    }
    await runClaimCreation({
      org: flags.org,
      kind: '${kind}',
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
`;
}

export function emitKindsCommand(models: ClaimCommandModel[]): string {
  return `import { Command, Flags } from '@oclif/core';

import { KIND_CAPABILITIES } from '../claims/kindRegistry.js';

function writeLine(value: string): void {
  process.stdout.write(value + '\\n');
}

export default class Kinds extends Command {
  static description = 'List supported claim kinds';

  static flags = {
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Kinds);

    if (flags.json) {
      writeLine(
        JSON.stringify(
          KIND_CAPABILITIES.map(({ id, kind, summary }) => ({
            id,
            kind,
            description: summary,
          })),
          null,
          2,
        ),
      );
      return;
    }

    const idW = Math.max(...KIND_CAPABILITIES.map((k) => k.id.length), 2);
    const kindW = Math.max(...KIND_CAPABILITIES.map((k) => k.kind.length), 4);
    writeLine('ID'.padEnd(idW) + '  ' + 'KIND'.padEnd(kindW) + '  DESCRIPTION');
    for (const kind of KIND_CAPABILITIES) {
      writeLine(
        \`\${kind.id.padEnd(idW)}  \${kind.kind.padEnd(kindW)}  \${kind.summary}\`,
      );
    }
  }
}
`;
}

export function emitKindMetadata(models: ClaimCommandModel[]): string {
  const entries = models
    .map(
      (model) =>
        `  ${model.kind}: { id: '${model.id}', icon: { emoji: '${model.icon.emoji}', ascii: '${model.icon.ascii}' }, summary: ${JSON.stringify(model.summary)} },`,
    )
    .join('\n');
  return `// Generated by src/codegen/generateCommands.ts. Do not edit.\nexport const CLAIM_KINDS = {\n${entries}\n} as const;\n\nexport type ClaimKindName = keyof typeof CLAIM_KINDS;\n`;
}
