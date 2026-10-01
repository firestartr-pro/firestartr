
import { Testing, YamlOutputType } from 'cdk8s';
import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider, setExcludedPaths, setPath } from '../src/config';
import * as path from "path";

import {
  resolveClaimEntries,
} from '../src/utils/claimUtils';


describe('Features install', () => {


  jest.setTimeout(300000);

  configureProvider(AllowedProviders.all)

    // This an integration test, so it is skipped by default.
    it.skip('Can apply patches to multiple charts from github features', async () => {

      setPath("initializers", path.join(__dirname, "fixtures/initializers"))

      setPath("crs", path.join(__dirname, "fixtures/nocrs"))

      setPath("globals", path.join(__dirname, "fixtures/nocrs"))

      setPath("claims", path.join(__dirname, "fixtures/featuresoverrider/claims"))

      setPath("claimsDefaults", path.join(__dirname, "fixtures/featuresoverrider/.config"))

      setExcludedPaths([ path.join(__dirname, "fixtures/crs/.github")])

      const catalogApp = Testing.app({

        outdir: "/tmp/.catalog",

        outputFileExtension: ".yaml",

        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,

      });

      const app = Testing.app({

        outdir: "/tmp/.resources",

        outputFileExtension: ".yaml",

        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,

      });


      await render(catalogApp, app, resolveClaimEntries([
          path.join(__dirname, "fixtures/featuresoverrider/claims")
      ]))

      app.synth()

      catalogApp.synth()

    });

});
