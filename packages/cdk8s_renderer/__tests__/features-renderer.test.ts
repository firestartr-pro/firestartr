import {FeatureRepoChart} from '../src/charts/github/featureRepoChart';

const claim: any = {
    "name": "tech_docs",
    "version": "0.8.0",
    "ref": "test/foo",
    "args": {}
}

import { MOCK_FEATURES } from '../src/overriders/featureOverride';
import { MOCK_STITCHING_FEATURES } from '../src/claims/stitching/stitching';

import { Testing, YamlOutputType } from 'cdk8s';
import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider, setExcludedPaths, setPath } from '../src/config';
import * as fs from "fs";
import * as path from "path";
import { emptyRenderedClaims } from '../src/refresolver';
import { resetLazyLoader } from "../src/loader/lazy_loader";

import {
  claimsRefListAsGenerator,
  resolveClaimEntries,
} from '../src/utils/claimUtils';

import { createTestContext } from "./auxiliar";

import featuresPreparer from "features_preparer"


describe("Features renderer", () => {

    jest.setTimeout(30000);
    configureProvider(AllowedProviders.all)

    const outDirPath: string = path.join("/", "tmp", ".resourcesCDK8s");

    process.env['ORG'] = 'firestartr-test'

    let context = null

    beforeEach(() => {
    
        const featureArgs = {}
    
        MOCK_FEATURES((cr: any) => {

            const data = featuresPreparer.renderFeatureFromPath(
            
                path.join(__dirname, 'fixtures/features/feature_a'),

                '/tmp/feature_rendered',

                cr,

                featureArgs
            
            )
            
            return data
        })

        // Claim stitching: avoid real GitHub download during unit tests
        MOCK_STITCHING_FEATURES(async () => [])

    })

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

    afterEach(() => {
        MOCK_FEATURES(undefined)
        MOCK_STITCHING_FEATURES(undefined)
    });

    it.skip("correctly renders a version", () => {

      const app = Testing.app({
        outdir: outDirPath,
        outputFileExtension: ".yaml",
        yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
      });

      let firestartrEntity = new FeatureRepoChart(
          app,
          `github-test`,
          "test",
          claim,
          [],
      );
    
      console.dir(firestartrEntity.render())

    })

    it("is able to render a feature cr with different targetBranches", async () => {
 
        setPath("initializers", path.join(__dirname, "fixtures/initializers"))
        setPath("crs", path.join(__dirname, "fixtures/crs"))
        setPath("globals", path.join(__dirname, "fixtures/globals"))
        setPath("claims", context.getClaimsDir())
        setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"))
        setExcludedPaths([path.join(__dirname, "fixtures/crs/.github")])

        context.applyPatches(
            "component_a",
            [{
                path: "/providers/github/features",
                op: "add",
                value: [
                    {
                        name: "feature_a",
                        version: ""
                    }
                ]
            }]
        
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

        await render(catalogApp, app, resolveClaimEntries([context.getClaimsDir()]))

        app.synth()
        catalogApp.synth()

        expect(await context.testRenderedCR(
        
            'FirestartrGithubRepositoryFeature',
            'feature-a',
            {
               op: "test",
               path: '/spec/files/0/targetBranch',
               value: 'deployment'

            }   
        
        )).toBe(true)

    })



        it("stamps traceability annotations on the Feature CR", () => {
          const traceabilityClaim: any = {
            name: "traceable_feature",
            feature: {
              name: "traceable_feature",
              version: "1.0.0",
              ref: "traceable_feature-v1.0.0",
              url: "https://github.com/prefapp/features/tree/traceable_feature-v1.0.0/packages/traceable_feature",
              sha: "8804d4b99267c985383bd68026a89c0dc8d0bfe8",
              tags: ["traceable_feature-v1.0.0", "traceable_feature-v1"],
              repo: "features",
            },
            context: {},
            org: "prefapp",
            repositoryTarget: {},
            files: [],
            firestartr: { tfStateKey: "test-key" },
          };

          const repoCr = {
            metadata: {
              name: "traceable_feature",
              annotations: {},
            },
            spec: {
              repo: { defaultBranch: "main" },
            },
          };

          const app = Testing.app({
            outdir: outDirPath,
            outputFileExtension: ".yaml",
            yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
          });

          const chart = new FeatureRepoChart(
            app,
            "traceable-feature-test",
            "test",
            traceabilityClaim,
            [],
            repoCr,
          );

          const template = chart.template();

          expect(template.metadata.annotations["firestartr.dev/feature-git-sha"]).toBe(
            "8804d4b99267c985383bd68026a89c0dc8d0bfe8",
          );
          expect(template.metadata.annotations["firestartr.dev/feature-git-tags"]).toBe(
            JSON.stringify(["traceable_feature-v1.0.0", "traceable_feature-v1"]),
          );
          expect(template.metadata.annotations["firestartr.dev/feature-url"]).toBe(
            "https://github.com/prefapp/features/tree/traceable_feature-v1.0.0/packages/traceable_feature",
          );
          expect(template.metadata.annotations["firestartr.dev/feature-ref"]).toBe(
            "traceable_feature-v1.0.0",
          );
          expect(template.metadata.annotations["firestartr.dev/feature-repo"]).toBe(
            "features",
          );
        });

        it("omits traceability annotations when sha and tags are absent", () => {
          const noTraceClaim: any = {
            name: "basic_feature",
            feature: {
              name: "basic_feature",
              version: "1.0.0",
            },
            context: {},
            org: "prefapp",
            repositoryTarget: {},
            files: [],
            firestartr: { tfStateKey: "test-key" },
          };

          const repoCr = {
            metadata: {
              name: "basic_feature",
              annotations: {},
            },
            spec: {
              repo: { defaultBranch: "main" },
            },
          };

          const app = Testing.app({
            outdir: outDirPath,
            outputFileExtension: ".yaml",
            yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
          });

          const chart = new FeatureRepoChart(
            app,
            "basic-feature-test",
            "test",
            noTraceClaim,
            [],
            repoCr,
          );

          const template = chart.template();

          expect(template.metadata.annotations["firestartr.dev/feature-name"]).toBe(
            "basic_feature",
          );
          expect(template.metadata.annotations["firestartr.dev/feature-git-sha"]).toBeUndefined();
          expect(template.metadata.annotations["firestartr.dev/feature-git-tags"]).toBeUndefined();
          expect(template.metadata.annotations["firestartr.dev/feature-url"]).toBeUndefined();
        });

})
