import {
  warmupMirrors,
  DEFAULT_MIRROR_WARMUP_LIST,
} from 'terraform_provisioner';
import log from './logger';

/**
 * Configures TFM Mirrors by reading env configuration and invoking warmupMirrors.
 * Called at operator startup (from index.ts). Fails closed if initial warmup fails.
 */
export async function configureTFMMirrors(): Promise<void> {
  // 1. Check TFM_MIRROR_DISABLE
  if (process.env.TFM_MIRROR_DISABLE === '1') {
    log.info('TFM mirrors disabled via TFM_MIRROR_DISABLE');
    return;
  }

  // 2. Resolve mirror list
  const repos = process.env.TFM_MIRROR_LIST
    ? process.env.TFM_MIRROR_LIST.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined; // undefined uses DEFAULT_MIRROR_WARMUP_LIST inside terraform_provisioner

  // 3. Resolve refresh interval (default 900s = 15min)
  const refreshInterval = parseInt(
    process.env.TFM_MIRROR_REFRESH_INTERVAL || '900',
    10,
  );

  // 4. Call warmupMirrors with refresh enabled—terraform_provisioner handles everything
  try {
    const result = await warmupMirrors(repos, {
      enabled: true,
      runEvery: refreshInterval,
      onError: (error: Error) => {
        log.error('TFM mirror refresh error', {
          metadata: { message: error.message },
        });
      },
    });

    if (result.failed && result.failed.length > 0) {
      log.error('TFM mirror warmup failed', {
        metadata: { failed: result.failed },
      });
      process.exit(1);
    }
    log.info('TFM mirrors configured successfully', {
      metadata: { repos: result.success, refreshInterval },
    });
  } catch (e) {
    log.error('TFM mirror warmup threw error', {
      metadata: { message: e instanceof Error ? e.message : String(e) },
    });
    process.exit(1);
  }
}
