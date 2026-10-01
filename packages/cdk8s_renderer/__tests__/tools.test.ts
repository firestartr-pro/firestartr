import {spawnSync} from 'node:child_process';
import path from 'node:path';

import {AllowedProviders, reconfigureProvider} from '../src/config';
import {createTestContext, type RendererTestContext} from './auxiliar';

describe('renderer validation tools', () => {
  let ctx: RendererTestContext | undefined;

  afterEach(async () => {
    reconfigureProvider(AllowedProviders.all);
    await ctx?.destroy();
    ctx = undefined;
  });

  it('patch-claim clones and patches a base claim copy', async () => {
    ctx = await createTestContext({paths: ['groups']});
    const sourcePath = await ctx.getFilePath('group_a');
    const resultPath = path.join(path.dirname(sourcePath), 'group_a_tool.yaml');

    const result = spawnSync(
      process.execPath,
      [
        'tools/patch-claim.mjs',
        sourcePath,
        '--patch',
        '{"op":"replace","path":"/name","value":"group_a_tool"}',
        '--flag',
        'clone',
        '--result-path',
        resultPath,
      ],
      {encoding: 'utf-8'},
    );

    expect(result.status).toBe(0);
    expect(await ctx.getFile('group_a_tool')).toContain('name: group_a_tool');
  });

  it('render-claims help does not require feature credentials', () => {
    const result = spawnSync(
      process.execPath,
      ['tools/render-claims.cjs', '--help'],
      {encoding: 'utf-8'},
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: node tools/render-claims.cjs');
    expect(`${result.stdout}${result.stderr}`).not.toContain('PREFAPP_BOT_PAT');
  });

  it('catalog provider renders catalog entities only', async () => {
    reconfigureProvider(AllowedProviders.catalog);
    ctx = await createTestContext({paths: ['groups', 'users']});
    const groupPath = await ctx.getFilePath('group_a');

    await ctx.renderClaims({entries: [groupPath]});

    expect(await ctx.getRenderedCatalogCR('Group', 'group-a')).toBeDefined();
    expect(await ctx.getRenderedCR('FirestartrGithubGroup', 'group-a')).toBeUndefined();
  });
});
