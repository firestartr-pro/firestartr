import common from 'catalog_common';
import { getFirestartrAnnotation } from '../../../src/claim-taxonomy';
import { destroyFixtureResources } from '../../../src/cleanup/fixture-resources';
import { CleanupRunner } from '../../../src/cleanup/runner';
import { resolveE2eFixturesPath } from '../../../src/fixtures-path';

import type { E2EApi } from '../../../src/types';

describe('destroyFixtureResources', () => {
  let nowMs = 0;

  beforeEach(() => {
    nowMs = 0;

    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    jest.spyOn(common.generic, 'sleep').mockImplementation(async (delay) => {
      nowMs += delay;
    });
    jest.spyOn(common.logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(common.logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(common.logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries cluster cleanup steps after transient failures', async () => {
    const deleteCustomResourcesByAnnotation = jest
      .fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockResolvedValue(1);
    const client = {
      claims: { getFixturesBasePath: () => resolveE2eFixturesPath() },
      k8s: {
        deleteCustomResourcesByAnnotation,
      },
    } as unknown as E2EApi;

    await destroyFixtureResources(client, 'demo', ['group-a'], {
      deleteOrg: false,
      logPrefix: 'fixture-cleanup',
    });

    expect(deleteCustomResourcesByAnnotation).toHaveBeenCalledTimes(2);
    expect(deleteCustomResourcesByAnnotation).toHaveBeenCalledWith({
      kind: 'FirestartrGithubGroup',
      apiVersion: 'firestartr.dev/v1',
      annotationKey: getFirestartrAnnotation('claimRef'),
      annotationValues: ['GroupClaim/demo-e2e-group-a'],
      timeout: 600,
      forceFinalizers: true,
    });
    expect(common.generic.sleep).toHaveBeenCalledWith(1500);
    expect(common.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('attempt 2/3'),
    );
  });

  it('deletes org webhook CRs by org webhook claim-ref', async () => {
    const deleteCustomResourcesByAnnotation = jest.fn().mockResolvedValue(1);
    const destroyOrgWebhookByUrl = jest.fn().mockResolvedValue(undefined);
    const client = {
      claims: { getFixturesBasePath: () => resolveE2eFixturesPath() },
      k8s: {
        deleteCustomResourcesByAnnotation,
      },
      gh: {
        destroyOrgWebhookByUrl,
      },
    } as unknown as E2EApi;

    await destroyFixtureResources(client, 'demo', ['orgwebhook-a'], {
      deleteOrg: false,
      logPrefix: 'fixture-cleanup',
    });

    expect(deleteCustomResourcesByAnnotation).toHaveBeenCalledWith({
      kind: 'FirestartrGithubOrgWebhook',
      apiVersion: 'firestartr.dev/v1',
      annotationKey: getFirestartrAnnotation('claimRef'),
      annotationValues: ['OrgWebhookClaim/demo-e2e-orgwebhook-a'],
      timeout: 600,
      forceFinalizers: true,
    });
  });

  it('deletes tfworkspace CRs by terraform workspace claim-ref', async () => {
    const deleteCustomResourcesByAnnotation = jest.fn().mockResolvedValue(1);
    const client = {
      claims: { getFixturesBasePath: () => resolveE2eFixturesPath() },
      k8s: {
        deleteCustomResourcesByAnnotation,
      },
    } as unknown as E2EApi;

    await destroyFixtureResources(client, 'demo', ['tfworkspace-a'], {
      deleteOrg: false,
      logPrefix: 'fixture-cleanup',
    });

    expect(deleteCustomResourcesByAnnotation).toHaveBeenCalledWith({
      kind: 'FirestartrTerraformWorkspace',
      apiVersion: 'firestartr.dev/v1',
      annotationKey: getFirestartrAnnotation('claimRef'),
      annotationValues: ['TFWorkspaceClaim/demo-e2e-tfworkspace-a'],
      timeout: 600,
      forceFinalizers: true,
    });
  });

  it('deletes workspace_a tfworkspace CRs by terraform workspace claim-ref', async () => {
    const deleteCustomResourcesByAnnotation = jest.fn().mockResolvedValue(1);
    const client = {
      claims: { getFixturesBasePath: () => resolveE2eFixturesPath() },
      k8s: {
        deleteCustomResourcesByAnnotation,
      },
    } as unknown as E2EApi;

    await destroyFixtureResources(client, 'demo', ['workspace_a'], {
      deleteOrg: false,
      logPrefix: 'fixture-cleanup',
    });

    expect(deleteCustomResourcesByAnnotation).toHaveBeenCalledWith({
      kind: 'FirestartrTerraformWorkspace',
      apiVersion: 'firestartr.dev/v1',
      annotationKey: getFirestartrAnnotation('claimRef'),
      annotationValues: ['TFWorkspaceClaim/demo-e2e-workspace_a'],
      timeout: 600,
      forceFinalizers: true,
    });
  });

  it('aggregates one error line per failing cleanup step, in order', async () => {
    const deleteCustomResourcesByAnnotation = jest
      .fn()
      .mockRejectedValue(new Error('cluster down'));
    const destroyGroup = jest.fn().mockRejectedValue(new Error('org down'));
    const destroyRepo = jest.fn().mockResolvedValue(undefined);
    const destroyOrgWebhookByUrl = jest.fn().mockResolvedValue(undefined);
    const client = {
      claims: { getFixturesBasePath: () => resolveE2eFixturesPath() },
      k8s: {
        deleteCustomResourcesByAnnotation,
      },
      gh: {
        destroyGroup,
        destroyRepo,
        destroyOrgWebhookByUrl,
      },
    } as unknown as E2EApi;

    await expect(
      destroyFixtureResources(client, 'demo', ['group-a'], {
        logPrefix: 'fixture-cleanup',
      }),
    ).rejects.toThrow(
      /deleting stale cluster fixture resources: cluster down[\s\S]*deleting stale org fixture resources: org down/,
    );
  });

  it('keeps later directory and context teardown running after failing resource cleanup steps', async () => {
    const deleteCustomResourcesByAnnotation = jest
      .fn()
      .mockRejectedValue(new Error('cluster down'));
    const destroyGroup = jest.fn().mockRejectedValue(new Error('org down'));
    const client = {
      claims: { getFixturesBasePath: () => resolveE2eFixturesPath() },
      k8s: {
        deleteCustomResourcesByAnnotation,
      },
      gh: {
        destroyGroup,
        destroyRepo: jest.fn().mockResolvedValue(undefined),
        destroyOrgWebhookByUrl: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as E2EApi;

    // Mirrors a suite's afterAll: resource cleanup first, then the directory
    // and render-context teardown steps.
    const cleanup = new CleanupRunner();
    const disposePlainSecret = jest.fn().mockResolvedValue(undefined);
    const cleanupRenderedArtifacts = jest.fn().mockResolvedValue(undefined);

    await cleanup.run(
      'destroy repository secrets fixture resources',
      async () => {
        await destroyFixtureResources(client, 'demo', ['group-a'], {
          logPrefix: 'fixture-cleanup',
        });
      },
    );
    await cleanup.run('dispose plain repository secret', disposePlainSecret);
    await cleanup.run('cleanup rendered artifacts', cleanupRenderedArtifacts);

    expect(disposePlainSecret).toHaveBeenCalledTimes(1);
    expect(cleanupRenderedArtifacts).toHaveBeenCalledTimes(1);

    let failure: Error | undefined;
    try {
      cleanup.throwOnErrors('fixture teardown');
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message.split('\n')).toEqual([
      'Cleanup failed for fixture teardown:',
      'destroy repository secrets fixture resources: deleting stale cluster fixture resources: cluster down',
      'deleting stale org fixture resources: org down',
    ]);
  });

  it('deletes firestartr group CRs by group claim-ref', async () => {
    const deleteCustomResourcesByAnnotation = jest.fn().mockResolvedValue(1);
    const destroyGroup = jest.fn().mockResolvedValue(undefined);
    const destroyRepo = jest.fn().mockResolvedValue(undefined);
    const destroyOrgWebhookByUrl = jest.fn().mockResolvedValue(undefined);
    const client = {
      claims: { getFixturesBasePath: () => resolveE2eFixturesPath() },
      k8s: {
        deleteCustomResourcesByAnnotation,
      },
      gh: {
        destroyGroup,
        destroyRepo,
        destroyOrgWebhookByUrl,
      },
    } as unknown as E2EApi;

    await destroyFixtureResources(client, 'demo', ['firestartr'], {
      logPrefix: 'fixture-cleanup',
    });

    expect(deleteCustomResourcesByAnnotation).toHaveBeenCalledWith({
      kind: 'FirestartrGithubGroup',
      apiVersion: 'firestartr.dev/v1',
      annotationKey: getFirestartrAnnotation('claimRef'),
      annotationValues: ['GroupClaim/demo-e2e-firestartr'],
      timeout: 600,
      forceFinalizers: true,
    });
    expect(destroyGroup).toHaveBeenCalledWith('demo-e2e-firestartr');
    expect(destroyRepo).toHaveBeenCalledWith('demo-e2e-firestartr');
  });

  it('forwards explicit org webhook urls to org cleanup', async () => {
    const deleteCustomResourcesByAnnotation = jest.fn().mockResolvedValue(1);
    const destroyGroup = jest.fn().mockResolvedValue(undefined);
    const destroyRepo = jest.fn().mockResolvedValue(undefined);
    const destroyOrgWebhookByUrl = jest.fn().mockResolvedValue(undefined);
    const client = {
      claims: { getFixturesBasePath: () => resolveE2eFixturesPath() },
      k8s: {
        deleteCustomResourcesByAnnotation,
      },
      gh: {
        destroyGroup,
        destroyRepo,
        destroyOrgWebhookByUrl,
      },
    } as unknown as E2EApi;

    await destroyFixtureResources(client, 'demo', ['orgwebhook-a'], {
      orgWebhookUrls: ['https://example.com/hooks/a'],
      logPrefix: 'fixture-cleanup',
    });

    expect(destroyGroup).not.toHaveBeenCalled();
    expect(destroyRepo).not.toHaveBeenCalled();
    expect(destroyOrgWebhookByUrl).toHaveBeenCalledWith(
      'https://example.com/hooks/a',
    );
  });
});
