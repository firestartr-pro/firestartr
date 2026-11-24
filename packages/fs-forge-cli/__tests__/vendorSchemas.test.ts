import { describe, expect, it } from '@jest/globals';

import { loadVendorValidator } from '../src/schema/vendorSchemas';

describe('vendored schema validators', () => {
  describe('argocd-applicationset', () => {
    const validate = loadVendorValidator('argocd-applicationset');

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
          generators: [
            {
              git: {
                repoURL: 'https://github.com/acme/app-billing.git',
                revision: 'deployment',
                directories: [{ path: 'kubernetes/*/*/*' }],
              },
            },
          ],
          template: {
            metadata: {
              name: 'app-billing-dev',
            },
            spec: {
              project: 'app-billing',
              source: {
                repoURL: 'https://github.com/acme/app-billing.git',
                targetRevision: 'deployment',
                path: 'kubernetes/eks/core/dev',
              },
              destination: {
                server: 'https://eks.example.com',
                namespace: 'core-billing-dev',
              },
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
    const validate = loadVendorValidator('argocd-appproject');

    it('accepts a valid AppProject document', () => {
      const validDoc = {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'AppProject',
        metadata: {
          name: 'app-billing',
          namespace: 'argocd',
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
    const validate = loadVendorValidator('build-images');

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
});
