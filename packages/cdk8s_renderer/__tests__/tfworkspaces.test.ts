import { TFWorkspaceChart } from "../src/charts/workspaces/tfworkspaceChart"
import { Testing } from "cdk8s"
import { RefValuesNormalizer } from "../src/normalizers/refValues"

describe('TFWorkspace', () => {

    it('Chart should render properly', async () => {

        // Given the following claim
        const claim = {
          "kind": "TFWorkspaceClaim",
          "lifecycle": "production",
          "name": "acme-predev-aks",
          "system": "acme",
          "version": "1.0",
          "providers": {
            "terraform": {
              "name": "acme-predev-aks",
              "source": "Remote",
              "module": "https://github.com/infra/acme-predev-aks@main",
              "values": {},
              "context": {
                "providers": [
                  {
                    "name": "aws-westeurope"
                  }
                ]
              }
            }
          }
        }

        // Then the following CR should be generated
        const expectedCR = {
            "apiVersion": "firestartr.dev/v1",
            "kind": "FirestartrTerraformWorkspace",
            "metadata": { "name": "acme-predev-aks" },
            "spec": {
                "firestartr": { "tfStateKey": "test" },
                "values": "{}",
                "context": {
                "providers": [
                    {
                     "ref": 
                        { 
                            "kind": "FirestartrProviderConfig", 
                            "name": "aws-westeurope" 
                        }
                    }
                ]
                },
                "module": "https://github.com/infra/acme-predev-aks@main",
                "source": "Remote",
                "references": []
            }
        }


        const refValuesNormalizer = new RefValuesNormalizer()

        const patches = await refValuesNormalizer.patches(claim, null)

        const wksp = new TFWorkspaceChart(Testing.app(), "test", "test", claim, patches)

        await wksp.render()
        
        const { props }: any = await wksp.postRenderer([])

        expect(props).toEqual(expectedCR)

    })

})
