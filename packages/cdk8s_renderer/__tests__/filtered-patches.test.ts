import {GithubRepositoryOverrider} from "../src/overriders/githubRepositoryOverride"

import Doppleman from "./fixtures/k8s_doppleman";

import { Testing, YamlOutputType } from 'cdk8s';

//import * as fs from "fs";
//import * as path from "path";

import {CatalogGroupChart} from "../src/charts/catalog/groupChart"

describe("The patches", () => {

  it("can be correctly stated", async () => {

    const patches = await (new GithubRepositoryOverrider().patches(
    
      {}, null
    
    ))
  
    const d = new Doppleman({}, patches)

    d.set("provider", "github")

    expect(d.filteredPatches.map((patch:any) => patch.identify())).toEqual([
    
        'overriders/GithubRepositoryOverrider/additionalPermissions',                                                                                                                                                                         'overriders/GithubRepositoryOverrider/additionalCodeownersRules',                                                                                                                                                                     'overriders/Overrider/specOverrides' 
    
    ])

    d.set("provider", "catalog")

    expect(d.filteredPatches.map((patch:any) => patch.identify())).toEqual([])

  });

  it("an exception can be stated", async () => {

    const patches = [
    
      {
      
        apply(){},

        validate(){},

        identify(){
        
          return "test/test-with-exceptions"
        },

        applicable(){
        
          return {
          
            applicableProviders: [
            
              "^a,b,c"  // all providers except a, b and c
            
            ]
          
          }
        
        }
      
      }
    
    
    ]
  
    const d = new Doppleman({}, patches)

    d.set("provider", "a")

    expect(d.filteredPatches.map((patch:any) => patch.identify())).toEqual([])

    d.set("provider", "b")

    expect(d.filteredPatches.map((patch:any) => patch.identify())).toEqual([])

    d.set("provider", "github")

    expect(d.filteredPatches.map((patch:any) => patch.identify())).toEqual([

        "test/test-with-exceptions"
    
    ])


  });

  it("a catalog is functioning", async function(){

    const catalogApp = Testing.app({
      outdir: "/tmp/.catalog",
      outputFileExtension: ".yaml",
      yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,
    });
  
    const patches = await (new GithubRepositoryOverrider().patches(
    
      {}, null
    
    ))

    const cg = new CatalogGroupChart(catalogApp, "test", "test", {}, patches)

    console.dir(cg.filteredPatches)

  
  })

});
