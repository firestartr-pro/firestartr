import { describe, expect, it } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import YAML from 'yaml';

import { createClaimValidator } from '../src/utils/ajvValidation';

const SCHEMAS_DIR = join(process.cwd(), 'schemas');
const VALID_COMPONENT = join(
  process.cwd(),
  '__tests__',
  'fixtures',
  'valid',
  'component.yaml',
);

function loadYaml(path: string): Record<string, unknown> {
  return YAML.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('createClaimValidator', () => {
  it('validates a valid claim from the schemas directory', async () => {
    const validator = createClaimValidator({ schemasDir: SCHEMAS_DIR });

    await expect(
      validator.validate(loadYaml(VALID_COMPONENT), 'ComponentClaim'),
    ).resolves.toEqual({ valid: true, errors: [] });
  });

  it('reports schema errors for an invalid claim', async () => {
    const validator = createClaimValidator({ schemasDir: SCHEMAS_DIR });

    const result = await validator.validate(
      { kind: 'ComponentClaim', name: 'x' },
      'ComponentClaim',
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes("required property 'owner'")),
    ).toBe(true);
  });

  it('reports a missing schema with the pre-refactor message', async () => {
    const validator = createClaimValidator({ schemasDir: SCHEMAS_DIR });

    await expect(validator.validate({}, 'UnknownKind')).resolves.toEqual({
      valid: false,
      errors: ['No schema found for claim kind: UnknownKind'],
    });
  });

  it('keeps two registries over different directories independent', async () => {
    const directoryA = await mkdtemp(join(tmpdir(), 'fs-forge-schema-a-'));
    const directoryB = await mkdtemp(join(tmpdir(), 'fs-forge-schema-b-'));
    try {
      await writeFile(
        join(directoryA, 'FooClaim.json'),
        JSON.stringify({
          type: 'object',
          required: ['a'],
          properties: { a: { type: 'string' } },
        }),
        'utf8',
      );
      await writeFile(
        join(directoryB, 'FooClaim.json'),
        JSON.stringify({
          type: 'object',
          required: ['b'],
          properties: { b: { type: 'string' } },
        }),
        'utf8',
      );

      const registryA = createClaimValidator({ schemasDir: directoryA });
      const registryB = createClaimValidator({ schemasDir: directoryB });

      await expect(
        registryA.validate({ a: 'x' }, 'FooClaim'),
      ).resolves.toEqual({ valid: true, errors: [] });
      await expect(
        registryB.validate({ a: 'x' }, 'FooClaim'),
      ).resolves.toEqual(
        expect.objectContaining({ valid: false }),
      );

      await expect(
        registryB.validate({ b: 'x' }, 'FooClaim'),
      ).resolves.toEqual({ valid: true, errors: [] });
      await expect(
        registryA.validate({ b: 'x' }, 'FooClaim'),
      ).resolves.toEqual(
        expect.objectContaining({ valid: false }),
      );
    } finally {
      await rm(directoryA, { recursive: true, force: true });
      await rm(directoryB, { recursive: true, force: true });
    }
  });
});
