import YAML, { YAMLMap, YAMLSeq } from 'yaml';

import { loadDotFirestartrValidator } from '../../schema/dotFirestartrSchemas.js';
import { formatAjvErrors } from '../../utils/ajvValidation.js';
import { isRecord } from '../../utils/isRecord.js';
import { parseRepoSlug } from '../dotFirestartr.js';

import type { RenderedFile } from './types.js';
import type { AppInputs } from '../../schema/appInputs.js';

export interface RenderDotFirestartrOptions {
  org: string;
  inputs: AppInputs;
  schemasDir: string;
  existingContent?: string;
}

function validateAppsDocErrors(
  data: unknown,
  schemasDir: string,
): string[] | undefined {
  const validate = loadDotFirestartrValidator('apps', schemasDir);
  if (!validate(data)) {
    return formatAjvErrors(validate.errors);
  }
  return undefined;
}

function validateAppsDoc(data: unknown, schemasDir: string): void {
  const errors = validateAppsDocErrors(data, schemasDir);
  if (errors) {
    throw new Error(
      `Rendered apps.yaml failed schema validation: ${errors.join('; ')}`,
    );
  }
}

function preserveEol(rendered: string, existingContent: string): string {
  if (existingContent.includes('\r\n')) {
    return rendered.replace(/\r?\n/g, '\r\n');
  }
  return rendered;
}

export function renderDotFirestartrApp(
  options: RenderDotFirestartrOptions,
): RenderedFile {
  const { org, inputs, schemasDir, existingContent } = options;
  const path = `apps/${inputs.app}.yaml`;
  const expectedStateRepo = `${org}/app-${inputs.app}`;
  const { owner: serviceOwner, name: serviceRepoName } = parseRepoSlug(
    inputs.service.repo,
    org,
  );
  const serviceRepoSlug = `${serviceOwner}/${serviceRepoName}`;
  const desiredServiceNames =
    inputs.service.service_names && inputs.service.service_names.length > 0
      ? inputs.service.service_names
      : [serviceRepoName];

  if (existingContent === undefined) {
    const obj = {
      name: inputs.app,
      state_repo: expectedStateRepo,
      services: [
        {
          repo: serviceRepoSlug,
          service_names: desiredServiceNames,
        },
      ],
    };
    validateAppsDoc(obj, schemasDir);
    return {
      path,
      content: YAML.stringify(obj),
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

  if (parsed.state_repo !== expectedStateRepo) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `state_repo is "${String(parsed.state_repo ?? '')}", expected "${expectedStateRepo}"`,
      },
    };
  }

  let servicesNode = doc.get('services', true);
  if (doc.has('services') && !(servicesNode instanceof YAMLSeq)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected "services" to be a YAML sequence in ${path}`,
      },
    };
  }
  if (!(servicesNode instanceof YAMLSeq)) {
    servicesNode = doc.createNode([]);
    doc.set('services', servicesNode);
  }

  const seq = servicesNode as YAMLSeq;
  let matchingService: YAMLMap | undefined;
  for (const item of seq.items) {
    if (item instanceof YAMLMap && item.get('repo') === serviceRepoSlug) {
      matchingService = item;
      break;
    }
  }

  const added: string[] = [];
  if (matchingService) {
    const rawNames: unknown = matchingService.get('service_names', true);
    if (
      matchingService.has('service_names') &&
      !(rawNames instanceof YAMLSeq)
    ) {
      return {
        path,
        outcome: {
          kind: 'conflict',
          reason: `Expected "service_names" to be a YAML sequence for "${serviceRepoSlug}" in ${path}`,
        },
      };
    }
    let namesSeq: YAMLSeq;
    if (rawNames instanceof YAMLSeq) {
      namesSeq = rawNames;
    } else {
      namesSeq = doc.createNode([]);
      matchingService.set('service_names', namesSeq);
    }
    const existingNames = new Set(
      namesSeq.items.map((item) =>
        isRecord(item) && 'value' in item ? String(item.value) : String(item),
      ),
    );
    for (const name of desiredServiceNames) {
      if (!existingNames.has(name)) {
        namesSeq.add(doc.createNode(name));
        added.push(`service_name:${name}`);
      }
    }
  } else {
    seq.add(
      doc.createNode({
        repo: serviceRepoSlug,
        service_names: desiredServiceNames,
      }),
    );
    added.push(`service:${serviceRepoSlug}`);
  }

  if (added.length === 0) {
    return {
      path,
      content: existingContent,
      outcome: { kind: 'noop' },
    };
  }

  const validationErrors = validateAppsDocErrors(doc.toJS(), schemasDir);
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
    content: preserveEol(doc.toString(), existingContent),
    outcome: { kind: 'merge', added },
  };
}
