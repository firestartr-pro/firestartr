import {
  createTestContext,
  RendererTestContext,
  rendererTestFixtures,
} from './auxiliar';

function findOrgVariableSectionCr(
  renderedMap: Record<string, any>,
): any | undefined {
  return Object.values(renderedMap).find(
    (cr: any) => cr.kind === 'FirestartrGithubOrganizationVariableSection',
  );
}

function findAllOrgVariableSectionCrs(
  renderedMap: Record<string, any>,
): any[] {
  return Object.values(renderedMap).filter(
    (cr: any) => cr.kind === 'FirestartrGithubOrganizationVariableSection',
  );
}

describe('GitHub organization variable section rendering', () => {
  let context: RendererTestContext;

  beforeEach(async () => {
    context = await createTestContext({ onlyFiles: ['orgsettings_a'] });
  });

  afterEach(async () => {
    await context.destroy();
  });

  it('renders an empty VariableSection CR when actions_variables is absent', async () => {
    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const cr = findOrgVariableSectionCr(renderedMap);

    expect(cr).toBeDefined();
    expect(cr.spec.actionsVariables).toEqual([]);
    expect(cr.spec.org).toBe('firestartr-test');
    expect(cr.metadata.name).toMatch(
      /^firestartr-test-org-settings-[0-9a-f-]{36}$/,
    );
    expect(cr.metadata.labels['claim-ref']).toBe('github-org-settings');
    expect(cr.metadata.annotations['firestartr.dev/claim-ref']).toBe(
      'OrgSettingsClaim/github_org_settings',
    );
    expect(cr.spec.writeConnectionSecretToRef.name).toMatch(
      /^firestartrgithuborganizationvariablesection-firestartr-test-org-settings-[0-9a-f-]{36}-outputs$/,
    );
    expect(cr.spec.writeConnectionSecretToRef.outputs).toEqual([
      { key: 'managed_variables' },
      { key: 'variable_ids' },
    ]);
  });

  it('renders actions_variables with correct field mapping', async () => {
    await context.applyPatches('orgsettings_a', [
      {
        op: 'add',
        path: '/providers/github/actions_variables',
        value: [
          {
            name: 'MY_VAR',
            value: 'some-value',
            visibility: 'all',
          },
          {
            name: 'SELECTED_VAR',
            value: 'repo-scoped-value',
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

    expect(cr).toBeDefined();
    expect(cr.spec.actionsVariables).toHaveLength(2);
    expect(cr.spec.actionsVariables[0]).toMatchObject({
      name: 'MY_VAR',
      value: 'some-value',
      visibility: 'all',
    });
    expect(cr.spec.actionsVariables[1]).toMatchObject({
      name: 'SELECTED_VAR',
      value: 'repo-scoped-value',
      visibility: 'selected',
    });
  });

  it('rejects duplicate VariableSection CRs for same org', async () => {
    await context.duplicateFile('orgsettings_a', 'orgsettings_b');
    await context.applyPatches('orgsettings_b', [
      { op: 'replace', path: '/name', value: 'github_org_settings_b' },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'firestartr-test-org-settings-b',
      },
      {
        op: 'replace',
        path: '/providers/github/org',
        value: 'firestartr-test-b',
      },
    ]);
    await context.duplicateFile('orgsettings_a', 'orgsettings_c');
    await context.applyPatches('orgsettings_c', [
      { op: 'replace', path: '/name', value: 'github_org_settings_c' },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'firestartr-test-org-settings-c',
      },
    ]);

    // Two claims share org=fixed-org via claim_c and claim_d
    // using applyPatches after duplication
    await context.duplicateFile('orgsettings_a', 'orgsettings_d');
    await context.applyPatches('orgsettings_d', [
      { op: 'replace', path: '/name', value: 'github_org_settings_d' },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'firestartr-test-org-settings-d',
      },
      {
        op: 'replace',
        path: '/providers/github/org',
        value: 'firestartr-test',
      },
    ]);

    await expect(
      context.renderClaims(
        {
          claimRefs: [
            'OrgSettingsClaim-github_org_settings',
            'OrgSettingsClaim-github_org_settings_b',
            'OrgSettingsClaim-github_org_settings_c',
            'OrgSettingsClaim-github_org_settings_d',
          ],
        },
        { crsPath: rendererTestFixtures.noCrs },
      ),
    ).rejects.toThrow(/Duplicate/);
  });

  it('rejects duplicate variable names within actions_variables', async () => {
    await context.applyPatches('orgsettings_a', [
      {
        op: 'add',
        path: '/providers/github/actions_variables',
        value: [
          {
            name: 'MY_VAR',
            value: 'value1',
            visibility: 'all',
          },
          {
            name: 'MY_VAR',
            value: 'value2',
            visibility: 'private',
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
      /Duplicate action variable name "MY_VAR" found in FirestartrGithubOrganizationVariableSection for organization "firestartr-test"/,
    );
  });

  it('allows VariableSection CRs for different orgs', async () => {
    await context.duplicateFile('orgsettings_a', 'orgsettings_b');
    await context.applyPatches('orgsettings_b', [
      { op: 'replace', path: '/name', value: 'github_org_settings_b' },
      {
        op: 'replace',
        path: '/providers/github/name',
        value: 'firestartr-test-org-settings-b',
      },
      {
        op: 'replace',
        path: '/providers/github/org',
        value: 'firestartr-test-b',
      },
    ]);

    const { renderedMap } = await context.renderClaims(
      {
        claimRefs: [
          'OrgSettingsClaim-github_org_settings',
          'OrgSettingsClaim-github_org_settings_b',
        ],
      },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const variableSectionCrs = findAllOrgVariableSectionCrs(renderedMap);

    expect(variableSectionCrs).toHaveLength(2);
    expect(variableSectionCrs.map((cr) => cr.spec.org).sort()).toEqual([
      'firestartr-test',
      'firestartr-test-b',
    ]);
  });

  it('renders VariableSection CR with distinct tfStateKey from OrgSettings CR', async () => {
    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const orgSettingsCr = (Object.values(renderedMap) as any[]).find(
      (cr: any) => cr.kind === 'FirestartrGithubOrganizationSettings',
    );
    const variableSectionCr = findOrgVariableSectionCr(renderedMap);

    expect(orgSettingsCr).toBeDefined();
    expect(variableSectionCr).toBeDefined();
    expect(orgSettingsCr.spec.firestartr.tfStateKey).not.toBe(
      variableSectionCr.spec.firestartr.tfStateKey,
    );
  });

  it('does not feed back actionsVariables from the previous CR (one-way definition)', async () => {
    await context.applyPatches('orgsettings_a', [
      {
        op: 'add',
        path: '/providers/github/actions_variables',
        value: [
          { name: 'KEEP_VAR', value: 'original', visibility: 'all' },
          { name: 'DROP_VAR', value: 'drop-me', visibility: 'private' },
        ],
      },
    ]);

    const first = await context.renderClaims(
      { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const firstCr = findOrgVariableSectionCr(first.renderedMap);

    expect(firstCr).toBeDefined();
    expect(firstCr.spec.actionsVariables).toHaveLength(2);

    await context.applyPatches('orgsettings_a', [
      {
        op: 'replace',
        path: '/providers/github/actions_variables',
        value: [{ name: 'KEEP_VAR', value: 'changed', visibility: 'all' }],
      },
    ]);

    const second = await context.renderClaims(
      { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
      { crsPath: context.getResourcesOutDir() },
    );

    const secondCr = findOrgVariableSectionCr(second.renderedMap);

    expect(secondCr).toBeDefined();
    expect(secondCr.spec.actionsVariables).toHaveLength(1);
    expect(secondCr.spec.actionsVariables[0]).toMatchObject({
      name: 'KEEP_VAR',
      value: 'changed',
      visibility: 'all',
    });
    expect(secondCr.metadata.name).toBe(firstCr.metadata.name);
    expect(secondCr.spec.firestartr.tfStateKey).toBe(
      firstCr.spec.firestartr.tfStateKey,
    );
  });

  it('throws when a referenced component has no GitHub provider', async () => {
    await context.applyPatches('orgsettings_a', [
      {
        op: 'add',
        path: '/providers/github/actions_variables',
        value: [
          {
            name: 'MY_VAR',
            value: 'val',
            visibility: 'selected',
            selected_repositories: ['component:nonexistent'],
          },
        ],
      },
    ]);

    let error: string | null = null;
    try {
      await context.renderClaims(
        { claimRefs: ['OrgSettingsClaim-github_org_settings'] },
        { crsPath: rendererTestFixtures.noCrs },
      );
    } catch (e: any) {
      error = String(e);
    }
    expect(error).not.toBeNull();
    expect(error).toMatch(/ComponentClaim-nonexistent not found/);
  });
});

describe('GitHub organization variable section rendering with component refs', () => {
  let context: RendererTestContext;

  beforeEach(async () => {
    context = await createTestContext({
      onlyFiles: [
        'orgsettings_a',
        'component_a',
        'system_a',
        'domain_a',
        'group_a',
        'group_b',
        'group_c',
        'user_a',
      ],
    });
  });

  afterEach(async () => {
    await context.destroy();
  });

  it('resolves selected_repositories component refs to org/repo names', async () => {
    await context.applyPatches('orgsettings_a', [
      {
        op: 'add',
        path: '/providers/github/actions_variables',
        value: [
          {
            name: 'SELECTED_VAR',
            value: 'value',
            visibility: 'selected',
            selected_repositories: ['component:component_a'],
          },
        ],
      },
    ]);

    const { renderedMap } = await context.renderClaims(
      {
        claimRefs: [
          'ComponentClaim-component_a',
          'OrgSettingsClaim-github_org_settings',
        ],
      },
      { crsPath: rendererTestFixtures.noCrs },
    );

    const cr = findOrgVariableSectionCr(renderedMap);

    expect(cr).toBeDefined();
    expect(cr.spec.actionsVariables).toHaveLength(1);
    expect(cr.spec.actionsVariables[0]).toMatchObject({
      name: 'SELECTED_VAR',
      value: 'value',
      visibility: 'selected',
      selectedRepositories: ['firestartr-test/component_a'],
    });
  });
});
