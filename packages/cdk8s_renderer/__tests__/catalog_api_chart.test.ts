import { Testing, YamlOutputType } from 'cdk8s';
import * as path from 'path';
import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider, setPath } from '../src/config';
import { createTestContext } from './auxiliar';
import { claimsRefListAsGenerator } from '../src/utils/claimUtils';
import { emptyRenderedClaims } from '../src/refresolver';
import { resetLazyLoader } from '../src/loader/lazy_loader';

describe('CatalogApiChart', () => {
  configureProvider(AllowedProviders.all);

  let context = null;

  beforeAll(async () => {
    context = await createTestContext({
      onlyFiles: [
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

  beforeEach(async () => {
    emptyRenderedClaims();
    resetLazyLoader();
    context = await context.restart();
  });

  afterAll(async () => {
    await context.destroy();
  });

  it('renders an API entity with definition $text URL', async () => {
    setPath('initializers', path.join(__dirname, 'fixtures/initializers'));
    setPath('crs', path.join(__dirname, 'fixtures/base_crs'));
    setPath('globals', path.join(__dirname, 'fixtures/globals'));
    setPath('claims', context.getClaimsDir());
    setPath('claimsDefaults', path.join(__dirname, 'fixtures/initializers'));

    const catalogApp = Testing.app({
      outdir: context.getCatalogOutDir(),
      outputFileExtension: '.yaml',
      yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
    });
    const app = Testing.app({
      outdir: context.getResourcesOutDir(),
      outputFileExtension: '.yaml',
      yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
    });

    await context.applyPatches('component_a', [
      {
        op: 'add',
        path: '/providesApis',
        value: [
          {
            name: 'api-component-a-openapi',
            definitionfile: 'api/openapi/openapi.yaml',
            type: 'openapi',
          },
        ],
      },
    ]);

    await render(
      catalogApp,
      app,
      claimsRefListAsGenerator(['ComponentClaim-component_a']),
    );
    app.synth();
    catalogApp.synth();

    const resource = context.fromYaml(
      await context.getRenderedCatalogCR('API', 'api-component-a-openapi'),
    );

    expect(resource.kind).toBe('API');
    expect(resource.metadata.name).toBe('api-component-a-openapi');
    expect(resource.spec.type).toBe('openapi');
    expect(resource.spec.lifecycle).toBe('production');
    expect(resource.spec.owner).toBe('group:group_a');
    expect(resource.spec.system).toBe('system:system_a');
    expect(resource.spec.definition.$text).toBe(
      'https://github.com/firestartr-test/component_a/blob/main/api/openapi/openapi.yaml',
    );
  });
});
