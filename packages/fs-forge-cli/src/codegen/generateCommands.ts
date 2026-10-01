import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { format } from 'prettier';
import {
  deriveFlags,
  deriveRequiredContainers,
  FlagSpec,
} from '../utils/deriveFlags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..', '..');

interface ClaimIcon {
  emoji: string;
  ascii: string;
}

function claimSummary(schema: Record<string, unknown>, kind: string): string {
  const value = schema['x-fs-forge-summary'];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${kind} schema is missing x-fs-forge-summary metadata`);
  }
  return value;
}

function claimIcon(schema: Record<string, unknown>, kind: string): ClaimIcon {
  const value = schema['x-fs-forge-icon'];
  if (
    typeof value !== 'object' ||
    value === null ||
    !('emoji' in value) ||
    typeof value.emoji !== 'string' ||
    !('ascii' in value) ||
    typeof value.ascii !== 'string'
  ) {
    throw new Error(`${kind} schema is missing x-fs-forge-icon metadata`);
  }
  return { emoji: value.emoji, ascii: value.ascii };
}

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

function generateCommandSource(
  kind: string,
  summary: string,
  flags: FlagSpec[],
  requiredContainers: string[],
): string {
  const kindName = kind.replace(/Claim$/, '');
  const commandFlags = flags.filter((flag) => flag.path !== 'kind');
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
        ${JSON.stringify(requiredContainers)},
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

function generateKindsCommandSource(
  claimKinds: string[],
  claimSummaries: Record<string, string>,
): string {
  const kinds = claimKinds
    .map((kind) => {
      const name = kind.replace(/Claim$/, '');
      return `  { id: '${name.toLowerCase()}', kind: '${kind}', description: ${JSON.stringify(claimSummaries[kind])} }`;
    })
    .join(',\n');

  return `import { Command, Flags } from '@oclif/core';

export const CLAIM_KINDS = [
${kinds},
];

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
      writeLine(JSON.stringify(CLAIM_KINDS, null, 2));
    } else {
      const idW = Math.max(...CLAIM_KINDS.map((k) => k.id.length), 2);
      const kindW = Math.max(...CLAIM_KINDS.map((k) => k.kind.length), 4);
      writeLine(
        'ID'.padEnd(idW) + '  ' + 'KIND'.padEnd(kindW) + '  DESCRIPTION',
      );
      for (const kind of CLAIM_KINDS) {
        writeLine(
          \`\${kind.id.padEnd(idW)}  \${kind.kind.padEnd(kindW)}  \${kind.description}\`,
        );
      }
    }
  }
}
`;
}

function generateClaimKindsSource(
  claimKinds: string[],
  claimIcons: Record<string, ClaimIcon>,
): string {
  const entries = claimKinds.map((kind) => {
    const icons = claimIcons[kind];
    return `  ${kind}: { emoji: '${icons.emoji}', ascii: '${icons.ascii}' },`;
  });
  return `// Generated by src/codegen/generateCommands.ts. Do not edit.\nexport const CLAIM_KINDS = {\n${entries.join('\n')}\n} as const;\n\nexport type ClaimKindName = keyof typeof CLAIM_KINDS;\n`;
}

async function generateAllCommands(): Promise<void> {
  const commandsDir = join(PKG_ROOT, 'src', 'commands', 'create');
  await mkdir(commandsDir, { recursive: true });
  const claimKinds = (await readdir(join(PKG_ROOT, 'schemas')))
    .filter((file) => file.endsWith('Claim.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
  const claimIcons: Record<string, ClaimIcon> = {};
  const claimSummaries: Record<string, string> = {};

  for (const kind of claimKinds) {
    const schemaPath = join(PKG_ROOT, 'schemas', `${kind}.json`);
    let schema: Record<string, unknown>;
    try {
      const content = await readFile(schemaPath, 'utf8');
      schema = JSON.parse(content) as Record<string, unknown>;
    } catch {
      console.warn(`Schema not found for ${kind}, skipping.`);
      continue;
    }

    claimIcons[kind] = claimIcon(schema, kind);
    claimSummaries[kind] = claimSummary(schema, kind);
    const flags = deriveFlags(schema);
    const source = generateCommandSource(
      kind,
      claimSummaries[kind],
      flags,
      deriveRequiredContainers(schema),
    );
    const kindLower = kind.replace(/Claim$/, '').toLowerCase();
    const outPath = join(commandsDir, `${kindLower}.ts`);
    await writeFile(
      outPath,
      await format(source, { parser: 'typescript', singleQuote: true }),
      'utf8',
    );
    console.log(`Generated: ${outPath} (${flags.length} flags)`);
  }

  const kindsCmdPath = join(PKG_ROOT, 'src', 'commands', 'kinds.ts');
  await writeFile(
    kindsCmdPath,
    await format(generateKindsCommandSource(claimKinds, claimSummaries), {
      parser: 'typescript',
      singleQuote: true,
    }),
    'utf8',
  );
  console.log(`Generated: ${kindsCmdPath}`);

  const claimKindsPath = join(PKG_ROOT, 'src', 'claims', 'kinds.ts');
  await writeFile(
    claimKindsPath,
    await format(generateClaimKindsSource(claimKinds, claimIcons), {
      parser: 'typescript',
      singleQuote: true,
    }),
    'utf8',
  );
  console.log(`Generated: ${claimKindsPath}`);
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  generateAllCommands().catch((err) => {
    console.error('Command generation failed:', err);
    process.exit(1);
  });
}

export { generateAllCommands };
