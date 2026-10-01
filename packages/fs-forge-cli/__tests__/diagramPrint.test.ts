import { describe, it, expect, afterEach } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { Readable } from 'stream';
import { join } from 'path';

import DiagramPrint from '../src/commands/diagram/print';

const ROOT = process.cwd();
const VALID = join(ROOT, '__tests__', 'fixtures', 'relation-graphs', 'valid.json');
const INVALID = join(
  ROOT,
  '__tests__',
  'fixtures',
  'relation-graphs',
  'invalid.json',
);

async function run(argv: string[]) {
  return captureOutput(() => DiagramPrint.run(argv, { root: ROOT }));
}

afterEach(() => {
  process.exitCode = 0;
});

describe('diagram print', () => {
  it('renders a relation graph read from --file', async () => {
    const result = await run(['--file', VALID]);

    expect(result.stdout).toBe(
      '❓ team: platform\n└─ ❓ service: api (owns)\n',
    );
  });

  it('renders with --ascii icons', async () => {
    const result = await run(['--file', VALID, '--ascii']);

    expect(result.stdout).toBe(
      '[???] team: platform\n└─ [???] service: api (owns)\n',
    );
  });

  it('reads the graph from stdin when --file is omitted', async () => {
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      value: Readable.from([JSON.stringify({ nodes: [], edges: [] })]),
      configurable: true,
    });

    try {
      const result = await run([]);
      expect(result.stdout).toBe('');
    } finally {
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
    }
  });

  it('rejects malformed JSON', async () => {
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      value: Readable.from(['not json']),
      configurable: true,
    });

    try {
      const result = await run([]);
      expect(result.error?.message).toContain('Invalid JSON input');
    } finally {
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
    }
  });

  it('rejects a graph that fails schema validation', async () => {
    const result = await run(['--file', INVALID]);

    expect(result.error?.message).toContain('Invalid relation graph');
  });
});
