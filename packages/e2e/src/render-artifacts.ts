import fs from 'node:fs/promises';
import common from 'catalog_common';
import { getFirestartrAnnotation } from './claim-taxonomy';
import { readK8sResource } from './cr-finder';

// Rendered-manifest verbs shared by the e2e suites: selecting a rendered CR by
// kind and forcing the operator to reconcile one.

/**
 * Returns every rendered CR path whose kind matches.
 *
 * @throws when the rendered output contains none of `kind`.
 */
export async function pickRenderedCrs(
  crPaths: string[],
  kind: string,
): Promise<string[]> {
  const matches: string[] = [];

  for (const crPath of crPaths) {
    const resource = await readK8sResource(crPath);
    if (resource.kind === kind) {
      matches.push(crPath);
    }
  }

  if (matches.length === 0) {
    throw new Error(`Expected rendered output to include a ${kind} CR`);
  }

  return matches;
}

/**
 * Returns the first rendered CR path whose kind matches, in render order.
 *
 * @throws when the rendered output contains none of `kind`.
 */
export async function pickRenderedCr(
  crPaths: string[],
  kind: string,
): Promise<string> {
  const [match] = await pickRenderedCrs(crPaths, kind);
  return match;
}

/**
 * Force-reconcile: stamps the firestartr.dev/reconcile-at annotation so the
 * operator re-provisions a CR whose spec is unchanged.
 */
export async function setReconcileAt(crPath: string): Promise<void> {
  const content = await fs.readFile(crPath, 'utf-8');
  const resource = common.io.fromYaml(content) as {
    metadata?: {
      annotations?: Record<string, string>;
    };
  };
  resource.metadata = resource.metadata ?? {};
  resource.metadata.annotations = {
    ...(resource.metadata.annotations ?? {}),
    [getFirestartrAnnotation('reconcileAt')]: new Date().toISOString(),
  };
  await fs.writeFile(crPath, common.io.toYaml(resource), 'utf-8');
}
