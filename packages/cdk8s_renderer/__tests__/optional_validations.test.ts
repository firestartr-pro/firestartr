import {

  optionalValidation

} from "../src/claims/base/optionalValidations"

describe("The optional validation process", () => {

  it("allows to validate data against a remote schema", async () => {

    let thrown = false

    try{
      await optionalValidation({

        kind: "TFWorkspace",

        name: "test",

        providers: {

          terraform: {

            valuesSchema: 'file:__tests__/fixtures/schema/optional-schema.json',

            values: {

            }

          }

        }

      })

    }
    catch(err){
    
      expect(err).toBe(

          `TFWorkspace/test is not valid: section [providers.terraform.values] not valid according to file:__tests__/fixtures/schema/optional-schema.json: [{\"instancePath\":\"\",\"schemaPath\":\"#/required\",\"keyword\":\"required\",\"params\":{\"missingProperty\":\"id\"},\"message\":\"must have required property 'id'\"}]`
      
      )

      thrown = true
    
    }

    expect(thrown).toBe(true)
 
    
  
  })

  it("allows to validate data against a local schema", async () => {

    let thrown = false

    try{
      await optionalValidation({

        kind: "TFWorkspace",

        name: "test",

        providers: {

          terraform: {

            valuesSchema: 'file:__tests__/fixtures/schema/optional.json',

            values: {

            }

          }

        }

      })

    }
    catch(err){
    
      expect(err).toBe(
          `TFWorkspace/test is not valid: section [providers.terraform.values] not valid according to file:__tests__/fixtures/schema/optional.json: [{\"instancePath\":\"\",\"schemaPath\":\"#/required\",\"keyword\":\"required\",\"params\":{\"missingProperty\":\"id\"},\"message\":\"must have required property 'id'\"}]`
      )

      thrown = true
    
    }

    expect(thrown).toBe(true)
  
  
  })

  it("correctly detects invalid URIs", async () => {

    let thrown = false

    const schemaURI =  'test:test_URI'

    try{
      await optionalValidation({

        kind: "TFWorkspace",

        name: "test",

        providers: {

          terraform: {

            valuesSchema: schemaURI,

            values: {

            }

          }

        }

      })

    }
    catch(err){
    
      expect(err).toBe(`Invalid schemaURI: ${schemaURI}`)

      thrown = true
    
    }

    expect(thrown).toBe(true)
  
  
  });

  it("can validate data against a remote schema", async () => {

    await optionalValidation({

      kind: "TFWorkspace",

      name: "test",

      providers: {

        terraform: {

          valuesSchema: 'file:__tests__/fixtures/schema/optional-schema.json',

          values: {

            id: 1,

            name: "Test director",

          }

        }

      }

    })

  })

  it("can validate data against a local schema", async () => {

    await optionalValidation({

      kind: "TFWorkspace",

      name: "test",

      providers: {

        terraform: {

          valuesSchema: 'file:__tests__/fixtures/schema/optional.json',

          values: {

            id: 2,

            name: "Test director 2: electric bogaloo",

            wiki: "fake_url"

          }

        }

      }

    })

  })

});
