import { BranchStrategiesInitializer } from "../src/initializers/branchStrategies";

describe('Bp initializer', () => {

    it('can apply patch with custom strategy', async () => {


        const bpAdapter: any= {

            name: "branchStrategies",

            apiVersion: "firestartr.dev/v1",

            kind: "FirestartrGithubRepository",

            virtual: true,

            defaultValues: {

                strategies: [{

                name: "custom",

                values: {

                    defaultBranch: "main",

                    branchProtections: [{

                        branch: "main",

                        statusChecks: ["a", "b"],

                        requiredReviewersCount: 1,

                        requiredCodeownersReviewers: true,

                        enforceAdmins: false,

                        requireSignedCommits: false,

                        requireConversationResolution: false

                    }]

                }

            }]

            }
        }

        const bpInitializer = new BranchStrategiesInitializer(bpAdapter)



        const patches = await bpInitializer.patches({

            kind: "ComponentClaim",

            version: "1.0",

            name: "test",

            providers: {

                github: {

                    branchStrategy: { 
                        name: "custom"
                    },
            }

            }

        },

        null

        )


        let cr = {

            kind: "FirestartrGithubRepository",

            version: "v1",

            metadata: {

                name: "test",

                annotations: {

                    "firesarter.dev/branchStrategy": "test"

                }
            },


            spec: {

                repo: {

                    defaultBranch: "main",

                    name: "test"

                },

                branchProtections: [],

            }

        }

        for(const patch of patches){

            cr =  patch.apply(cr)

        }


        expect(cr.spec.branchProtections)
            .toEqual(bpAdapter.defaultValues.strategies[0].values.branchProtections)


    });


    it('can keep the custom strategy', async () => {


        const bpAdapter: any= {

            name: "branchStrategies",

            apiVersion: "firestartr.dev/v1",

            kind: "FirestartrGithubRepository",

            defaultValues: {

                strategies: [{

                name: "trunkBasedDevelopment",

                values: {

                    defaultBranch: "main",

                    branchProtections: [{

                        branch: "main",

                        statusChecks: ["a", "b"],

                        requiredReviewersCount: 1,

                        requiredCodeownersReviewers: true,

                        enforceAdmins: false,

                        requireSignedCommits: false,

                        requireConversationResolution: false

                    }]

                }

            }]

            }
        }

        const bpInitializer = new BranchStrategiesInitializer(bpAdapter)

        let previousCR = {

            kind: "FirestartrGithubRepository",

            version: "v1",

            metadata: {

                name: "test",

                annotations: {

                    "firesarter.dev/branchStrategy": "test"

                }
            },


            spec: {

                repo: {

                    defaultBranch: "main",

                    name: "test"

                },

                branchProtections: [
                    {
                        branch: "main",
                        statusChecks: ["a", "b"],
                        requiredReviewersCount: 1,
                        requiredCodeownersReviewers: true,
                        enforceAdmins: false,
                        requireSignedCommits: false,
                        requireConversationResolution: false
                    }
                ],

            }

        }




        const patches = await bpInitializer.patches({

            kind: "ComponentClaim",

            version: "1.0",

            name: "test",

            providers: {

                github: {

                    branchStrategy: { name: "custom" },

                }
            }
        }, previousCR)


        let cr = {

            kind: "FirestartrGithubRepository",

            version: "v1",

            metadata: {

                name: "test",

                annotations: {

                    "firesarter.dev/branchStrategy": "test"

                }
            },


            spec: {

                repo: {

                    defaultBranch: "main",

                    name: "test"

                },

                branchProtections: [],

            }

        }

        for(const patch of patches){

            cr =  patch.apply(cr)

        }


        expect(cr.spec.branchProtections).toEqual(previousCR.spec.branchProtections)


    });



    it('bp initializer sets to empty array when the strategy is none', async () => {


        const bpAdapter: any= {

            name: "branchStrategies",

            apiVersion: "firestartr.dev/v1",

            kind: "FirestartrGithubRepository",

            defaultValues: {

                strategies: [{

                name: "trunkBasedDevelopment",

                values: {

                    defaultBranch: "main",

                    branchProtections: [{

                        branch: "main",

                        statusChecks: ["a", "b"],

                        requiredReviewersCount: 1,

                        requiredCodeownersReviewers: true,

                        enforceAdmins: false,

                        requireSignedCommits: false,

                        requireConversationResolution: false

                    }]

                }

            }]

            }
        }

        const bpInitializer = new BranchStrategiesInitializer(bpAdapter)

        let previousCR = {

            kind: "FirestartrGithubRepository",

            version: "v1",

            metadata: {

                name: "test",

                annotations: {

                    "firesarter.dev/branchStrategy": "test"

                }
            },


            spec: {

                repo: {

                    defaultBranch: "main",

                    name: "test"

                },

                branchProtections: [
                    {
                        branch: "main",
                        statusChecks: ["a", "b"],
                        requiredReviewersCount: 1,
                        requiredCodeownersReviewers: true,
                        enforceAdmins: false,
                        requireSignedCommits: false,
                        requireConversationResolution: false
                    }
                ],

            }

        }




        const patches = await bpInitializer.patches({

            kind: "ComponentClaim",

            version: "1.0",

            name: "test",

            providers: {

                github: {

                    branchStrategy: { name: "none" }

                }
            }
        }, previousCR)


        let cr = {

            kind: "FirestartrGithubRepository",

            version: "v1",

            metadata: {

                name: "test",

                annotations: {

                    "firesarter.dev/branchStrategy": "test"

                }
            },


            spec: {

                repo: {

                    defaultBranch: "main",

                    name: "test"

                },

                branchProtections: [],

            }

        }

        for(const patch of patches){

            cr =  patch.apply(cr)

        }


        expect(cr.spec.branchProtections).toEqual([])


    });


  it('"custom" strategies can only appear in virtual files', () => {

        const bpAdapter: any= {

            name: "branchStrategies",

            apiVersion: "firestartr.dev/v1",

            kind: "FirestartrGithubRepository",

            virtual: false,

            defaultValues: {

                strategies: [{

                name: "custom",

                values: {

                    defaultBranch: "main",

                    branchProtections: []

                }

            }]

            }
        }

        expect(() => new BranchStrategiesInitializer(bpAdapter)).toThrow();

        bpAdapter.virtual = true;

        expect(() => new BranchStrategiesInitializer(bpAdapter)).not.toThrow();

  })
});
