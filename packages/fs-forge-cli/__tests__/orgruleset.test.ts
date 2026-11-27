import { describe, expect, it } from '@jest/globals';
import { claimSchemasDir, loadClaimSchema } from '../src/schema/claimSchemas';
import { createClaimValidator } from '../src/utils/ajvValidation';
import { buildClaimFromFlags } from '../src/utils/buildClaim';
import { deriveFlags } from '../src/utils/deriveFlags';
import CreateOrgRuleset from '../src/commands/create/orgruleset';

const SCHEMA_DIR = claimSchemasDir(process.cwd());
const validator = createClaimValidator({ schemasDir: SCHEMA_DIR });
const flags = deriveFlags(loadClaimSchema(SCHEMA_DIR, 'OrgRulesetClaim'));

const REQUIRED_FLAGS = {
  name: 'default-branch',
  kind: 'OrgRulesetClaim',
  system: 'system:platform',
  owner: 'group:platform',
  'providers.github.name': 'Default branch',
  'providers.github.org': 'my-org',
  'providers.github.target': 'branch',
  'providers.github.enforcement': 'active',
};

describe('OrgRulesetClaim', () => {
  it('exposes every condition object through a JSON flag', () => {
    const paths = flags.map((flag) => flag.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        'providers.github.conditions.ref_name.json',
        'providers.github.conditions.repository_name.json',
        'providers.github.conditions.repository_property.json',
      ]),
    );
    expect(CreateOrgRuleset.flags).toHaveProperty([
      'providers.github.conditions.ref_name.json',
    ]);
  });

  it('creates a valid GitHub-backed ruleset from the generated flags', async () => {
    const claim = buildClaimFromFlags(
      {
        ...REQUIRED_FLAGS,
        'providers.github.conditions.ref_name.json':
          '{"include":["~DEFAULT_BRANCH"],"exclude":[]}',
        'providers.github.conditions.repository_name.json':
          '{"include":["~ALL"],"exclude":["component:legacy"]}',
        'providers.github.rules.json': '[{"type":"deletion"}]',
      },
      flags,
      ['providers'],
    );

    expect(claim).toMatchObject({
      providers: {
        github: {
          conditions: {
            ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] },
            repository_name: {
              include: ['~ALL'],
              exclude: ['component:legacy'],
            },
          },
        },
      },
    });
    expect((await validator.validate(claim, 'OrgRulesetClaim')).valid).toBe(
      true,
    );
  });

  it('still rejects a GitHub provider without conditions', async () => {
    const claim = buildClaimFromFlags(REQUIRED_FLAGS, flags, ['providers']);

    expect((await validator.validate(claim, 'OrgRulesetClaim')).valid).toBe(
      false,
    );
  });
});
