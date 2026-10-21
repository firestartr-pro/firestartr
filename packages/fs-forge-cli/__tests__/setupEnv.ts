// The suite's "nothing configured" config path. No file may exist at this name,
// so a developer's real ~/.config/fs-forge/config.yaml never leaks into a test
// that expects no context. Tests that need a config set FS_FORGE_CONFIG
// themselves, pointing at a checked-in fixture under fixtures/context/.
import { join } from 'path';

// Tests opt in to an environment-selected org instead of inheriting the caller's.
delete process.env.FSCRT_ORG;

process.env.FS_FORGE_CONFIG = join(
  __dirname,
  'fixtures',
  'context',
  'absent.yaml',
);
