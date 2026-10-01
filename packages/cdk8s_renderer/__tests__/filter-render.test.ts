import { sortRenderClaimsByKind } from "../src/refsSorter/refsSorter";
import { RenderClaims } from "../src/renderer/types";

describe('Sorter', () => {

    it('renders in the right order', async () => {

        const renderClaims: RenderClaims = {

            "TestClaim-a": {

                claim: {

                    kind: "TestClaim",

                    metadata: {

                        name: "a"

                    }

                },

                initializers: [],

                overrides: [],

                globals: [],

                normalizers: [],

            },

            "TestClaim2-b": {

                claim: {

                    kind: "TestClaim2",

                    metadata: {

                        name: "b"
                    }

                },

                initializers: [],

                overrides: [],

                globals: [],

                normalizers: [],

            },

        }


        const sortedRenderClaims =  sortRenderClaimsByKind(renderClaims, ["TestClaim2"])

        expect(Object.keys(sortedRenderClaims)).toEqual(["TestClaim2-b"])


    });

});
