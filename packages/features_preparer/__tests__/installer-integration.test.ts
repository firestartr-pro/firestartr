import { getFeatureConfig } from "../src/installer";
import common from "catalog_common";
import * as path from "path";
import * as fs from "fs";


describe("Render files in multiple directories", () => {
  // We should test this with a mockup of the github api
  it.skip("should be able to install a feature", async function () {

    if (process.env.INTEGRATION_TESTS_ACTIVE){
      // get mock component file
      const componentFile = common.io.fromYaml(fs.readFileSync(path.join(
        __dirname,
        "fixtures/mock_catalog/components/repository_a.yaml"
      ), 'utf-8'));
  
      /*
      * Should not throw an error
      */
      await getFeatureConfig("state_repo_sys_services", "2.1.0", componentFile);
    }

  });
});
