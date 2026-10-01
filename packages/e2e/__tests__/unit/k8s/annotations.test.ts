import {
  buildRemoveAnnotationPatch,
  hasAnnotation,
} from '../../../src/k8s/annotations';

import type { K8sResource } from '../../../src/k8s/types';

describe('k8s annotations', () => {
  it('builds a merge patch that removes only the requested annotation', () => {
    expect(buildRemoveAnnotationPatch('firestartr.dev/import')).toEqual({
      metadata: {
        annotations: {
          'firestartr.dev/import': null,
        },
      },
    });
  });

  it('rejects empty annotation keys', () => {
    expect(() => buildRemoveAnnotationPatch('  ')).toThrow(
      'Annotation key is required',
    );
  });

  it('checks annotation presence without depending on annotation value truthiness', () => {
    const resource: K8sResource = {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubGroup',
      metadata: {
        name: 'demo',
        annotations: {
          'firestartr.dev/import': '',
          'firestartr.dev/needs-re-import': 'false',
          'firestartr.dev/claim-ref': 'GroupClaim/demo',
        },
      },
    };

    expect(hasAnnotation(resource, 'firestartr.dev/import')).toBe(true);
    expect(hasAnnotation(resource, 'firestartr.dev/needs-re-import')).toBe(
      true,
    );
    expect(hasAnnotation(resource, 'missing')).toBe(false);
  });
});
