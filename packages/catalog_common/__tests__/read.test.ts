import io from "../src/io"

import * as path from "path"
import { cloneCatalog } from "../src/io/clone_catalog"
import * as fs from "fs"

describe("The system", function(){

  const catalogMockPath: {[key: string]: string} = {}

  beforeEach( () => {
    const testName = expect.getState().currentTestName || "unknown"


    return cloneCatalog(fixturesCatalog).then(
      (newCatalogMockPath:string) => {

        catalogMockPath[testName] = newCatalogMockPath

      });
  });

  const fixturesCatalog = path.join(__dirname, "fixtures");

  afterAll(function(){

    Object.keys(catalogMockPath).forEach((testName:string) => {

      fs.rmSync(catalogMockPath[testName], {force: true, recursive: true})

    })

  })

  it("allow to read entities", function(){

    expect(io.readEntity(

      'group',

      'groupb',

      [path.join(__dirname, "fixtures/")]

    )).toHaveProperty('metadata.name', "groupb")

  })


  it("throws an error when a entity is duplicated", ()=> {

    const testName = expect.getState().currentTestName || "unknown"

    const catalogPath = catalogMockPath[testName]

      expect(() => { io.readEntity(

        'group',

        'groupb',

        [catalogPath, fixturesCatalog],

      );
    }).toThrow(/Duplicated/);

  })


  it("throws an error when a entity does not exists in the provided paths", ()=> {

    const testName = expect.getState().currentTestName || "unknown"

    const catalogPath = catalogMockPath[testName]

      expect(() => { io.readEntity(

        'group',

        'group_inexistent',

        [catalogPath, fixturesCatalog],

      );
    }).toThrow(/not found/);

  })


  it("allow to list entities by kind", function(){

    expect(io.listEntitiesByKind(

      "user",

      path.join(__dirname, "fixtures/"),

      (u:any) => {

        return u.metadata.name === "userb"
      }

    ).length).toEqual(1)

  })

  it("list files recursively", function(){
    const recursiveFolderPath: string = path.join(__dirname, "fixtures/recursive");
    const pathList: string[] = io.getFileListRecursively(recursiveFolderPath);
    expect(pathList).toEqual([
      path.join(recursiveFolderPath, "a.txt"),
      path.join(recursiveFolderPath, "b.txt"),
      path.join(recursiveFolderPath, "inside_folder/c.txt"),
      path.join(recursiveFolderPath, "inside_folder/inside_inside_folder/d.txt"),
      path.join(recursiveFolderPath, "inside_folder/inside_inside_folder/e.txt"),
      path.join(recursiveFolderPath, "inside_folder/inside_inside_folder/f.txt"),
    ])
  })

})
