import YAML from 'yaml';
import { extractAllRefs } from '../src/refsSorter/refsExtractor';
import {
  createTestContext,
  RendererTestContext,
  rendererTestFixtures,
} from './auxiliar';

const SECRET_REF_VAR = {
  name: 'DEPLOY_HOST',
  value: 'ref:secretsclaim:secret_a:rds_conn',
  visibility: 'all',
};

const PLAIN_VAR = {
  name: 'PLAIN_FLAG',
  value: 'true',
  visibility: 'private',
};

function findOrgVariableSectionCr(renderedMap: Record<string, any>): any {
  return Object.values(renderedMap).find(
    (cr: any) => cr.kind === 'FirestartrGithubOrganizationVariableSection',
  );
}

describe('GitHub organization variables with SecretsClaim refs', () => {
  let context: RendererTestContext;

  afterEach(async () => {
    await context.destroy();
  });

  describe('rendering', () => {
    beforeEach(async () => {
      context = await createTestContext({
        onlyFiles: [
          'orgsettings_a',
          'secret_a',
          'system_a',
          'domain_a',
          'user_a',
          'group_a',
        ],
      });
    });

    it('renders a ref for secret values and a value for plain values', async () => {
      await context.applyPatches('orgsettings_a', [
        {
          op: 'add',
          path: '/providers/github/actions_variables',
          value: [SECRET_REF_VAR, PLAIN_VAR],
        },
      ]);

      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
        { crsPath: rendererTestFixtures.noCrs },
      );

      const cr = findOrgVariableSectionCr(renderedMap);

      expect(cr.spec.actionsVariables).toEqual([
        {
          name: 'DEPLOY_HOST',
          ref: { kind: 'Secret', name: 'secret-a', key: 'rds_conn' },
          visibility: 'all',
        },
        {
          name: 'PLAIN_FLAG',
          value: 'true',
          visibility: 'private',
        },
      ]);
    });

    it('keeps refs for selected visibility', async () => {
      await context.applyPatches('orgsettings_a', [
        {
          op: 'add',
          path: '/providers/github/actions_variables',
          value: [
            {
              name: 'SELECTED_HOST',
              value: 'ref:secretsclaim:secret_a:rds_conn',
              visibility: 'selected',
              selected_repositories: [],
            },
          ],
        },
      ]);

      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
        { crsPath: rendererTestFixtures.noCrs },
      );

      const cr = findOrgVariableSectionCr(renderedMap);

      expect(cr.spec.actionsVariables[0]).toEqual({
        name: 'SELECTED_HOST',
        ref: { kind: 'Secret', name: 'secret-a', key: 'rds_conn' },
        visibility: 'selected',
      });
    });

    it('fails when the referenced secret key is not declared', async () => {
      await context.applyPatches('orgsettings_a', [
        {
          op: 'add',
          path: '/providers/github/actions_variables',
          value: [
            {
              ...SECRET_REF_VAR,
              value: 'ref:secretsclaim:secret_a:does_not_exist',
            },
          ],
        },
      ]);

      await expect(
        context.renderClaims(
          { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
          { crsPath: rendererTestFixtures.noCrs },
        ),
      ).rejects.toThrow(
        /OrgSettingsClaim\/github_org_settings references a non-existent secret key "does_not_exist" in SecretsClaim\/secret_a via actions_variables\.DEPLOY_HOST/,
      );
    });

    it('fails when the referenced key is only a push secret', async () => {
      await context.applyPatches('orgsettings_a', [
        {
          op: 'add',
          path: '/providers/github/actions_variables',
          value: [
            {
              ...SECRET_REF_VAR,
              value: 'ref:secretsclaim:secret_a:my-postgres',
            },
          ],
        },
      ]);

      await expect(
        context.renderClaims(
          { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
          { crsPath: rendererTestFixtures.noCrs },
        ),
      ).rejects.toThrow(
        /OrgSettingsClaim\/github_org_settings references a non-existent secret key "my-postgres" in SecretsClaim\/secret_a via actions_variables\.DEPLOY_HOST/,
      );
    });
  });

  describe('when the referenced SecretsClaim is missing', () => {
    beforeEach(async () => {
      context = await createTestContext({ onlyFiles: ['orgsettings_a'] });
    });

    it('fails naming the missing SecretsClaim and the variable', async () => {
      await context.applyPatches('orgsettings_a', [
        {
          op: 'add',
          path: '/providers/github/actions_variables',
          value: [SECRET_REF_VAR],
        },
      ]);

      const error = await context
        .renderClaims(
          { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
          { crsPath: rendererTestFixtures.noCrs },
        )
        .catch((e) => e);

      expect(String(error)).toMatch(/SecretsClaim-secret_a not found/);
    });
  });

  describe('refs extraction', () => {
    beforeEach(async () => {
      context = await createTestContext({ onlyFiles: ['orgsettings_a'] });
    });

    it('adds the SecretsClaim of each secret ref in actions_variables', async () => {
      const claim = YAML.parse(await context.getFile('orgsettings_a'));
      claim.providers.github.actions_variables = [SECRET_REF_VAR, PLAIN_VAR];

      const refs = extractAllRefs(YAML.stringify(claim));

      expect(refs).toContain('SecretsClaim-secret_a');
      expect(refs.filter((ref) => ref.startsWith('SecretsClaim-'))).toEqual([
        'SecretsClaim-secret_a',
      ]);
    });
  });
});
