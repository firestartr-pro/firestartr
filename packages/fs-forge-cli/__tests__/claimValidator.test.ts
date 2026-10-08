import { describe, expect, it, jest } from '@jest/globals';
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
const VALID_GROUP = join(
  process.cwd(),
  '__tests__',
  'fixtures',
  'valid',
  'group.yaml',
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
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      await expect(validator.validate({}, 'UnknownKind')).resolves.toEqual({
        valid: false,
        errors: ['No schema found for claim kind: UnknownKind'],
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps two registries over different directories independent', async () => {
    const directoryA = await mkdtemp(join(tmpdir(), 'fs-forge-schema-a-'));
    const directoryB = await mkdtemp(join(tmpdir(), 'fs-forge-schema-b-'));
    try {
      await writeFile(
        join(directoryA, 'FooClaim.json'),
        readFileSync(join(SCHEMAS_DIR, 'ComponentClaim.json'), 'utf8'),
        'utf8',
      );
      await writeFile(
        join(directoryB, 'FooClaim.json'),
        readFileSync(join(SCHEMAS_DIR, 'GroupClaim.json'), 'utf8'),
        'utf8',
      );

      const registryA = createClaimValidator({ schemasDir: directoryA });
      const registryB = createClaimValidator({ schemasDir: directoryB });
      const component = loadYaml(VALID_COMPONENT);
      const group = loadYaml(VALID_GROUP);

      await expect(
        registryA.validate(component, 'FooClaim'),
      ).resolves.toEqual({ valid: true, errors: [] });
      await expect(
        registryB.validate(component, 'FooClaim'),
      ).resolves.toEqual(expect.objectContaining({ valid: false }));

      await expect(registryB.validate(group, 'FooClaim')).resolves.toEqual({
        valid: true,
        errors: [],
      });
      await expect(
        registryA.validate(group, 'FooClaim'),
      ).resolves.toEqual(expect.objectContaining({ valid: false }));
    } finally {
      await rm(directoryA, { recursive: true, force: true });
      await rm(directoryB, { recursive: true, force: true });
    }
  });
});
