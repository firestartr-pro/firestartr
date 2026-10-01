import { Construct } from 'constructs';
import { BaseChart } from '../../../src/charts/base';
import { FeatureRepoChart } from '../../../src/charts/github/featureRepoChart';
import { ApiObject, GroupVersionKind } from 'cdk8s';
import { IGithubRepositoryFeatureClaim } from '../../../src/claims/github/repositoryFeature';
import { ICustomResourcePatch } from '../../../src/patches';


export class DummyChart extends BaseChart {

    constructor(

      scope: Construct,

      chartId: string,

      firestartrId: string | null,

      claim: any,

      patches: ICustomResourcePatch[] = []

    ){

      super(

        scope,

        chartId,

        firestartrId,

        claim,

        patches

      );

      this.set("provider", "github")

    }

    async render() {

      await super.render();

      await this.postRenderFeatures(this.get("rendered-cr"));

      return this

    }

    async postRenderFeatures(cr:any){

      const featuresPatches: any[] = this.get("patches").filter(

        (patch: any) => patch.identify().match(/^feature\//)

      );

      for (const featurePatch of featuresPatches) {

        const featureClaim: IGithubRepositoryFeatureClaim = await featurePatch.post(cr);

        await (

          await (

            new FeatureRepoChart(

              this,

              featureClaim.name,

              cr.spec.firestartr.tfStateKey,

              featureClaim,

              [],

              cr

            )

          )

          .render()

        )

        .postRenderer([])

      }


    }

    template(){

      const claim: any = this.get("claim");

      return {
        apiVersion: "v1",

        kind: "Dummy",

        metadata: { name: claim.name, annotations: {} },

        spec: {

          firestartr: { tfStateKey: "a" },

          org: claim.providers.github.org,

          repo: { branch: claim.providers.github.defaultBranch },

          preferences: claim.providers.github.preferences,

        }
      }
    }

    instanceApiObject(template: any): ApiObject {
      return new ApiObject(this, template.metadata.name, template)
    }


    gvk(): GroupVersionKind {
      return {
        kind: "Dummy",
        apiVersion: "v1"
      }
    }
}
