import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as k8s from '@kubernetes/client-node';

import { createApplyFunction } from '../../../src/k8s/apply';
import type { KubeConfigProvider } from '../../../src/k8s/types';

describe('apply custom resources', () => {
  it('preserves finalizers when replacing an existing custom resource', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-apply-'));
    const manifestPath = path.join(tempDir, 'variable-section.yaml');
    await fs.writeFile(
      manifestPath,
      [
        'apiVersion: firestartr.dev/v1',
        'kind: FirestartrGithubOrganizationVariableSection',
        'metadata:',
        '  name: variable-section-a',
        'spec: {}',
        '',
      ].join('\n'),
      'utf8',
    );

    const customApi = {
      createNamespacedCustomObject: jest
        .fn()
        .mockRejectedValueOnce({ statusCode: 409, message: 'already exists' }),
      getNamespacedCustomObject: jest.fn().mockResolvedValue({
        apiVersion: 'firestartr.dev/v1',
        kind: 'FirestartrGithubOrganizationVariableSection',
        metadata: {
          name: 'variable-section-a',
          finalizers: ['firestartr.dev/finalizer'],
          resourceVersion: '42',
        },
      }),
      replaceNamespacedCustomObject: jest.fn().mockResolvedValue(undefined),
    };
    const crdApi = {
      listCustomResourceDefinition: jest.fn().mockResolvedValue({
        items: [
          {
            spec: {
              group: 'firestartr.dev',
              names: {
                kind: 'FirestartrGithubOrganizationVariableSection',
                plural: 'githuborganizationvariablesections',
              },
              scope: 'Namespaced',
            },
          },
        ],
      }),
    };
    const kubeConfigProvider = (() => ({
      makeApiClient: (client: unknown) =>
        client === k8s.ApiextensionsV1Api ? crdApi : customApi,
    })) as unknown as KubeConfigProvider;

    try {
      await createApplyFunction(kubeConfigProvider, 'default')(manifestPath);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          metadata: expect.objectContaining({
            finalizers: ['firestartr.dev/finalizer'],
            resourceVersion: '42',
          }),
        }),
      }),
    );
  });
});
