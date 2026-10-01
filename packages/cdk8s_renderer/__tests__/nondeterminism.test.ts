import fs from 'fs/promises';
import path from 'path';
import { createTestContext, RendererTestContext } from './auxiliar';

describe('Renderer non-determinism - readdir effect', () => {
  jest.setTimeout(120000);
  process.env.ORG = 'firestartr-test';

  let context: RendererTestContext;

  beforeAll(async () => {
    context = await createTestContext({
      paths: ['components', 'groups', 'systems', 'users', 'domains'],
    });
  });

  beforeEach(async () => {
    context = await context.resetRendererState();
  });

  afterAll(async () => {
    await context.destroy();
  });

  it('produces identical CR content (ignoring UUIDs) across renders without previous CRs', async () => {
    const contents: string[] = [];
    const iterations = 20;

    for (let i = 0; i < iterations; i++) {
      context = await context.resetRendererState();

      // Use DEFAULT crsPath (fixtures/crs/) which has NO matching previous CRs
      await context.renderClaims(
        { claimRefs: ['ComponentClaim-component_a'] },
        { excludeGithubCrs: true },
      );

      const cr = await context.getRenderedCR(
        'FirestartrGithubRepository',
        'component-a',
      );

      if (!cr) {
        throw new Error('FirestartrGithubRepository component-a not found');
      }

      // Normalize UUIDs in content for comparison
      const normalized = cr.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        'UUID',
      );

      contents.push(normalized);
    }

    const first = contents[0];
    for (let i = 1; i < contents.length; i++) {
      if (contents[i] !== first) {
        const lines0 = first.split('\n');
        const linesI = contents[i].split('\n');
        let diffLine = -1;
        for (let j = 0; j < Math.max(lines0.length, linesI.length); j++) {
          if (lines0[j] !== linesI[j]) {
            diffLine = j;
            break;
          }
        }
        throw new Error(
          `Render #${i} differs from render #0 at line ${diffLine}:\n` +
            `  #0: ${lines0[diffLine]}\n` +
            `  #${i}: ${linesI[diffLine]}\n\n` +
            `Full diff:\n` +
            lines0
              .map((l, idx) => {
                if (l !== linesI[idx])
                  return `  L${idx}: [0] ${l}\n         [${i}] ${linesI[idx]}`;
                return null;
              })
              .filter(Boolean)
              .join('\n'),
        );
      }
    }

    expect(contents.length).toBe(iterations);
  });
});
