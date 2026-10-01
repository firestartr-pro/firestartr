import { Testing, YamlOutputType } from 'cdk8s';
import * as path from 'path';

import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider, setPath } from '../src/config';
import { createTestContext } from './auxiliar';
import { claimsRefListAsGenerator } from '../src/utils/claimUtils';
import { emptyRenderedClaims } from '../src/refresolver';
import { resetLazyLoader } from '../src/loader/lazy_loader';

describe('API entities rendering from ComponentClaim', () => {
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

  it('renders API entities and provides/consumes APIs in the component catalog', async () => {
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
          {
            name: 'api-component-a-asyncapi',
            definitionfile: '/api/asyncapi/asyncapi.yaml',
            type: 'asyncapi',
          },
        ],
      },
      {
        op: 'add',
        path: '/consumesApis',
        value: ['api-remote-a-openapi', 'api-remote-b-asyncapi'],
      },
    ]);

    await render(
      catalogApp,
      app,
      claimsRefListAsGenerator(['ComponentClaim-component_a']),
    );
    app.synth();
    catalogApp.synth();

    const componentDoc = context.fromYaml(
      await context.getRenderedCatalogCR('Component', 'component-a'),
    );
    expect(componentDoc.spec.providesApis).toEqual([
      'api-component-a-openapi',
      'api-component-a-asyncapi',
    ]);
    expect(componentDoc.spec.consumesApis).toEqual([
      'api-remote-a-openapi',
      'api-remote-b-asyncapi',
    ]);
    const openApiDoc = context.fromYaml(
      await context.getRenderedCatalogCR('API', 'api-component-a-openapi'),
    );

    expect(openApiDoc.spec.type).toBe('openapi');
    expect(openApiDoc.spec.lifecycle).toBe('production');
    expect(openApiDoc.spec.owner).toBe('group:group_a');
    expect(openApiDoc.spec.system).toBe('system:system_a');
    expect(openApiDoc.spec.definition.$text).toBe(
      'https://github.com/firestartr-test/component_a/blob/main/api/openapi/openapi.yaml',
    );

    const asyncApiDoc = context.fromYaml(
      await context.getRenderedCatalogCR('API', 'api-component-a-asyncapi'),
    );

    expect(asyncApiDoc.spec.type).toBe('asyncapi');
    expect(asyncApiDoc.spec.definition.$text).toBe(
      'https://github.com/firestartr-test/component_a/blob/main/api/asyncapi/asyncapi.yaml',
    );
  });

});
