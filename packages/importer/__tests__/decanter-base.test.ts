import { GithubRepositoryOverrider } from 'cdk8s_renderer';
import Decanter from '../src/decanter/base';
import  RepoGithubDecanter  from '../src/decanter/gh/github_repo';
import { setConfigPath, setClaimsPath } from '../src/decanter/config';
import path from 'path';


describe('Doppleman decant',() => {

    it("it should returns a GithubRepositoryOverrider", async () => {

        setClaimsPath(path.join('/tmp/claims-dir'))

        class DopplemanDecanter extends Decanter {

            async __adaptOverriderRepo(_claim: any){

                return new GithubRepositoryOverrider()

            }

        }

        const doppleman = new DopplemanDecanter({})

        const adapter = await doppleman.decant()

        expect(adapter.renderClaim.overrides[0]).toBeInstanceOf(GithubRepositoryOverrider)

    });

    it("Should work", async () => {

        setConfigPath(path.join(__dirname, "fixtures", "defaults"))
        setClaimsPath(path.join('/tmp/claims-dir'))

        const d = new RepoGithubDecanter({

            oidc: {

                use_default: false,

                include_claim_keys: false,

            },

            teamsAndMembers: {

                directMembers: [],

                outsideMembers: [],

                teams: []

            },

            branchStrategy: {

                kind: "none",

            },

            repoDetails: {

                name: "foo",

                description: "a test repo",

                visibility: "public",

                default_branch: "master"

            }


        }, "test");

        const result = await d.decant()

        expect(result.renderClaim.claim.providers.github.org).toEqual("test")

    })

    it("should map has_wiki: true to hasWiki in the claim", async () => {

        setConfigPath(path.join(__dirname, "fixtures", "defaults"))
        setClaimsPath(path.join('/tmp/claims-dir'))

        const d = new RepoGithubDecanter({

            oidc: {

                use_default: false,

                include_claim_keys: false,

            },

            teamsAndMembers: {

                directMembers: [],

                outsideMembers: [],

                teams: []

            },

            branchStrategy: {

                kind: "none",

            },

            repoDetails: {

                name: "foo",

                description: "a test repo",

                visibility: "public",

                default_branch: "master",

                topics: [],

                has_wiki: true,

            }


        }, "test");

        const result = await d.decant()

        expect(result.renderClaim.claim.providers.github.hasWiki).toEqual(true)

    })

    it("should map has_wiki: false to hasWiki in the claim", async () => {

        setConfigPath(path.join(__dirname, "fixtures", "defaults"))
        setClaimsPath(path.join('/tmp/claims-dir'))

        const d = new RepoGithubDecanter({

            oidc: {

                use_default: false,

                include_claim_keys: false,

            },

            teamsAndMembers: {

                directMembers: [],

                outsideMembers: [],

                teams: []

            },

            branchStrategy: {

                kind: "none",

            },

            repoDetails: {

                name: "foo",

                description: "a test repo",

                visibility: "public",

                default_branch: "master",

                topics: [],

                has_wiki: false,

            }


        }, "test");

        const result = await d.decant()

        expect(result.renderClaim.claim.providers.github.hasWiki).toEqual(false)

    })
});
