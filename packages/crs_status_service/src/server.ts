import express from 'express';
import type { StatusCache } from './cache';
import log from './logger';

export function createServer(cache: StatusCache, port: number) {
  const app = express();

  app.get('/status', (_req, res) => {
    const all = cache.getAll();
    res.json(all);
  });

  app.get('/status/:claimKind/:claimName', (req, res) => {
    const { claimKind, claimName } = req.params;
    const results = cache.getByClaimRef(claimKind, claimName);
    res.json(results);
  });

  app.get('/health', (_req, res) => {
    const size = cache.getSize();
    res.json({
      healthy: true,
      liveCount: size.live,
      tombstoneCount: size.tombstones,
    });
  });

  return new Promise<void>((resolve) => {
    app.listen(port, () => {
      log.info(`CR status service listening on port ${port}`);
      resolve();
    });
  });
}
