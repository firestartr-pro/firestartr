import type { ErrorObject } from 'ajv';
import YAML, { YAMLMap, YAMLSeq } from 'yaml';
import type { Document } from 'yaml';

import { loadActionsValidator } from '../../schema/actionsSchemas.js';
import { formatAjvErrors } from '../../utils/ajvValidation.js';
import { isRecord } from '../../utils/isRecord.js';

import { preserveEol, resolveServiceNames } from './shared.js';
import type { RenderedFile } from './types.js';
import type { AppInputs, AppTrack } from '../../schema/appInputs.js';

const MAKE_DISPATCHES_PATH = '.github/make_dispatches.yaml';

export interface RenderMakeDispatchesOptions {
  org: string;
  inputs: AppInputs;
  defaultBranch: string;
  actionsSchemasDir: string;
  existingContent?: string;
}

interface DispatchEntry {
  application: string;
  platform: string;
  tenant: string;
  env: string;
  type: 'snapshots' | 'releases';
  version: string;
  flavor: string;
  service_names: string[];
}

function trackToDispatch(
  track: AppTrack,
  defaultBranch: string,
): { type: 'snapshots' | 'releases'; version: string } {
  switch (track) {
    case 'snapshots':
      return { type: 'snapshots', version: `$branch_${defaultBranch}` };
    case 'pre-releases':
      return { type: 'snapshots', version: '$latest_prerelease' };
    case 'releases':
      return { type: 'releases', version: '$latest_release' };
  }
}

function deploymentLabel(data: unknown, index: number): string {
  if (isRecord(data) && Array.isArray(data.deployments)) {
    const entry = data.deployments[index];
    if (
      isRecord(entry) &&
      typeof entry.application === 'string' &&
      entry.application.length > 0
    ) {
      return `deployments[${index}] (application ${entry.application})`;
    }
  }
  return `deployments[${index}]`;
}

function formatExistingAjvError(data: unknown, err: ErrorObject): string {
  const extra =
    err.keyword === 'additionalProperties' &&
    typeof err.params?.additionalProperty === 'string'
      ? ` (${err.params.additionalProperty})`
      : '';
  const message = `${err.message ?? 'is invalid'}${extra}`.trim();
  const match = /^\/deployments\/(\d+)(\/.*)?$/.exec(err.instancePath);
  if (match) {
    const index = Number(match[1]);
    const rest = match[2] ? match[2].replace(/\//g, '.') : '';
    const label = deploymentLabel(data, index);
    return rest ? `${label}${rest}: ${message}` : `${label}: ${message}`;
  }
  const loc = err.instancePath || '/';
  return `${loc}: ${message}`;
}

function validateExistingMakeDispatchesErrors(
  data: unknown,
  actionsSchemasDir: string,
): string[] | undefined {
  const validate = loadActionsValidator('make_dispatches', actionsSchemasDir);
  const errors: string[] = [];
  if (!validate(data)) {
    for (const err of validate.errors ?? []) {
      errors.push(formatExistingAjvError(data, err));
    }
  }

  if (isRecord(data) && Array.isArray(data.deployments)) {
    data.deployments.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const hasServiceNames = entry.service_names !== undefined;
      const hasImageKeys = entry.image_keys !== undefined;
      if (hasServiceNames === hasImageKeys) {
        errors.push(
          `${deploymentLabel(data, index)}: must define exactly one of service_names or image_keys`,
        );
      }
    });
  }

  return errors.length > 0 ? errors : undefined;
}

function validateMakeDispatchesErrors(
  data: unknown,
  actionsSchemasDir: string,
): string[] | undefined {
  const validate = loadActionsValidator('make_dispatches', actionsSchemasDir);
  const errors: string[] = [];
  if (!validate(data)) {
    errors.push(...formatAjvErrors(validate.errors));
  }

  if (isRecord(data) && Array.isArray(data.deployments)) {
    data.deployments.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const hasServiceNames = entry.service_names !== undefined;
      const hasImageKeys = entry.image_keys !== undefined;
      if (hasServiceNames === hasImageKeys) {
        errors.push(
          `/deployments/${index} must define exactly one of service_names or image_keys`,
        );
      }
    });
  }

  return errors.length > 0 ? errors : undefined;
}

function entryIdentityKey(entry: {
  application: unknown;
  platform: unknown;
  tenant: unknown;
  env: unknown;
  flavor: unknown;
}): string {
  return [
    String(entry.application ?? ''),
    String(entry.platform ?? ''),
    String(entry.tenant ?? ''),
    String(entry.env ?? ''),
    String(entry.flavor ?? ''),
  ].join('/');
}

/**
 * Renders a document the way `yamllint -d default` expects it: an explicit
 * document start and block collections only. The `yaml` package keeps the flow
 * flag of a collection that came from the base file (`deployments: []`) and
 * hands it down to the nodes added to it, so a merge would otherwise render
 * `deployments: [ { ... } ]` and fail the linter.
 */
function toStringBlock(doc: Document.Parsed): string {
  doc.directives.docStart = true;
  return doc.toString();
}

export function renderMakeDispatches(
  options: RenderMakeDispatchesOptions,
): RenderedFile {
  const { org, inputs, defaultBranch, actionsSchemasDir, existingContent } =
    options;
  const path = MAKE_DISPATCHES_PATH;
  const desiredServiceNames = resolveServiceNames(inputs.service, org);

  const desiredEntries: DispatchEntry[] = inputs.targets.map((target) => {
    const { type, version } = trackToDispatch(target.track, defaultBranch);
    return {
      application: inputs.app,
      platform: target.platform,
      tenant: target.tenant,
      env: target.env,
      type,
      version,
      flavor: target.flavor ?? 'default',
      service_names: [...desiredServiceNames],
    };
  });

  if (existingContent === undefined) {
    const obj = { deployments: desiredEntries };
    const errors = validateMakeDispatchesErrors(obj, actionsSchemasDir);
    if (errors) {
      return {
        path,
        outcome: {
          kind: 'conflict',
          reason: `Rendered ${path} failed schema validation: ${errors.join('; ')}`,
        },
      };
    }
    return {
      path,
      content: `---\n${YAML.stringify(obj)}`,
      outcome: { kind: 'create' },
    };
  }

  const doc = YAML.parseDocument(existingContent);
  if (doc.errors.length > 0) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Malformed YAML in ${path}: ${doc.errors[0].message}`,
      },
    };
  }

  const parsed: unknown = doc.toJS();
  if (!isRecord(parsed)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected YAML mapping in ${path}`,
      },
    };
  }

  const existingErrors = validateExistingMakeDispatchesErrors(
    parsed,
    actionsSchemasDir,
  );
  if (existingErrors) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Existing ${path} is invalid and must be fixed first: ${existingErrors.join('; ')}`,
      },
    };
  }

  let deploymentsNode = doc.get('deployments', true);
  if (doc.has('deployments') && !(deploymentsNode instanceof YAMLSeq)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected "deployments" to be a YAML sequence in ${path}`,
      },
    };
  }
  if (!(deploymentsNode instanceof YAMLSeq)) {
    deploymentsNode = doc.createNode([]);
    doc.set('deployments', deploymentsNode);
  }
  const deploymentsSeq = deploymentsNode as YAMLSeq;
  deploymentsSeq.flow = false;

  const added: string[] = [];
  const notes: string[] = [];

  for (const desired of desiredEntries) {
    const targetKey = entryIdentityKey(desired);
    let existingEntry: YAMLMap | undefined;
    for (const item of deploymentsSeq.items) {
      if (!(item instanceof YAMLMap)) continue;
      const itemKey = entryIdentityKey({
        application: item.get('application'),
        platform: item.get('platform'),
        tenant: item.get('tenant'),
        env: item.get('env'),
        flavor: item.get('flavor'),
      });
      if (itemKey === targetKey) {
        existingEntry = item;
        break;
      }
    }

    if (!existingEntry) {
      const entryNode = doc.createNode(desired);
      if (entryNode instanceof YAMLMap) entryNode.flow = false;
      deploymentsSeq.add(entryNode);
      added.push(`deployment:${targetKey}`);
      continue;
    }

    const existingType = existingEntry.get('type');
    if (existingType !== desired.type) {
      return {
        path,
        outcome: {
          kind: 'conflict',
          reason: `Deployment ${targetKey} has type "${String(existingType ?? '')}", expected "${desired.type}"`,
        },
      };
    }

    const existingVersion = existingEntry.get('version');
    if (existingVersion !== desired.version) {
      notes.push(
        `Info: deployment ${targetKey} keeps existing version "${String(existingVersion ?? '')}" (rendered "${desired.version}").`,
      );
    }

    if (existingEntry.has('image_keys')) {
      notes.push(
        `Info: deployment ${targetKey} uses image_keys; left unchanged.`,
      );
      continue;
    }

    const rawNames = existingEntry.get('service_names', true);
    if (existingEntry.has('service_names') && !(rawNames instanceof YAMLSeq)) {
      return {
        path,
        outcome: {
          kind: 'conflict',
          reason: `Expected "service_names" to be a YAML sequence for deployment ${targetKey} in ${path}`,
        },
      };
    }

    let namesSeq: YAMLSeq;
    if (rawNames instanceof YAMLSeq) {
      namesSeq = rawNames;
    } else {
      namesSeq = doc.createNode([]);
      existingEntry.set('service_names', namesSeq);
    }
    namesSeq.flow = false;

    const existingNames = new Set(
      namesSeq.items.map((item) =>
        isRecord(item) && 'value' in item ? String(item.value) : String(item),
      ),
    );
    for (const name of desired.service_names) {
      if (!existingNames.has(name)) {
        namesSeq.add(doc.createNode(name));
        added.push(`service_name:${targetKey}:${name}`);
      }
    }
  }

  if (added.length === 0) {
    return {
      path,
      content: existingContent,
      outcome: { kind: 'noop' },
      ...(notes.length > 0 ? { notes } : {}),
    };
  }

  const validationErrors = validateMakeDispatchesErrors(
    doc.toJS(),
    actionsSchemasDir,
  );
  if (validationErrors) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Merged ${path} failed schema validation: ${validationErrors.join('; ')}`,
      },
    };
  }

  return {
    path,
    content: preserveEol(toStringBlock(doc), existingContent),
    outcome: { kind: 'merge', added },
    ...(notes.length > 0 ? { notes } : {}),
  };
}
