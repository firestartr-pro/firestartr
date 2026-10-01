import common from 'catalog_common';
import { destroyOrgResources } from '../../../src/cleanup/org-resources';

import type { E2EApi } from '../../../src/types';

describe('destroyOrgResources', () => {
  let nowMs = 0;

  beforeEach(() => {
    nowMs = 0;

    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    jest.spyOn(common.generic, 'sleep').mockImplementation(async (delay) => {
      nowMs += delay;
    });
    jest.spyOn(common.logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries retryable GitHub delete failures with backoff', async () => {
    const destroyGroup = jest.fn().mockResolvedValue(undefined);
    const destroyRepo = jest
      .fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockResolvedValue(undefined);
    const client = {
      gh: {
        destroyGroup,
        destroyRepo,
      },
    } as unknown as E2EApi;

    await destroyOrgResources(client, ['demo']);

    expect(destroyGroup).toHaveBeenCalledWith('demo');
    expect(destroyRepo).toHaveBeenCalledTimes(2);
    expect(common.generic.sleep).toHaveBeenCalledWith(1000);
    expect(common.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('attempt 2/3'),
    );
  });

  it('suppresses missing app config errors in non-strict mode', async () => {
    const destroyGroup = jest
      .fn()
      .mockRejectedValue(new Error('appId option is required'));
    const destroyRepo = jest
      .fn()
      .mockRejectedValue(new Error('appId option is required'));
    const client = {
      gh: {
        destroyGroup,
        destroyRepo,
      },
    } as unknown as E2EApi;

    await expect(
      destroyOrgResources(client, ['demo']),
    ).resolves.toBeUndefined();
    expect(common.generic.sleep).not.toHaveBeenCalled();
  });

  it('deletes explicit org webhook urls', async () => {
    const destroyGroup = jest.fn().mockResolvedValue(undefined);
    const destroyRepo = jest.fn().mockResolvedValue(undefined);
    const destroyOrgWebhookByUrl = jest.fn().mockResolvedValue(undefined);
    const client = {
      gh: {
        destroyGroup,
        destroyRepo,
        destroyOrgWebhookByUrl,
      },
    } as unknown as E2EApi;

    await destroyOrgResources(client, [], {
      orgWebhookUrls: [
        'https://example.com/hooks/a',
        'https://example.com/hooks/a',
        'https://example.com/hooks/b',
      ],
    });

    expect(destroyOrgWebhookByUrl).toHaveBeenNthCalledWith(
      1,
      'https://example.com/hooks/b',
    );
    expect(destroyOrgWebhookByUrl).toHaveBeenNthCalledWith(
      2,
      'https://example.com/hooks/a',
    );
    expect(destroyGroup).not.toHaveBeenCalled();
    expect(destroyRepo).not.toHaveBeenCalled();
  });
});
