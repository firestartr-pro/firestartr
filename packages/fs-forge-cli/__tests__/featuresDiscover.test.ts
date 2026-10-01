import { describe, expect, it } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { join } from 'path';

import FeaturesDiscover from '../src/commands/features/discover';

const ROOT = process.cwd();
const SOURCE = join(ROOT, '__tests__', 'fixtures', 'feature-sources');

async function discover(...flags: string[]) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    return await captureOutput(async () => {
      await FeaturesDiscover.run(['--source', SOURCE, ...flags], {
        root: ROOT,
      });
      return 0;
    });
  } finally {
    process.exitCode = previousExitCode;
  }
}

describe('features discover output', () => {
  it('formats the feature list as a table', async () => {
    const { result, stdout } = await discover();

    expect(result).toBe(0);
    expect(stdout).toMatch(/^NAME\s+VERSION\s+FILES$/m);
    expect(stdout).toContain('feature_a');
    expect(stdout).toContain('1.1.0');
    expect(stdout).toContain('README.md, CHANGELOG.md');
  });

  it('formats the feature list as JSON', async () => {
    const { result, stdout } = await discover('--json');

    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      features: [
        {
          name: 'feature_a',
          version: '1.1.0',
          files: [
            { name: 'README.md', url: 'feature_a/README.md' },
            { name: 'CHANGELOG.md', url: 'feature_a/CHANGELOG.md' },
          ],
        },
      ],
    });
  });

  it('formats version history as a table', async () => {
    const { result, stdout } = await discover('--versions', 'feature_a');

    expect(result).toBe(0);
    expect(stdout).toMatch(/^VERSION\s+DATE\s+SCHEMA$/m);
    expect(stdout).toContain('1.1.0');
    expect(stdout).toContain('1.0.0');
    expect(stdout).toContain('2025-01-02T00:00:00Z');
    expect(stdout).toContain('2025-01-01T00:00:00Z');
  });

  it('formats a feature schema as JSON', async () => {
    const { result, stdout } = await discover('--schema', 'feature_a@1.1.0');

    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      title: 'feature_a args',
      version: '1.1.0',
      fileManifest: [{ src: 'feature.txt', dest: 'feature.txt' }],
    });
  });

  it('writes README Markdown without formatting', async () => {
    const { result, stdout } = await discover('--readme', 'feature_a');

    expect(result).toBe(0);
    expect(stdout).toBe('# Feature A\n\nFixture feature documentation.\n');
  });

  it('writes CHANGELOG Markdown without formatting', async () => {
    const { result, stdout } = await discover('--changelog', 'feature_a');

    expect(result).toBe(0);
    expect(stdout).toContain('# Changelog');
    expect(stdout).toContain('Added fixture support.');
  });

  it('rejects JSON output for Markdown documents', async () => {
    const { error } = await discover('--json', '--readme', 'feature_a');

    expect(error?.message).toContain(
      'cannot also be provided when using --json',
    );
  });
});
