import { describe, expect, it } from '@jest/globals';
import { tmpdir } from 'os';

import {
  loadVendorValidator,
  vendorSchemasDir,
} from '../src/schema/vendorSchemas';

const PACKAGE_ROOT = process.cwd();
const VENDOR_DIR = vendorSchemasDir(PACKAGE_ROOT);

describe('vendored schema validators', () => {
  describe('argocd-applicationset', () => {
    const validate = loadVendorValidator('argocd-applicationset', VENDOR_DIR);

    it('accepts a valid ApplicationSet document', () => {
      const validDoc = {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'ApplicationSet',
        metadata: {
          name: 'app-billing',
          namespace: 'argocd',
        },
        spec: {
          goTemplate: true,
          goTemplateOptions: ['missingkey=error'],
          generators: [
            {
              git: {
                repoURL: 'https://github.com/acme/app-billing.git',
                revision: 'deployment',
                directories: [{ path: 'kubernetes/eks-prod/*/*' }],
                values: {
                  cluster: 'eks-prod',
                  server: 'https://eks.example.com',
                },
              },
            },
          ],
          template: {
            metadata: {
              name: 'app-billing-{{ .path.basename }}',
            },
            spec: {
              project: 'app-billing',
              source: {
                repoURL: 'https://github.com/acme/app-billing.git',
                targetRevision: 'deployment',
                path: '{{ .path.path }}',
              },
              destination: {
                server: '{{ .values.server }}',
                namespace: 'core-billing-{{ .path.basename }}',
              },
              syncPolicy: {
                automated: {
                  prune: true,
                  selfHeal: true,
                },
                syncOptions: ['CreateNamespace=true', 'ServerSideApply=true'],
              },
              ignoreDifferences: [
                {
                  group: 'apps',
                  kind: 'Deployment',
                  jsonPointers: ['/spec/replicas'],
                },
              ],
            },
          },
        },
      };

      expect(validate(validDoc)).toBe(true);
    });

    it('rejects an invalid ApplicationSet document missing spec.generators', () => {
      const invalidDoc = {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'ApplicationSet',
        metadata: { name: 'app-billing' },
        spec: {
          template: {
            metadata: { name: 'app-billing-dev' },
            spec: {
              project: 'app-billing',
              destination: { namespace: 'core-billing-dev' },
            },
          },
        },
      };

      expect(validate(invalidDoc)).toBe(false);
    });
  });

  describe('argocd-appproject', () => {
    const validate = loadVendorValidator('argocd-appproject', VENDOR_DIR);

    it('accepts a valid AppProject document', () => {
      const validDoc = {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'AppProject',
        metadata: {
          name: 'app-billing',
          namespace: 'argocd',
          annotations: {
            'notifications.argoproj.io/subscribe.on-sync-failed.slack':
              '#alerts',
            'notifications.argoproj.io/subscribe.on-health-degraded.slack':
              '#alerts',
          },
        },
        spec: {
          description: 'billing State Project',
          sourceRepos: ['https://github.com/acme/app-billing.git'],
          destinations: [
            {
              namespace: 'core-billing-dev',
              server: 'https://eks.example.com',
            },
          ],
          clusterResourceWhitelist: [
            {
              group: '',
              kind: 'Namespace',
            },
          ],
        },
      };

      expect(validate(validDoc)).toBe(true);
    });

    it('rejects an invalid AppProject document with wrong spec.destinations type', () => {
      const invalidDoc = {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'AppProject',
        metadata: { name: 'app-billing' },
        spec: {
          destinations: 'not-an-array',
        },
      };

      expect(validate(invalidDoc)).toBe(false);
    });
  });

  describe('build-images', () => {
    const validate = loadVendorValidator('build-images', VENDOR_DIR);

    it('accepts a valid build_images.yaml document', () => {
      const validDoc = {
        snapshots: {
          default: {
            dockerfile: './Dockerfile',
            auto: true,
          },
        },
      };

      expect(validate(validDoc)).toBe(true);
    });

    it('rejects an invalid build_images.yaml document with unknown auth_strategy', () => {
      const invalidDoc = {
        snapshots: {
          default: {
            dockerfile: './Dockerfile',
            registry: {
              name: 'ghcr',
              auth_strategy: 'invalid_strategy',
            },
          },
        },
      };

      expect(validate(invalidDoc)).toBe(false);
    });
  });

  it('loads vendored schemas from package root even when cwd is outside the package', () => {
    const prevCwd = process.cwd();
    try {
      process.chdir(tmpdir());
      const validate = loadVendorValidator(
        'build-images',
        vendorSchemasDir(PACKAGE_ROOT),
      );
      expect(
        validate({
          snapshots: {
            default: { dockerfile: './Dockerfile', auto: true },
          },
        }),
      ).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
