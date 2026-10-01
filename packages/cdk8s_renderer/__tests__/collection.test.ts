import * as path from "path"

import {BaseMap} from "../src/collections/map"
import {crawl} from "../src/crawler"
import { MapClaims } from "../src/collections/claims"
import { MapCrs } from "../src/collections/crs"

import {createTestContext} from "./auxiliar";

import common from "catalog_common"

describe("Collection system", () => {

  let context = null

  beforeAll(async () => {
  
      context = await createTestContext({})

  })

  beforeEach(async () => {
  
      await context.restart()
  
  })

  afterAll(async () => {
  
    await context.destroy()

  })

  it("Is derivative", async () => {

    class TestMap extends BaseMap {
      __loadElement(_index: string): Promise<any> {
        throw new Error("Method not implemented.")
      }

      async __loadAll(){

        await crawl(

          path.join(__dirname, "fixtures/collections"),

          () => true,

            (_name:string, data:any) => {

            this.addElement(data)

          }

        )

      }
      __indexElement(data:any){

        return data.split(/\"(\w+)\"/)[1]

      }

    }

    const t = new TestMap()

    await t.loadAll()

    console.log(t.getElement("Francisco"))

  })


  it("can be used to load claims", async () => {

    const mapClaims = new MapClaims("a")

    await crawl(

      await context.getClaimsDir(),

      (entry: string) => new RegExp(/\.(yaml|yml)$/).test(entry),

        (_name:string, data:any) => {

        mapClaims.addElement(common.io.fromYaml(data))

      }

    )

    console.log(mapClaims.hasElement("Deployment/wordpress"))

    console.log(mapClaims.hasElement("UserClaim/user_a"))

    expect(mapClaims.getNameForProvider("UserClaim/user_a", "github")).toEqual("user-a-github")
  })

  it("can be used to load crs", async () => {

    const mapCrs= new MapCrs()

    await crawl(

      path.join(__dirname, "fixtures/crs"),

      (entry: string) =>{

        console.log(entry)

        return new RegExp(/\.(yaml|yml)$/).test(entry) && entry.match(/after\-rename\.yaml/)

      },

        (_name:string, data:any) => {

        mapCrs.addElement(common.io.fromYaml(data))

      }

    )

    console.log(mapCrs.getClaimRef("FirestartrGithubGroup/after-rename"))


  })



})
