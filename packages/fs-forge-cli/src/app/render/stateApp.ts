import YAML from 'yaml';

import { loadDotFirestartrValidator } from '../../schema/dotFirestartrSchemas.js';
import { formatAjvErrors } from '../../utils/ajvValidation.js';
import { isRecord } from '../../utils/isRecord.js';

import type { RenderedFile } from './types.js';
import type { AppInputs, AppTargetInput } from '../../schema/appInputs.js';
import type { DiscoveredRegistry } from '../dotFirestartr.js';

export interface RenderStateAppOptions {
  inputs: AppInputs;
  registries: DiscoveredRegistry[];
  schemasDir: string;
  existingFiles?: Record<string, string>;
}

function resolveChartReference(
  inputs: AppInputs,
  registries: DiscoveredRegistry[],
): string {
  const registry = registries.find((r) => r.name === inputs.chart.registry);
  if (!registry) {
    throw new Error(
      `Registry alias "${inputs.chart.registry}" not found in discovered registries`,
    );
  }
  const chartsBasePath =
    !Array.isArray(registry.base_paths) &&
    typeof registry.base_paths.charts === 'string'
      ? registry.base_paths.charts.replace(/^\/+|\/+$/g, '')
      : '';
  if (!chartsBasePath) {
    throw new Error(
      `Registry "${registry.name}" has no base_paths.charts configured`,
    );
  }
  return `${registry.name}/${chartsBasePath}/${inputs.chart.name}`;
}

function validateStateAppEnvErrors(
  data: unknown,
  schemasDir: string,
): string[] | undefined {
  const validate = loadDotFirestartrValidator('state_apps_env', schemasDir);
  if (!validate(data)) {
    return formatAjvErrors(validate.errors);
  }
  return undefined;
}

function validateStateAppEnv(data: unknown, schemasDir: string): void {
  const errors = validateStateAppEnvErrors(data, schemasDir);
  if (errors) {
    throw new Error(
      `Rendered state_apps_env failed schema validation: ${errors.join('; ')}`,
    );
  }
}

function renderTargetEnvFile(
  inputs: AppInputs,
  target: AppTargetInput,
  expectedChart: string,
  schemasDir: string,
  existingContent: string | undefined,
): RenderedFile {
  const path = `kubernetes/${target.platform}/${target.tenant}/${target.env}.yaml`;
  const expectedNamespace = `${target.tenant}-${inputs.app}-${target.env}`;

  if (existingContent === undefined) {
    const obj = {
      version: inputs.chart.version,
      chart: expectedChart,
      releaseName: inputs.app,
      hooks: [],
      extraPatches: [],
      remoteArtifacts: [],
      execs: [],
    };
    validateStateAppEnv(obj, schemasDir);
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
      outcome: { kind: 'conflict', reason: `Expected YAML mapping in ${path}` },
    };
  }

  if (parsed.chart !== expectedChart) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `chart is "${String(parsed.chart ?? '')}", expected "${expectedChart}"`,
      },
    };
  }

  if (parsed.version !== inputs.chart.version) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `version is "${String(parsed.version ?? '')}", expected "${inputs.chart.version}"`,
      },
    };
  }

  if (parsed.releaseName !== undefined && parsed.releaseName !== inputs.app) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `releaseName is "${String(parsed.releaseName)}", expected "${inputs.app}"`,
      },
    };
  }

  if (
    parsed.namespace !== undefined &&
    parsed.namespace !== expectedNamespace
  ) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `namespace is "${String(parsed.namespace)}", expected "${expectedNamespace}"`,
      },
    };
  }

  const existingErrors = validateStateAppEnvErrors(parsed, schemasDir);
  if (existingErrors) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Existing ${path} failed schema validation: ${existingErrors.join('; ')}`,
      },
    };
  }

  return {
    path,
    content: existingContent,
    outcome: { kind: 'noop' },
  };
}

export function renderStateAppTargets(
  options: RenderStateAppOptions,
): RenderedFile[] {
  const { inputs, registries, schemasDir, existingFiles = {} } = options;
  const expectedChart = resolveChartReference(inputs, registries);
  const envPathCounts = new Map<string, number>();
  for (const target of inputs.targets) {
    const envPath = `kubernetes/${target.platform}/${target.tenant}/${target.env}.yaml`;
    envPathCounts.set(envPath, (envPathCounts.get(envPath) ?? 0) + 1);
  }

  const rendered: RenderedFile[] = [];
  const emittedEnvPaths = new Set<string>();

  for (const target of inputs.targets) {
    const envPath = `kubernetes/${target.platform}/${target.tenant}/${target.env}.yaml`;
    if (emittedEnvPaths.has(envPath)) {
      continue;
    }
    emittedEnvPaths.add(envPath);

    if ((envPathCounts.get(envPath) ?? 0) > 1) {
      rendered.push({
        path: envPath,
        outcome: {
          kind: 'conflict',
          reason: `Duplicate target env file path "${envPath}" in inputs`,
        },
      });
      continue;
    }

    rendered.push(
      renderTargetEnvFile(
        inputs,
        target,
        expectedChart,
        schemasDir,
        existingFiles[envPath],
      ),
    );

    const valuesPath = `kubernetes/${target.platform}/${target.tenant}/${target.env}/values.yaml`;
    const existingValues = existingFiles[valuesPath];
    if (existingValues === undefined) {
      rendered.push({
        path: valuesPath,
        content: '',
        outcome: { kind: 'create' },
      });
    } else {
      rendered.push({
        path: valuesPath,
        content: existingValues,
        outcome: { kind: 'noop' },
      });
    }
  }

  return rendered;
}
