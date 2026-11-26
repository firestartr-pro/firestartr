import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';

import { validateClaimAgainstSchema } from '../src/skills/validate-claim-against-schema';
import {
  createTestContext,
  RendererTestContext,
  rendererTestFixtures,
} from './auxiliar';

const SCHEMA_ID = 'firestartr.dev://common/OrgRulesetClaim';

const COMPONENT_CLAIM = `kind: ComponentClaim
version: '1.0'
type: service
lifecycle: production
system: 'system:system_a'
owner: 'group:group_a'
platformOwner: 'group:group_a'
name: orgruleset_component
providers:
  github:
    name: orgruleset-component-repo
    org: firestartr-test
    visibility: private
    branchStrategy:
      name: none
      defaultBranch: main
`;

function findRulesetCr(
  renderedMap: Record<string, any>,
  displayName: string,
): any | undefined {
  return Object.values(renderedMap).find(
    (cr: any) =>
      cr.kind === 'FirestartrGithubOrgRuleset' &&
      cr.metadata.annotations['firestartr.dev/external-name'] === displayName,
  );
}

describe('GitHub organization ruleset rendering', () => {
  let context: RendererTestContext;

  beforeEach(async () => {
    context = await createTestContext({
      onlyFiles: [
        'orgruleset_a',
        'orgruleset_property_a',
        'system_a',
        'group_a',
        'group_b',
        'user_a',
        'domain_a',
      ],
    });

    // Kept out of base_claims so the shared claims-map fixture stays stable.
    await context.addSupportFile(
      'components/orgruleset_component.yaml',
      COMPONENT_CLAIM,
    );
  });

  afterEach(async () => {
    await context.destroy();
  });

  async function render() {
    return context.renderClaims(undefined, {
      crsPath: rendererTestFixtures.noCrs,
    });
  }

  it('renders a branch ruleset targeting repositories by name', async () => {
    const { renderedMap } = await render();

    const cr = findRulesetCr(
      renderedMap,
      'Standard - Default Branch Protection',
    );

    expect(cr).toBeDefined();
    expect(cr.metadata.name).toMatch(
      /^standard---default-branch-protection-[0-9a-f-]{36}$/,
    );
    expect(cr.metadata.labels['claim-ref']).toBe('orgruleset-a');
    expect(cr.metadata.annotations['firestartr.dev/claim-ref']).toBe(
      'OrgRulesetClaim/orgruleset_a',
    );
    expect(cr.spec.org).toBe('firestartr-test');

    const groupCr: any = Object.values(renderedMap).find(
      (entry: any) =>
        entry.kind === 'FirestartrGithubGroup' &&
        entry.metadata.annotations['firestartr.dev/external-name'] ===
          'group-b',
    );

    expect(groupCr).toBeDefined();
    expect(cr.spec.ruleset).toEqual({
      name: 'Standard - Default Branch Protection',
      target: 'branch',
      enforcement: 'active',
      conditions: {
        ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] },
        repository_name: { include: ['~ALL'], exclude: ['legacy-*'] },
      },
      rules: [
        { type: 'deletion' },
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 1,
            dismiss_stale_reviews_on_push: true,
          },
        },
      ],
      bypass_actors: [
        {
          actor_type: 'Team',
          bypass_mode: 'always',
          ref: {
            kind: 'FirestartrGithubGroup',
            name: groupCr.metadata.name,
            needsSecret: true,
          },
        },
        { actor_type: 'OrganizationAdmin', bypass_mode: 'pull_request' },
      ],
    });
    expect(cr.spec.firestartr.tfStateKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(cr.spec.context.provider.ref.name).toBe('github-app');
    expect(cr.spec.writeConnectionSecretToRef.outputs).toEqual([
      { key: 'ruleset_id' },
      { key: 'node_id' },
      { key: 'etag' },
    ]);
  });

  it('renders an evaluate ruleset targeting repositories by property', async () => {
    const { renderedMap } = await render();

    const cr = findRulesetCr(
      renderedMap,
      'Strict - Main Branch (regulated repos)',
    );

    expect(cr.spec.ruleset.enforcement).toBe('evaluate');
    expect(cr.spec.ruleset.conditions.repository_property).toEqual({
      include: [
        {
          name: 'data-classification',
          source: 'custom',
          property_values: ['regulated', 'pci'],
        },
      ],
      exclude: [],
    });
  });

  it('resolves component refs in repository_name.include', async () => {
    await context.applyPatches('orgruleset_a', [
      {
        op: 'replace',
        path: '/providers/github/conditions/repository_name',
        value: {
          include: ['component:orgruleset_component', 'test-*'],
          exclude: ['legacy-*'],
        },
      },
    ]);

    const { renderedMap } = await render();

    const cr = findRulesetCr(
      renderedMap,
      'Standard - Default Branch Protection',
    );

    expect(cr.spec.ruleset.conditions.repository_name).toEqual({
      include: ['orgruleset-component-repo', 'test-*'],
      exclude: ['legacy-*'],
    });
  });

  it('resolves component refs in repository_name.exclude', async () => {
    await context.applyPatches('orgruleset_a', [
      {
        op: 'replace',
        path: '/providers/github/conditions/repository_name',
        value: {
          include: ['test-*'],
          exclude: ['component:orgruleset_component'],
        },
      },
    ]);

    const { renderedMap } = await render();

    const cr = findRulesetCr(
      renderedMap,
      'Standard - Default Branch Protection',
    );

    expect(cr.spec.ruleset.conditions.repository_name).toEqual({
      include: ['test-*'],
      exclude: ['orgruleset-component-repo'],
    });
  });

  it('rejects a repository component from another organization', async () => {
    await context.applyPatches('orgruleset_component', [
      { op: 'replace', path: '/providers/github/org', value: 'other-org' },
    ]);
    await context.applyPatches('orgruleset_a', [
      {
        op: 'replace',
        path: '/providers/github/conditions/repository_name',
        value: { include: ['component:orgruleset_component'], exclude: [] },
      },
    ]);

    await expect(render()).rejects.toThrow(
      /Referenced component "orgruleset_component" belongs to organization "other-org"/,
    );
  });

  it('rejects a repository component that does not exist', async () => {
    await context.applyPatches('orgruleset_a', [
      {
        op: 'replace',
        path: '/providers/github/conditions/repository_name',
        value: { include: ['component:missing_component'], exclude: [] },
      },
    ]);

    await expect(render()).rejects.toMatch(
      /ComponentClaim-missing_component not found/,
    );
  });

  it('loads a repository component when only the ruleset claim is selected', async () => {
    await context.applyPatches('orgruleset_a', [
      {
        op: 'replace',
        path: '/providers/github/conditions/repository_name',
        value: { include: ['component:orgruleset_component'], exclude: [] },
      },
    ]);

    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['OrgRulesetClaim-orgruleset_a'] },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const cr = findRulesetCr(
      renderedMap,
      'Standard - Default Branch Protection',
    );

    expect(cr.spec.ruleset.conditions.repository_name.include).toEqual([
      'orgruleset-component-repo',
    ]);
    expect(
      Object.values(renderedMap).some(
        (entry: any) =>
          entry.kind === 'FirestartrGithubRepository' &&
          entry.metadata.annotations?.['firestartr.dev/external-name'] ===
            'orgruleset-component-repo',
      ),
    ).toBe(true);
  });

  it('does not bring back list entries removed from the claim when a previous CR exists', async () => {
    const { renderedMap: first } = await render();

    const previous = findRulesetCr(
      first,
      'Standard - Default Branch Protection',
    );
    const previousCrsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'previous-ruleset-crs-'),
    );
    fs.writeFileSync(
      path.join(
        previousCrsDir,
        `FirestartrGithubOrgRuleset.${previous.metadata.name}.yaml`,
      ),
      YAML.stringify(previous),
    );

    try {
      await context.applyPatches('orgruleset_a', [
        {
          op: 'replace',
          path: '/providers/github/conditions/repository_name',
          value: { include: [], exclude: [] },
        },
        { op: 'remove', path: '/providers/github/rules/0' },
        { op: 'replace', path: '/providers/github/bypass_actors', value: [] },
      ]);

      const { renderedMap } = await context.renderClaims(undefined, {
        crsPath: previousCrsDir,
      });

      const cr = findRulesetCr(
        renderedMap,
        'Standard - Default Branch Protection',
      );

      expect(cr.metadata.name).toBe(previous.metadata.name);
      expect(cr.spec.ruleset.conditions.repository_name).toEqual({
        include: [],
        exclude: [],
      });
      expect(cr.spec.ruleset.rules).toEqual([
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 1,
            dismiss_stale_reviews_on_push: true,
          },
        },
      ]);
      expect(cr.spec.ruleset.bypass_actors).toEqual([]);
    } finally {
      fs.rmSync(previousCrsDir, { recursive: true, force: true });
    }
  });

  it('loads the referenced group claim when only the ruleset claim is selected', async () => {
    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['OrgRulesetClaim-orgruleset_a'] },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const cr = findRulesetCr(
      renderedMap,
      'Standard - Default Branch Protection',
    );
    const groupRef = cr.spec.ruleset.bypass_actors[0].ref;

    expect(groupRef.kind).toBe('FirestartrGithubGroup');
    expect(
      Object.values(renderedMap).some(
        (entry: any) =>
          entry.kind === 'FirestartrGithubGroup' &&
          entry.metadata.name === groupRef.name,
      ),
    ).toBe(true);
  });

  it('rejects a Team bypass actor from another organization', async () => {
    await context.applyPatches('orgruleset_a', [
      { op: 'replace', path: '/providers/github/org', value: 'other-org' },
    ]);

    await expect(render()).rejects.toThrow(
      /belongs to organization "firestartr-test" but the ruleset targets "other-org"/,
    );
  });

  it('renders a tag ruleset', async () => {
    await context.applyPatches('orgruleset_a', [
      { op: 'replace', path: '/providers/github/target', value: 'tag' },
    ]);

    const { renderedMap } = await render();

    expect(
      findRulesetCr(renderedMap, 'Standard - Default Branch Protection').spec
        .ruleset.target,
    ).toBe('tag');
  });

  it('renders a push ruleset without ref_name', async () => {
    await context.applyPatches('orgruleset_a', [
      { op: 'replace', path: '/providers/github/target', value: 'push' },
      { op: 'remove', path: '/providers/github/conditions/ref_name' },
      {
        op: 'replace',
        path: '/providers/github/rules',
        value: [{ type: 'max_file_size', parameters: { max_file_size: 10 } }],
      },
    ]);

    const { renderedMap } = await render();

    const cr = findRulesetCr(
      renderedMap,
      'Standard - Default Branch Protection',
    );

    expect(cr.spec.ruleset.target).toBe('push');
    expect(cr.spec.ruleset.conditions.ref_name).toBeUndefined();
  });

  it('bounds the connection secret name for long ruleset names', async () => {
    // 185 characters keeps the CR file name under the filesystem limit while
    // still overflowing the 253-character Secret name.
    const longName = 'a'.repeat(185);

    await context.applyPatches('orgruleset_a', [
      { op: 'replace', path: '/providers/github/name', value: longName },
    ]);

    const { renderedMap } = await render();

    const cr = findRulesetCr(renderedMap, longName);

    expect(cr.metadata.name).toHaveLength(222);
    expect(cr.spec.writeConnectionSecretToRef.name).toHaveLength(253);
    expect(cr.spec.writeConnectionSecretToRef.name).toMatch(
      new RegExp(
        `^firestartrgithuborgruleset-a{181}-${cr.spec.firestartr.tfStateKey}-outputs$`,
      ),
    );
  });

  it('keeps the CR filename within the filesystem length limit', async () => {
    const longName = 'a'.repeat(186);

    await context.applyPatches('orgruleset_a', [
      { op: 'replace', path: '/providers/github/name', value: longName },
    ]);

    const { renderedMap } = await render();
    const cr = findRulesetCr(renderedMap, longName);
    const fileName = `FirestartrGithubOrgRuleset.${cr.metadata.name}.yaml`;

    expect(Buffer.byteLength(fileName)).toBe(255);
    expect(fs.readdirSync(context.getResourcesOutDir())).toContain(fileName);
  });

  it('renders a catalog Resource of type ruleset', async () => {
    const { renderedMap } = await render();

    const entity: any = Object.values(renderedMap).find(
      (cr: any) => cr.kind === 'Resource' && cr.spec.type === 'ruleset',
    );

    expect(entity.metadata.name).toBe('orgruleset-a');
    expect(entity.spec.owner).toBe('group:group_a');
    expect(entity.spec.system).toBe('system:system_a');
  });
});

describe('OrgRulesetClaim schema', () => {
  let context: RendererTestContext;

  beforeEach(async () => {
    context = await createTestContext({ onlyFiles: ['orgruleset_a'] });
  });

  afterEach(async () => {
    await context.destroy();
  });

  async function validate(patches: any[]) {
    await context.applyPatches('orgruleset_a', patches);

    const result = await validateClaimAgainstSchema({
      claimPath: await context.getFilePath('orgruleset_a'),
      schemaType: SCHEMA_ID,
    });

    if (!result.valid) throw result.errors;
  }

  it('accepts a valid claim', async () => {
    await expect(validate([])).resolves.toBeUndefined();
  });

  it('rejects a name with path separators', async () => {
    const errors = await validate([
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'rules/../../escaped-workspace',
      },
    ]).catch((e) => e);

    expect(errors[0].instancePath).toBe('/providers/github/name');
    expect(errors[0].message).toMatch(/pattern/);
  });

  it('rejects a ruleset name that exceeds the CR filename length limit', async () => {
    const errors = await validate([
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'a'.repeat(187),
      },
    ]).catch((e) => e);

    expect(errors[0].instancePath).toBe('/providers/github/name');
    expect(errors[0].message).toMatch(/maximum|more than 186/);
  });

  it('rejects an unknown rule type and lists the known ones', async () => {
    const errors = await validate([
      {
        op: 'add',
        path: '/providers/github/rules/-',
        value: { type: 'made_up_rule' },
      },
    ]).catch((e) => e);

    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/providers/github/rules/2/type');
    expect(errors[0].params.allowedValues).toContain('pull_request');
  });

  it('rejects a branch ruleset without ref_name', async () => {
    const errors = await validate([
      { op: 'remove', path: '/providers/github/conditions/ref_name' },
    ]).catch((e) => e);

    expect(errors[0].message).toBe("must have required property 'ref_name'");
  });

  it('rejects an invalid enforcement', async () => {
    const errors = await validate([
      { op: 'replace', path: '/providers/github/enforcement', value: 'maybe' },
    ]).catch((e) => e);

    expect(errors[0].instancePath).toBe('/providers/github/enforcement');
  });

  it('rejects an unknown bypass actor type', async () => {
    const errors = await validate([
      {
        op: 'replace',
        path: '/providers/github/bypass_actors/0/actor_type',
        value: 'Robot',
      },
    ]).catch((e) => e);

    expect(
      errors.some((error: any) =>
        error.instancePath.startsWith('/providers/github/bypass_actors/0'),
      ),
    ).toBe(true);
  });

  it('rejects a Team bypass actor without a group reference', async () => {
    const errors = await validate([
      {
        op: 'replace',
        path: '/providers/github/bypass_actors/0',
        value: { actor_type: 'Team', bypass_mode: 'always' },
      },
    ]).catch((e) => e);

    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some(
        (error: any) =>
          /group/.test(error.message) ||
          error.params?.missingProperty === 'group',
      ),
    ).toBe(true);
  });

  it('rejects a Team bypass actor that also carries a slug', async () => {
    const errors = await validate([
      {
        op: 'replace',
        path: '/providers/github/bypass_actors/0',
        value: {
          actor_type: 'Team',
          group: 'group:group_b',
          actor_slug: 'platform-team',
          bypass_mode: 'always',
        },
      },
    ]).catch((e) => e);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a RepositoryRole bypass actor by role', async () => {
    await expect(
      validate([
        {
          op: 'add',
          path: '/providers/github/bypass_actors/-',
          value: {
            actor_type: 'RepositoryRole',
            actor_role: 'admin',
            bypass_mode: 'always',
          },
        },
      ]),
    ).resolves.toBeUndefined();
  });

  it('accepts an Integration bypass actor by slug', async () => {
    await expect(
      validate([
        {
          op: 'add',
          path: '/providers/github/bypass_actors/-',
          value: {
            actor_type: 'Integration',
            actor_slug: 'release-bot',
            bypass_mode: 'always',
          },
        },
      ]),
    ).resolves.toBeUndefined();
  });

  it('rejects an Integration bypass actor without a slug or id', async () => {
    const errors = await validate([
      {
        op: 'add',
        path: '/providers/github/bypass_actors/-',
        value: { actor_type: 'Integration', bypass_mode: 'always' },
      },
    ]).catch((e) => e);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a group reference on a non-Team bypass actor', async () => {
    const errors = await validate([
      {
        op: 'add',
        path: '/providers/github/bypass_actors/-',
        value: {
          actor_type: 'OrganizationAdmin',
          group: 'group:group_b',
          bypass_mode: 'always',
        },
      },
    ]).catch((e) => e);

    expect(errors.length).toBeGreaterThan(0);
  });
});
