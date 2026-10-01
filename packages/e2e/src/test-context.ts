import fs from 'node:fs/promises';
import {
  createTestContext as createRendererTestContext,
  type CreateTestContextOptions,
  type TestContext,
} from 'render/src/utils/auxiliar';
import { resolveE2eBaseClaimsPath } from './fixtures-path';

export async function createTestContext(
  options: CreateTestContextOptions = {},
): Promise<TestContext> {
  const baseClaimsPath = await fs.realpath(
    options.baseClaimsPath ?? resolveE2eBaseClaimsPath(),
  );

  return createRendererTestContext({
    ...options,
    baseClaimsPath,
  });
}
