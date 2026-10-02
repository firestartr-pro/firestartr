import { Testing, YamlOutputType } from 'cdk8s';
import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider, setExcludedPaths, setPath } from '../src/config';
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { emptyRenderedClaims } from '../src/refresolver';
import { resetLazyLoader } from "../src/loader/lazy_loader";

import {
  claimsRefListAsGenerator,
  resolveClaimEntries,
} from '../src/utils/claimUtils';

import { createTestContext } from "./auxiliar";

describe('CDK8s Renderer', () => {
  jest.setTimeout(30000);
  configureProvider(AllowedProviders.all)

  const outDirPath: string = fs.mkdtempSync(path.join(os.tmpdir(), ".resourcesCDK8s-"));

  afterAll(() => fs.rmSync(outDirPath, { recursive: true, force: true }));

  process.env['ORG'] = 'firestartr-test'

  let context = null

  beforeAll(async () => {
    context = await createTestContext({})
  })

  beforeEach(async () => {
    emptyRenderedClaims()
    fs.rmSync(outDirPath, { recursive: true, force: true });
  });

  beforeEach(async () => {
    resetLazyLoader()
    await context.restart()
  })

  it('Is able to render charts', async () => {

    setPath("initializers", path.join(__dirname, "fixtures/initializers"))
    setPath("crs", path.join(__dirname, "fixtures/crs"))
    setPath("globals", path.join(__dirname, "fixtures/globals"))
    setPath("claims", context.getClaimsDir())
    setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))
    setExcludedPaths([path.join(__dirname, "fixtures/crs/.github")])

    await context.applyPatches(
      "component_a",
      [
        {
          op: "add",
          path: "/annotations",
          value: {
          
              "firestartr.io/test": "test",
              "firestartr.io/test2": "test2",
          
          }
        }
      ]
    )

    const catalogApp = Testing.app({
      outdir: "/tmp/.catalog",
      outputFileExtension: ".yaml",
      yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
    });

    const app = Testing.app({
      outdir: context.getResourcesOutDir(),
      outputFileExtension: ".yaml",
      yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
    });

    await render(catalogApp, app, await claimsRefListAsGenerator(['ComponentClaim-component_a']))


    app.synth()
    catalogApp.synth()

    expect(await context.testRenderedCR(

        'FirestartrGithubRepository',
        "component-a",

        {
            op: "test",

            path: "/metadata/annotations/firestartr.io~1test",

            value: "test"
        },
    )).toBe(true)
  });

})
