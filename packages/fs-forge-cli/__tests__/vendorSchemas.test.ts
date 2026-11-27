import { describe, expect, it, jest } from '@jest/globals';
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

    it('still rejects a string for an int64 integer field', () => {
      const invalidDoc = {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'ApplicationSet',
        metadata: { name: 'app-billing', namespace: 'argocd' },
        spec: {
          generators: [
            {
              git: {
                repoURL: 'https://github.com/acme/app-billing.git',
                revision: 'deployment',
                directories: [{ path: 'kubernetes/eks-prod/*/*' }],
              },
            },
          ],
          template: {
            metadata: { name: 'app-billing-{{ .path.basename }}' },
            spec: {
              project: 'app-billing',
              revisionHistoryLimit: 'not-an-integer',
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

  it('loads vendored schemas from package root even when cwd is outside the package', () => {
    const prevCwd = process.cwd();
    try {
      process.chdir(tmpdir());
      const validate = loadVendorValidator(
        'argocd-appproject',
        vendorSchemasDir(PACKAGE_ROOT),
      );
      expect(
        validate({
          apiVersion: 'argoproj.io/v1alpha1',
          kind: 'AppProject',
          metadata: { name: 'app-billing', namespace: 'argocd' },
          spec: {},
        }),
      ).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('compiles vendored schemas without emitting Ajv unknown-format warnings to stderr', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      jest.resetModules();
      const fresh = await import('../src/schema/vendorSchemas');
      fresh.loadVendorValidator('argocd-applicationset', VENDOR_DIR);
      fresh.loadVendorValidator('argocd-appproject', VENDOR_DIR);

      expect(warnSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });
});
