import crypto from "crypto"

describe('Hash initializer', () => {

    it('builds a hash properly', async () => {

        const hash = crypto.createHash("shake256" , { outputLength: 4 })

        const kind = "TestClaim"

        const name = "test"

        hash.update(`${kind}-${name}`)

        console.log(hash.digest("hex"))

    });

});
