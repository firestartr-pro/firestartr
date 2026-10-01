import { describe, expect, it, jest } from '@jest/globals';
import { join, sep } from 'path';

import { createFeatureSource } from '../src/utils/featureSource';

const ROOT = process.cwd();
const SOURCE = join(ROOT, '__tests__', 'fixtures', 'feature-sources');
const INDEXED_DOCUMENT_SOURCE = join(SOURCE, 'indexed-documents');

const source = createFeatureSource(SOURCE);

describe('feature source', () => {
  it('loads the feature index directly', async () => {
    await expect(source.readFeatureIndex()).resolves.toEqual({
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

  it('loads a feature version history directly', async () => {
    await expect(source.readFeatureVersions('feature_a')).resolves.toEqual([
      {
        version: '1.1.0',
        date: '2025-01-02T00:00:00Z',
        url: 'feature_a/1.1.0/feature-schema.json',
      },
      {
        version: '1.0.0',
        date: '2025-01-01T00:00:00Z',
        url: 'https://example.invalid/feature_a/1.0.0/schema.json',
      },
    ]);
  });

  it('resolves a feature schema directly', async () => {
    await expect(
      source.readFeatureSchema('feature_a', '1.1.0'),
    ).resolves.toMatchObject({
      title: 'feature_a args',
      version: '1.1.0',
      fileManifest: [{ src: 'feature.txt', dest: 'feature.txt' }],
    });
  });

  it('rejects remote schema URLs for local sources', async () => {
    await expect(
      source.readFeatureSchema('feature_a', '1.0.0'),
    ).rejects.toThrow('Local feature sources require relative schema URLs');
  });

  it('resolves documents from the feature index manifest', async () => {
    const indexedSource = createFeatureSource(INDEXED_DOCUMENT_SOURCE);

    await expect(
      indexedSource.readFeatureDocument('feature_a', 'README.md'),
    ).resolves.toBe('# Indexed Feature README\n\nResolved from the feature index.\n');
    await expect(
      indexedSource.readFeatureDocument('feature_a', 'CHANGELOG.md'),
    ).resolves.toBe('# Indexed Changelog\n\nResolved from the feature index.\n');
  });

  it('falls back to conventional document paths', async () => {
    await expect(
      createFeatureSource(
        join(SOURCE, 'fallback-documents'),
      ).readFeatureDocument('feature_a', 'README.md'),
    ).resolves.toBe('# Fallback Feature README\n');
  });

  it('rejects invalid feature path segments', async () => {
    await expect(source.readFeatureVersions('../feature')).rejects.toThrow(
      'Invalid feature name: ../feature',
    );
    await expect(
      source.readFeatureSchema('feature_a', '../version'),
    ).rejects.toThrow('Invalid feature version: ../version');
  });

  it('translates local source failures', async () => {
    await expect(
      createFeatureSource(join(SOURCE, 'missing')).readFeatureIndex(),
    ).rejects.toThrow('Unable to read feature source');
    await expect(createFeatureSource(sep).readFeatureIndex()).rejects.toThrow(
      'Unable to read feature source',
    );
    await expect(createFeatureSource(sep).readFeatureIndex()).rejects.not.toThrow(
      'Path escapes feature source',
    );
  });

  it('translates HTTP source failures and applies request policy', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('timed out'));

    try {
      await expect(
        createFeatureSource('http://127.0.0.1:1').readFeatureIndex(),
      ).rejects.toThrow('Unable to read feature source');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1/index.json',
        expect.objectContaining({
          redirect: 'error',
          signal: expect.any(AbortSignal),
        }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('normalizes query and fragment data outside the HTTP source path', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ features: [] })),
    );

    try {
      await expect(
        createFeatureSource(
          'https://example.com/features?ref=main#source',
        ).readFeatureIndex(),
      ).resolves.toEqual({ features: [] });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/features/index.json',
        expect.objectContaining({ redirect: 'error' }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('rejects schema URLs outside an HTTP source', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            version: '1.0.0',
            date: '2025-01-01T00:00:00Z',
            url: '../outside/schema.json',
          },
        ]),
      ),
    );

    try {
      await expect(
        createFeatureSource('https://example.com/features').readFeatureSchema(
          'feature_a',
          '1.0.0',
        ),
      ).rejects.toThrow('Path escapes feature source');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/features/feature_a/versions.json',
        expect.objectContaining({ redirect: 'error' }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('rejects malformed feature source JSON', async () => {
    await expect(
      createFeatureSource(join(SOURCE, 'malformed')).readFeatureIndex(),
    ).rejects.toThrow('Malformed JSON in index.json');
  });
});
