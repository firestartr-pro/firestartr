import fs from 'fs';
import os from 'os';
import path from 'path';
import common from 'catalog_common';
import YAML from 'yaml';

import { ClaimValidation } from '../src/claims';
import {
  createTestContext,
  RendererTestContext,
  rendererTestFixtures,
} from './auxiliar';

const SCHEMA_ID = 'firestartr.dev://common/OrgRulesetClaim';

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
        'user_a',
        'domain_a',
      ],
    });
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
          actor_slug: 'platform-team',
          bypass_mode: 'always',
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

    ClaimValidation.validateClaim(
      common.io.fromYaml(await context.getFile('orgruleset_a')),
      SCHEMA_ID,
    );
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

    expect(errors[0].instancePath).toBe(
      '/providers/github/bypass_actors/0/actor_type',
    );
  });
});
