import { parseRepoSlug } from '../dotFirestartr.js';

import type { AppServiceInput } from '../../schema/appInputs.js';

export function resolveServiceNames(
  service: AppServiceInput,
  org: string,
): string[] {
  if (service.service_names && service.service_names.length > 0) {
    return [...service.service_names];
  }
  const { name } = parseRepoSlug(service.repo, org);
  return [name];
}

export function preserveEol(rendered: string, existingContent: string): string {
  if (existingContent.includes('\r\n') && !/(?<!\r)\n/.test(existingContent)) {
    return rendered.replace(/\r?\n/g, '\r\n');
  }
  return rendered;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractFeatureMajor(
  feature: { ref?: unknown; version?: unknown },
  featureName: string,
): number | undefined {
  if (typeof feature.ref === 'string') {
    const namedMatch = new RegExp(
      `^${escapeRegExp(featureName)}-v(\\d+)(?:\\.\\d+)*$`,
    ).exec(feature.ref);
    if (namedMatch) return Number(namedMatch[1]);
    const semverMatch = /^v?(\d+)(?:\.\d+)*$/.exec(feature.ref);
    if (semverMatch) return Number(semverMatch[1]);
  }
  if (typeof feature.version === 'string') {
    const match = /^v?(\d+)(?:\.\d+)*$/.exec(feature.version);
    if (match) return Number(match[1]);
  }
  return undefined;
}
