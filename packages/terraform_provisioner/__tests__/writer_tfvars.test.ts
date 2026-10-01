import { WriterTfVarsJson } from "../src/writer_tfvars_json";
import * as path from 'path';
import { getCrFn } from "./fixtures";

describe('Terraform tfvars render', () => {

    it('renders a variables file (terraform.tfvars.json) with all kind of variables', async () => {

        /**
         * This willl be the spec.values section in the FirestartrTerraformWorkspace CR
         */
        const cr: any = getCrFn(path.join(__dirname , "fixtures", "cr.yaml"))

        /**
         * Resolved references by the operator
         */
        const references = {
            "NAME": "my-name",
            "NAME2": "my-name2",
            "property4": {
              "prop4" : "a",
              "prop5" : "b"
            },
            "property5": [
              "my-name",
              "my-name2"
            ],
            "property6": "my-name",
            "property7": false,
            "property8": true,
            "property9": 1,
            "property10": 1.28,
            "property11": 0
        }

        /**
         * Expected terraform.tfvars.json
         */
        const expectedTfvars =
`{
  "name": "my-name",
  "name2": "my-name2",
  "property": true,
  "property2": {
    "property3": "concatenated-my-name-my-name2"
  },
  "property4": {
    "prop4": "a",
    "prop5": "b"
  },
  "property5": [
    "my-name",
    "my-name2"
  ],
  "property6": "my-name",
  "property7": false,
  "property8": true,
  "property9": 1,
  "property10": 1.28,
  "property11": 0
}`

        const writerTfVarsJson = new WriterTfVarsJson(JSON.parse(cr.spec.values), references)

        const tfvars = await writerTfVarsJson.render()

        expect(tfvars).toEqual(expectedTfvars)

    });

    it('warns the user when concatenates a string with other types', async () => {
      
      expect.assertions(1);
      
      /**
       * This willl be the spec.values section in the FirestartrTerraformWorkspace CR
       */
      const cr: any = getCrFn(path.join(__dirname , "fixtures", "cr_wrong_concat_type.yaml"))

      /**
       * Resolved references by the operator
       */
      const references = {
          "NAME": "my-name",
          "NAME2": "my-name2",
          "property4": {
            "prop4" : "a",
            "prop5" : "b"
          },
          "property5": [
            "my-name",
            "my-name2"
          ],
          "property6": "my-name",
          "property7": false,
          "property8": true,
          "property9": 1,
          "property10": 1.28,
          "property11": 0
      }

      const writerTfVarsJson = new WriterTfVarsJson(JSON.parse(cr.spec.values), references)

      try{

        await writerTfVarsJson.render()


      } catch(e: any){

        expect(e.message)
        
        .toEqual(`VALUE NOT INTERPOLABLE`)

      }

      

  });

  it('preserves null values in terraform.tfvars.json output', async () => {
    const values = {
      bypass_actors: [
        {
          actor_id: null,
          actor_type: "OrganizationAdmin",
          bypass_mode: "always",
        }
      ]
    };

    const writerTfVarsJson = new WriterTfVarsJson(values, {});
    const tfvars = await writerTfVarsJson.render();

    expect(tfvars).toEqual(`{
  "bypass_actors": [
    {
      "actor_id": null,
      "actor_type": "OrganizationAdmin",
      "bypass_mode": "always"
    }
  ]
}`);
  });

});
