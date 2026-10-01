import { ArgoDeployChart } from "../src/charts/argocd/argodeployChart"
import { Testing } from "cdk8s"

import { RefValuesNormalizer } from "../src/normalizers/refValues"

import common from "catalog_common"

describe('ArgoDeploy', () => {

  it("can be instantiated", async () => {

    const claim = {
      "kind": "ArgoDeployClaim",
      "lifecycle": "production",
      "name": "my-deploy",
      "system": "central",
      "version": "1.0",
      "providers": {
        "argocd": {
          "name": "redis-deploy",
          "chart": {
            "name": "redis",
            "version": "18.12.1",
            "source":  "registry-1.docker.io/bitnamicharts",
	    "oci": true
          },

          "values": [
          
            {
              "source": "https://github.com/firestartr-test/test-argoapp-state",
              "paths": ["/redis/values.yaml"],
              "revision": "main"
            }
          
          ],

          "destination": {
          
            "namespace": "default",

            "server": "https://kubernetes.default.svc"
          
          }
        }
      }
    }

    const refValuesNormalizer = new RefValuesNormalizer()

    const patches = await refValuesNormalizer.patches(claim, null)

    const wksp = new ArgoDeployChart(Testing.app(), "test", "test", claim, patches)

    await wksp.render()

    const { props }: any = await wksp.postRenderer([])

    console.log(common.io.toYaml(props))

    expect(common.io.toYaml(props)).toEqual(
`apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: redis-deploy
spec:
  project: default
  sources:
    - chart: redis
      helm:
        valueFiles:
          - $valuesa/redis/values.yaml
        passCredentials: true
      targetRevision: 18.12.1
      repoURL: registry-1.docker.io/bitnamicharts
    - repoURL: https://github.com/firestartr-test/test-argoapp-state
      targetRevision: main
      ref: valuesa
  destination:
    namespace: default
    server: https://kubernetes.default.svc
`)

  })

})
