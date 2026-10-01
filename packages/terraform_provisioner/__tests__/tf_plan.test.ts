import * as path from "path"

import {planLoader} from "../src/tf/analyzer"

describe('Terraform Plan', () => {

  it('can be loaded', async () => {

    return planLoader(
    
      path.join(__dirname, "fixtures/tf/plan.json")
    
    ).then((tfPlan:any) => {
 
      expect(tfPlan.version.info()).toBe("Terraform 1.7.0")

      expect(tfPlan.summary.toString()).toBe("Plan: 1 to add, 0 to change, 0 to destroy.")

      console.log(tfPlan.detailedBriefing)

      expect(tfPlan.detailedBriefing).toEqual({

          "create": [

            "local_file.foo"

          ]
      })


    }).catch((err) => {
    
      throw err
    
    })

  });

} );
