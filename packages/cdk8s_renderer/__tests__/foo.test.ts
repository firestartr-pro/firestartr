import {createTestContext} from "./auxiliar";

describe("This suite", () => {

	let context = null

	beforeAll(async () => {

		context = await createTestContext({

			onlyFiles: [

			//	"membership_c",
			//	"domain_a",
			//	"system_a",
			//	"group_b"

			]

			//paths: [
			//	"systems",
			//	"users",
			//	"groups",
			//	"domains"
			//]

		})

	})


	it.skip("Allows us to function", async () => {

        context.applyPatches(
        
            "domain_a",

             [
                {op: "replace", path: "/owner", value: "user:user-g"}
             ]
        
        )

	})

})
