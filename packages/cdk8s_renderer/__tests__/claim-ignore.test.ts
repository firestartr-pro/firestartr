import fs from 'node:fs/promises';
import path from 'node:path';
import { createTestContext, RendererTestContext } from './auxiliar';
import {
  generateClaimsMap,
  resolveClaimEntries,
  resolveClaimFilesList,
} from '../src/utils/claimUtils';
import { crawl } from '../src/crawler';
import { TFWorkspaceNormalizer } from '../src/normalizers/tfworkspace';
import { isIgnoredFile } from '../src/utils/fileIgnore';
import { getPath, setPath } from '../src/config';
import {
  loadGlobals,
  loadInitializers,
  loadCRs,
  loadClaimDefaults,
} from '../src/loader/loader';
import { validateClaimAgainstSchema } from '../src/skills/validate-claim-against-schema';

describe('.firestartrignore', () => {
  let context: RendererTestContext;

  beforeEach(async () => {
    context = await createTestContext({});
  });

  afterEach(async () => {
    await context.destroy();
  });

  async function refs(entry = context.getClaimsDir()) {
    const result: string[] = [];
    for await (const ref of resolveClaimEntries([entry])) result.push(ref);
    return result;
  }

  it.each(['', 'contents are not patterns\n[invalid YAML'])(
    'ignores only local YAML regardless of marker contents (%j)',
    async (contents) => {
      await context.addSupportFile(
        'base_claims/tfworkspaces/.firestartrignore',
        contents,
      );
      await context.addSupportFile(
        'base_claims/tfworkspaces/unrelated.yaml',
        '[invalid',
      );
      await context.addSupportFile(
        'base_claims/tfworkspaces/unrelated.yml',
        '[invalid',
      );
      const found = await refs();
      expect(found).not.toContain('TFWorkspaceClaim-workspace_a');
      expect(found).toContain('TFWorkspaceClaim-workspace_c');
      expect(found).toContain('ComponentClaim-component_a');

      const output = path.join(context.getResourcesOutDir(), 'map.json');
      await generateClaimsMap(context.getClaimsDir(), output);
      const map = JSON.parse(await fs.readFile(output, 'utf8'));
      expect(map.claims['TFWorkspaceClaim-workspace_a']).toBeUndefined();
      expect(map.claims['TFWorkspaceClaim-workspace_c']).toBeDefined();

      const file = await context.getFilePath('workspace_a');
      expect(await refs(file)).toEqual([]);
      expect(resolveClaimFilesList(file)).toEqual([]);
    },
  );

  it('does not inherit a marker, and respects independently marked children', async () => {
    await context.addSupportFile('.firestartrignore', '');
    expect(await refs()).toContain('TFWorkspaceClaim-workspace_c');
    await context.addSupportFile(
      'base_claims/tfworkspaces/workspace_c/.firestartrignore',
      '',
    );
    const found = await refs();
    expect(found).not.toContain('TFWorkspaceClaim-workspace_c');
    expect(found).toContain('TFWorkspaceClaim-workspace_a');
  });

  it('ignores only local YAML during generic crawling, but still visits children', async () => {
    await context.addSupportFile(
      'base_claims/tfworkspaces/.firestartrignore',
      '',
    );
    await context.addSupportFile('base_claims/tfworkspaces/config.json', '{}');
    await context.addSupportFile(
      'base_claims/tfworkspaces/script.sh',
      'echo ignored',
    );
    const files: string[] = [];
    await crawl(
      context.getClaimsDir(),
      () => true,
      (file: string) => {
        files.push(file);
      },
    );
    const ignoredDir = path.dirname(await context.getFilePath('workspace_a'));
    expect(files).not.toContain(await context.getFilePath('workspace_a'));
    expect(files).not.toContain(path.join(ignoredDir, '.firestartrignore'));
    expect(files).toContain(path.join(ignoredDir, 'config.json'));
    expect(files).toContain(path.join(ignoredDir, 'script.sh'));
    expect(isIgnoredFile(path.join(ignoredDir, 'config.json'))).toBe(false);
    expect(isIgnoredFile(path.join(ignoredDir, 'script.sh'))).toBe(false);
    expect(files).toContain(await context.getFilePath('workspace_c'));
    expect(files).toContain(await context.getFilePath('component_a'));
  });

  it('keeps Terraform source in marked children of an inline workspace', async () => {
    const root = 'base_claims/tfworkspaces/workspace_c';
    const main = 'output "dependency" { value = local.child_value }';
    const resources = 'locals { child_value = "retained" }';
    await context.addSupportFile(`${root}/main.tf`, main);
    await context.addSupportFile(`${root}/child/.firestartrignore`, '');
    await context.addSupportFile(`${root}/child/resources.tf`, resources);
    await context.addSupportFile(`${root}/child/config.yaml`, '[invalid');
    await context.addSupportFile(`${root}/child/config.yml`, '[invalid');

    const claimPath = await context.getFilePath('workspace_c');
    expect((await validateClaimAgainstSchema({ claimPath })).valid).toBe(true);
    const claim = context.fromYaml(await context.getFile('workspace_c'));
    const normalizer = new TFWorkspaceNormalizer({ path: claimPath });
    let cr: any = { spec: { source: 'Inline' } };
    for (const patch of await normalizer.patches(claim, null)) {
      cr = await patch.apply(cr);
    }
    expect(cr.spec.module).toContain(main);
    expect(cr.spec.module).toContain(resources);
    expect(cr.spec.module).not.toContain('[invalid');
    expect(await refs(path.dirname(claimPath))).toContain(
      'TFWorkspaceClaim-workspace_c',
    );
  });

  it('renders selected claims without parsing ignored matches during lazy lookup', async () => {
    const claimPath = await context.getFilePath('workspace_b');
    expect((await validateClaimAgainstSchema({ claimPath })).valid).toBe(true);
    await context.addSupportFile('unrelated/.firestartrignore', '');
    await context.addSupportFile(
      'unrelated/config.yaml',
      'name: workspace_b\ninvalid: [',
    );
    await expect(
      context.renderClaims({ claimRefs: ['TFWorkspaceClaim-workspace_b'] }),
    ).resolves.toBeDefined();
  });

  it('also excludes globals, initializers, and existing CR files', async () => {
    await context.addSupportFile('config/.firestartrignore', '');
    await context.addSupportFile(
      'config/global_github_repository.yaml',
      '[invalid',
    );
    const configDir = path.join(context.getClaimsDir(), 'config');
    const previousGlobals = getPath('globals');
    const previousDefaults = getPath('claimsDefaults');
    setPath('globals', configDir);
    setPath('claimsDefaults', configDir);
    try {
      await expect(loadGlobals({ kind: 'ComponentClaim' })).resolves.toEqual(
        [],
      );
      await expect(
        loadInitializers({ kind: 'ComponentClaim' }, undefined, configDir),
      ).resolves.toBeDefined();
      await expect(loadCRs(configDir, [])).resolves.toEqual({});
      expect(loadClaimDefaults()).toEqual({});
    } finally {
      setPath('globals', previousGlobals);
      setPath('claimsDefaults', previousDefaults);
    }
  });

  it('does not resolve a referenced claim from an ignored directory', async () => {
    await context.addSupportFile(
      'base_claims/tfworkspaces/.firestartrignore',
      '',
    );
    await expect(
      context.renderClaims({ claimRefs: ['TFWorkspaceClaim-workspace_b'] }),
    ).rejects.toMatch(/TFWorkspaceClaim-workspace_b not found/);
  });
});
