import { InitializerPatches } from './base';
import common from 'catalog_common';

interface AnnotationObject {
  [key: string]: string;
}

const BACKSTAGE_ANNOTATION_PREFIX = 'firestartr.backstage.dev/';

function isCatalogEntity(cr: any): boolean {
  return cr.apiVersion === 'backstage.io/v1alpha1';
}

function filterBackstageAnnotations(
  annotations: AnnotationObject,
): AnnotationObject {
  const filtered: AnnotationObject = {};
  for (const [key, value] of Object.entries(annotations)) {
    if (!key.startsWith(BACKSTAGE_ANNOTATION_PREFIX)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export class MetadataInitializer extends InitializerPatches {
  applicableProviders = ['^catalog'];

  static applicableKinds = [
    'ComponentClaim',
    'GroupClaim',
    'UserClaim',
    'TFWorkspaceClaim',
    'OrgWebhookClaim',
  ];

  async __validate() {
    return true;
  }

  async __patches(claim: any, _previousCR: any) {
    return [
      {
        validate(cr: any) {
          return true;
        },

        apply(cr: any) {
          if ('annotations' in claim && typeof claim.annotations === 'object') {
            cr.metadata = cr.metadata || {};

            const crAnnotations: AnnotationObject =
              cr.metadata.annotations ?? {};

            const claimAnnotations = isCatalogEntity(cr)
              ? (claim.annotations as AnnotationObject)
              : filterBackstageAnnotations(claim.annotations);

            cr.metadata.annotations = {
              ...claimAnnotations,

              ...crAnnotations,
            };
          }

          return cr;
        },

        identify() {
          return 'initializers/MetadataInitializer';
        },
      },
    ];
  }
}
