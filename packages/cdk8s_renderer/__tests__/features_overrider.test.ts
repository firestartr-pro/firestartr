import { Testing } from "cdk8s";
import { FeaturesOverrider } from "../src/overriders/featureOverride";
import { GithubRepositoryChart } from "../src/charts/github";
import { CatalogComponentChart } from "../src/charts/catalog";
import features_preparer from "features_preparer";
import { SyncerInitializer } from "../src/initializers/syncer";
import { RevisionNormalizer } from "../src/normalizers/RevisionNormalizer";

/**
 * This is a dummy config yaml, it represents the config yaml of a feature.
 * After #2648, patches are claim-relative flat arrays applied during stitching,
 * not CR patches. This fixture keeps the old CR shape only to verify that
 * FeaturesOverrider no longer applies isPostPatch CR mutations.
 */
const configYaml = {
  "files":[],
  "patches": [] as unknown as Record<string, unknown>,
}

/**
 * This is a dummy claim, it represents the claim of a github repository
 */
const claim: any = {
    "kind": "ComponentClaim",
    "version": "1.0",
    "type": "service",
    "lifecycle": "production",
    "system": "system:system-name",
    "maintainedBy": [],
    "name": "test-catalog-2",
    "providers": {
        "github": {
            "sync": { "enabled": true, "period": "1m" },
            "description": "Testing catalog to check reconfiguring aspects",
            "name": "test-catalog-2",
            "org": "firestartr-test",
            orgPermissions: 'none',
            "visibility": "private",
            "branchStrategy": {
              name: "trunkBasedDevelopment"
            },
            "features": [
                {
                    "name": "tech_docs",
                    "version": "0.8.0",
                    "ref": "test/foo"
                }
            ]
        }
    }
}


describe('Features overrider', () => {

    let getFeatureConfigFromRefCalled = false

    beforeAll(() => {

        // Mock the getFeatureConfig method, instead of getting the config from github
        features_preparer.getFeatureConfig = async() => configYaml

        features_preparer.getFeatureConfigFromRef = async() => {
        
            getFeatureConfigFromRefCalled = true

            return configYaml
        
        }

      }


    );

    beforeEach(() => {
    
        getFeatureConfigFromRefCalled = false
    
    });

    it('Applies the patches from github provider to FirestartrGithubRepository chart', async () => {

      // Create Overrider for feature
      const featuresOverrider = new FeaturesOverrider("test-feature", "", configYaml, {}, "test/espinete", "test/features")

      //Extract patches from feature
      const patches: any = await featuresOverrider.patches(claim, null)

      const patchesSyncer = await (new SyncerInitializer()).patches(claim, null)
      const patchesNormalizer = await (new RevisionNormalizer()).patches(claim, null) 

      
      
      patches.push(patchesSyncer[0])
      patches.push(patchesNormalizer[0])

      //Create chart for github repository with the patches
      const githubRepositoryChart = new GithubRepositoryChart(Testing.app(), "test", "test-key", claim, patches);

      //Render the chart
      const renderedRepo = await githubRepositoryChart.render()

      //Filter patches that are post patches (after #2648, no feature isPostPatch remains)
      const postPatches = patches.filter((patch: any)=> patch.isPostPatch)
      expect(postPatches.length).toEqual(0)

      //Apply the post patches to the rendered chart
      const githubRepositoryApiObject = (await renderedRepo.postRenderer(postPatches)).toJson()
      console.dir(githubRepositoryApiObject, { depth: null })
      // After #2648, CR patches from features are gone — claim stitching is the surface
      expect(githubRepositoryApiObject.metadata.annotations?.['test-github'])

        .toBeUndefined()


      expect(githubRepositoryApiObject.metadata.annotations['firestartr.dev/revision']).toEqual('1')
      expect(githubRepositoryApiObject.metadata.annotations['firestartr.dev/sync-enabled']).toEqual('true')
      expect(githubRepositoryApiObject.metadata.annotations['firestartr.dev/sync-period']).toEqual('1m')


      /**
       * Through the FirestartrGithubRepositoryChart we can access the extra charts that have been created
       * in this case the feature chart
       */
      const extraCharts = githubRepositoryChart.extraCharts()

      /**
       * We expect to have one extra chart, the feature chart
       */
      expect(extraCharts.length)

        .toEqual(2)

      const featureApiObject: any = extraCharts[1].chart.toJson()

      /**
       * We expect the feature chart to have the kind FirestartrGithubRepositoryFeature
       */
      expect(featureApiObject.kind)

        .toEqual('FirestartrGithubRepositoryFeature')


      expect(featureApiObject.metadata.annotations['firestartr.dev/revision']).toEqual('1')
      expect(featureApiObject.metadata.annotations['firestartr.dev/sync-enabled']).toEqual('true')
      expect(featureApiObject.metadata.annotations['firestartr.dev/sync-period']).toEqual('1m')



      /**
       * Now we will render the catalog component chart
       */
      const componentChart = new CatalogComponentChart(Testing.app(), "test", "test-key", claim, patches);

      //Render the chart
      const componentApiObject = (

        await (

          await componentChart.render()

        )

        .postRenderer(postPatches)

      )

      .toJson()


      // After #2648, catalog CR patches via features are stitched onto the claim, not the CR
      expect(componentApiObject.metadata.annotations?.['backstage.io/techdocs-ref'])

        .toBeUndefined()

      /**
       * Through the chart we can access the extra charts that have been created
       * in this we can ensure that no extra charts have been created
       */
      const extraChartsComponent = componentChart.extraCharts()

      /**
       * We expect to have no extra charts
       */
      expect(extraChartsComponent.length).toEqual(0)

      expect(getFeatureConfigFromRefCalled).toEqual(true)

    });


});
