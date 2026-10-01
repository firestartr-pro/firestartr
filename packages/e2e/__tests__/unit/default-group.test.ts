jest.mock('../../src/cleanup/org-resources', () => ({
  __esModule: true,
  destroyOrgResources: jest.fn(),
}));

import common from 'catalog_common';
import { destroyOrgResources } from '../../src/cleanup/org-resources';
import { ensureDefaultGroup } from '../../src/default-group';
import { WAIT_FOR_CR_TIMEOUT_SECONDS } from '../../src/test-constants';
import type { E2EApi } from '../../src/types';

const destroyOrgResourcesMock = destroyOrgResources as jest.MockedFunction<
  typeof destroyOrgResources
>;

describe('ensureDefaultGroup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    destroyOrgResourcesMock.mockResolvedValue(undefined);
  });

  it('cleans stale cluster and remote org resources before creating the default group', async () => {
    const deleteCustomResourcesByAnnotation = jest.fn().mockResolvedValue(1);
    const renderLocally = jest.fn().mockResolvedValue({
      crPaths: ['/tmp/default-group.yaml'],
      outputPath: '/tmp/rendered',
    });
    const applyCr = jest.fn().mockResolvedValue(undefined);
    const waitForCr = jest.fn().mockResolvedValue({});
    const getGroupTfStateKey = jest.fn().mockResolvedValue('tf-state-key');
    const restartContext = jest.fn().mockResolvedValue(undefined);
    const patchContextFile = jest.fn().mockResolvedValue(undefined);

    const client = {
      getPrefix: () => 'org-script-render-apply',
      k8s: {
        deleteCustomResourcesByAnnotation,
        applyCr,
        waitForCr,
        getGroupTfStateKey,
      },
      claims: {
        renderLocally,
        restartContext,
        patchContextFile,
      },
    } as unknown as E2EApi;

    const defaultGroup = await ensureDefaultGroup(client);

    expect(deleteCustomResourcesByAnnotation).toHaveBeenCalledWith({
      kind: 'FirestartrGithubGroup',
      apiVersion: 'firestartr.dev/v1',
      annotationKey: common.generic.getFirestartrAnnotation('claim-ref'),
      annotationValues: [
        'GroupClaim/org-script-render-apply-e2e-default-group',
      ],
      timeout: WAIT_FOR_CR_TIMEOUT_SECONDS,
      forceFinalizers: true,
    });
    expect(destroyOrgResources).toHaveBeenCalledWith(client, [
      'org-script-render-apply-e2e-default-group',
    ]);
    expect(
      deleteCustomResourcesByAnnotation.mock.invocationCallOrder[0],
    ).toBeLessThan(destroyOrgResourcesMock.mock.invocationCallOrder[0]);
    expect(destroyOrgResourcesMock.mock.invocationCallOrder[0]).toBeLessThan(
      renderLocally.mock.invocationCallOrder[0],
    );
    expect(applyCr).toHaveBeenCalledWith('/tmp/default-group.yaml');
    expect(waitForCr).toHaveBeenCalledWith(
      '/tmp/default-group.yaml',
      WAIT_FOR_CR_TIMEOUT_SECONDS,
    );
    expect(defaultGroup).toEqual({
      name: 'org-script-render-apply-e2e-default-group',
      ref: 'group:org-script-render-apply-e2e-default-group',
      tfStateKey: 'tf-state-key',
    });
  });
});
