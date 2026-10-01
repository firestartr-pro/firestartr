import common from 'catalog_common';
import { waitForOrgWebhookState } from '../../..';

import type { E2EApi } from '../../../src/types';

describe('waitForOrgWebhookState', () => {
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

  it('polls until the org webhook reaches the requested existence state', async () => {
    const orgWebhookExists = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const client = {
      gh: {
        orgWebhookExists,
      },
    } as unknown as E2EApi;

    await expect(
      waitForOrgWebhookState(client, 'https://example.com/hooks/a', true, {
        timeoutMs: 1000,
        intervalMs: 250,
      }),
    ).resolves.toBeUndefined();

    expect(orgWebhookExists).toHaveBeenCalledTimes(2);
    expect(common.generic.sleep).toHaveBeenCalledWith(250);
  });

  it('includes the last observed existence state in timeout errors', async () => {
    const client = {
      gh: {
        orgWebhookExists: jest.fn().mockResolvedValue(false),
      },
    } as unknown as E2EApi;

    await expect(
      waitForOrgWebhookState(
        client,
        'https://example.com/hooks/missing',
        true,
        {
          timeoutMs: 1000,
          intervalMs: 500,
        },
      ),
    ).rejects.toThrow(
      "Timed out waiting for org webhook 'https://example.com/hooks/missing' to exist. Last observed exists=false.",
    );
  });

  it('retries transient GitHub probe errors within the polling window', async () => {
    const orgWebhookExists = jest
      .fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockResolvedValueOnce(true);
    const client = {
      gh: {
        orgWebhookExists,
      },
    } as unknown as E2EApi;

    await expect(
      waitForOrgWebhookState(client, 'https://example.com/hooks/retry', true, {
        timeoutMs: 1000,
        intervalMs: 250,
      }),
    ).resolves.toBeUndefined();

    expect(orgWebhookExists).toHaveBeenCalledTimes(2);
    expect(common.generic.sleep).toHaveBeenCalledWith(250);
    expect(common.logger.warn).toHaveBeenCalledWith(
      'Retrying org webhook wait after 250ms due to: rate limited',
    );
  });

  it('retries transient GitHub 403 secondary rate limit responses', async () => {
    const orgWebhookExists = jest
      .fn()
      .mockRejectedValueOnce({
        status: 403,
        message:
          'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
      })
      .mockResolvedValueOnce(false);
    const client = {
      gh: {
        orgWebhookExists,
      },
    } as unknown as E2EApi;

    await expect(
      waitForOrgWebhookState(client, 'https://example.com/hooks/403', false, {
        timeoutMs: 1000,
        intervalMs: 250,
      }),
    ).resolves.toBeUndefined();

    expect(orgWebhookExists).toHaveBeenCalledTimes(2);
    expect(common.generic.sleep).toHaveBeenCalledWith(250);
  });
});
