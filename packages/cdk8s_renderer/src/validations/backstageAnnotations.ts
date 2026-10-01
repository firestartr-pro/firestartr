import { RenderedCrMap } from '../renderer/types';
import log from '../logger';

const BACKSTAGE_ANNOTATION_PREFIX = 'firestartr.backstage.dev/';

const CATALOG_KINDS = new Set([
  'User',
  'Group',
  'Component',
  'System',
  'Domain',
  'API',
  'Resource',
  'CatalogKubernetesResource',
  'CatalogTerraformWorkspace',
  'CatalogArgoDeploy',
  'CatalogOrgWebhook',
  'CatalogSecrets',
]);

export function validateNoBackstageAnnotationsInK8sCrs(
  crs: RenderedCrMap,
): void {
  for (const crKey in crs) {
    const cr: any = crs[crKey];

    if (CATALOG_KINDS.has(cr.kind)) continue;

    if (cr.metadata?.annotations) {
      const backstageKeys = Object.keys(cr.metadata.annotations).filter((k) =>
        k.startsWith(BACKSTAGE_ANNOTATION_PREFIX),
      );

      if (backstageKeys.length > 0) {
        throw new Error(
          `K8s CR ${crKey} contains Backstage-only annotations (${backstageKeys.join(', ')}). ` +
            `Annotations with prefix ${BACKSTAGE_ANNOTATION_PREFIX} must only appear on Backstage catalog entities, not on Kubernetes CRs.`,
        );
      }
    }
  }
}
