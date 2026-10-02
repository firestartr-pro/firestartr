import { Testing, YamlOutputType } from 'cdk8s';
import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider, setPath } from '../src/config';
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { emptyRenderedClaims } from '../src/refresolver';

import { resetLazyLoader } from "../src/loader/lazy_loader";

import {
  claimsRefListAsGenerator,
  resolveClaimEntries,
} from '../src/utils/claimUtils';

describe('CDK8s Renderer', () => {

  jest.setTimeout(30000);

  configureProvider(AllowedProviders.all)

  const outDirPath: string = fs.mkdtempSync(path.join(os.tmpdir(), ".resourcesCDK8s-"));

  afterAll(() => fs.rmSync(outDirPath, { recursive: true, force: true }));

  beforeEach(async () => {

    emptyRenderedClaims()

    fs.rmSync(outDirPath, { recursive: true, force: true });
  });

  beforeEach(() => {

    resetLazyLoader()
  })

  it('Is able to render claim with annotations', async () => {
    setPath("initializers", path.join(__dirname, "fixtures/initializers"))
    setPath("crs", path.join(__dirname, "fixtures/nocrs"))
    setPath("globals", path.join(__dirname, "fixtures/globals"))
    setPath("claims", path.join(__dirname, "fixtures/catalog_fields/with_annot"))
    setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))

    const catalogApp = Testing.app(
      {
        outdir: "/tmp/TESTS-CATALOG",
        outputFileExtension: ".yaml",
        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE
      }
    );

    const app = Testing.app({
      outdir: "/tmp/TESTS",
      outputFileExtension: ".yaml",
      yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
    });

    try {

      await render(

        catalogApp,

        app,

        resolveClaimEntries([
          path.join(__dirname, "fixtures/catalog_fields/with_annot")
        ])
      )

      const result = Testing.synth(catalogApp.charts[3])

      expect(result[0].metadata.annotations).not.toEqual({})

    } catch (e: any) {

      throw e

    }
  });

  it('Is able to render claim with subComponentOf field', async () => {
    setPath("initializers", path.join(__dirname, "fixtures/initializers"))
    setPath("crs", path.join(__dirname, "fixtures/nocrs"))
    setPath("globals", path.join(__dirname, "fixtures/globals"))
    setPath("claims", path.join(__dirname, "fixtures/catalog_fields/with_sub"))
    setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))

    const catalogApp = Testing.app(
      {
        outdir: "/tmp/TESTS-CATALOG",
        outputFileExtension: ".yaml",
        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE
      }
    );

    const app = Testing.app({
      outdir: "/tmp/TESTS",
      outputFileExtension: ".yaml",
      yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
    });

    try {

      await render(

        catalogApp,

        app,

        resolveClaimEntries([
          path.join(__dirname, "fixtures/catalog_fields/with_sub")
        ])
      )

      const result = Testing.synth(catalogApp.charts[2])

      expect(result[0].spec.subComponentOf).toBeDefined()

    } catch (e: any) {

      throw e

    }
  });


  it('Is able to render claim without annotations', async () => {
    setPath("initializers", path.join(__dirname, "fixtures/initializers"))
    setPath("crs", path.join(__dirname, "fixtures/nocrs"))
    setPath("globals", path.join(__dirname, "fixtures/globals"))
    setPath("claims", path.join(__dirname, "fixtures/catalog_fields/without_annot"))
    setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))

    const catalogApp = Testing.app(
      {
        outdir: "/tmp/TESTS-CATALOG",
        outputFileExtension: ".yaml",
        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE
      }
    );

    const app = Testing.app({
      outdir: "/tmp/TESTS",
      outputFileExtension: ".yaml",
      yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
    });

    try {

      await render(

        catalogApp,

        app,

        resolveClaimEntries([
          path.join(__dirname, "fixtures/catalog_fields/without_annot")
        ])
      )

      const result = Testing.synth(catalogApp.charts[3])

      expect(Object.keys(result[0].metadata.annotations).length).toBe(1)

    } catch (e: any) {

      throw e

    }
  });


  it('Is able to render claim without subComponentOf field', async () => {
    setPath("initializers", path.join(__dirname, "fixtures/initializers"))
    setPath("crs", path.join(__dirname, "fixtures/nocrs"))
    setPath("globals", path.join(__dirname, "fixtures/globals"))
    setPath("claims", path.join(__dirname, "fixtures/catalog_fields/without_sub"))
    setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))

    const catalogApp = Testing.app(
      {
        outdir: "/tmp/TESTS-CATALOG",
        outputFileExtension: ".yaml",
        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE
      }
    );

    const app = Testing.app({
      outdir: "/tmp/TESTS",
      outputFileExtension: ".yaml",
      yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
    });

    try {

      await render(

        catalogApp,

        app,

        resolveClaimEntries([
          path.join(__dirname, "fixtures/catalog_fields/without_sub")
        ])
      )

      const result = Testing.synth(catalogApp.charts[3])

      expect(result[0].spec.subComponentOf).not.toBeDefined()

    } catch (e: any) {

      throw e

    }
  });

});
