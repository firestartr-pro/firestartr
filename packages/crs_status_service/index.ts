import { loadConfig } from './src/config';
import { StatusCache } from './src/cache';
import { KindInformer } from './src/informer';
import { createServer } from './src/server';
import log from './src/logger';

export async function runService(): Promise<void> {
  const config = loadConfig();

  log.info(
    `Starting CR status service for kinds: ${config.kindList.join(', ')}`,
  );
  log.info(
    `Namespace: ${config.namespace}, API: ${config.apiGroup}/${config.apiVersion}`,
  );
  log.info(`Port: ${config.port}, Tombstone TTL: ${config.tombstoneTtlMs}ms`);

  const cache = new StatusCache();

  const informers: KindInformer[] = [];
  for (const plural of config.kindList) {
    const informer = new KindInformer(config, plural, cache);
    informers.push(informer);
    await informer.start();
  }

  await createServer(cache, config.port);

  process.on('SIGTERM', () => {
    log.info('Shutting down...');
    for (const informer of informers) {
      informer.stop();
    }
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log.info('Shutting down...');
    for (const informer of informers) {
      informer.stop();
    }
    process.exit(0);
  });
}
