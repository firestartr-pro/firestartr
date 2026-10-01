import * as path from "path"

import {resolveClaimEntries} from "../src/utils/claimUtils"

import {createTestContext} from "./auxiliar";

describe("The resolveClaimFilesList", () => {

    let context = null

    beforeAll(async () => {
    
        context = await createTestContext({
        
        })
    
    })

    it("is able to load paths", async () => {
    
        const r = resolveClaimEntries(

            [

                await context.getClaimsDir()
            ]

        )

        const entries = []

        for await(const claimRef of r){
        
            entries.push(claimRef)
        }

        expect(
        
            [
                "ComponentClaim-component_a",
                "GroupClaim-group_a",
                "GroupClaim-group_b",
                "GroupClaim-group_c",
                "UserClaim-user_a",
            ]
            
            .filter((e) => entries.indexOf(e) !== -1)
            .length
        
        ).toEqual(5)

    })


})
