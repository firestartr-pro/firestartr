import { resolveCrHandle } from './cr-handle';
import { getPrimaryManifestResource } from './manifests';

import type { K8sResource, KubeConfigProvider } from './types';

export function buildRemoveAnnotationPatch(annotationKey: string): {
  metadata: { annotations: Record<string, null> };
} {
  const normalizedKey = annotationKey.trim();

  if (!normalizedKey) {
    throw new Error('Annotation key is required');
  }

  return {
    metadata: {
      annotations: {
        [normalizedKey]: null,
      },
    },
  };
}

export function hasAnnotation(
  resource: K8sResource,
  annotationKey: string,
): boolean {
  const annotations = resource.metadata?.annotations;
  return annotations
    ? Object.prototype.hasOwnProperty.call(annotations, annotationKey)
    : false;
}

export async function removeAnnotationFromManifestResource(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
  crPath: string,
  annotationKey: string,
): Promise<void> {
  const resource = await getPrimaryManifestResource(crPath);
  const name = resource.metadata?.name;

  if (!name) {
    throw new Error(
      `Cannot remove annotation from ${resource.kind}: missing metadata.name`,
    );
  }

  const handle = await resolveCrHandle(
    getKubeConfig,
    resource.apiVersion,
    resource.kind,
  );
  const patch = buildRemoveAnnotationPatch(annotationKey);
  const ns = handle.info.namespaced
    ? (resource.metadata?.namespace ?? namespace)
    : undefined;

  await handle.patch(ns, name, patch);
}
