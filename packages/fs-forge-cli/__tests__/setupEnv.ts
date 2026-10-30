import { join } from 'path';

delete process.env.FSCRT_ORG;

process.env.FS_FORGE_CONFIG = join(
  __dirname,
  'fixtures',
  'context',
  'absent.yaml',
);
