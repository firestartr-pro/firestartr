import { NameNormalizer, UUIDInitializer } from "..";
import { BackstageInitializer } from "../src/initializers/backstage";
import { ICustomResourcePatch } from "../src/patches";
import { helperIsPatchApplicable } from "../src/charts/helpers";

class Doppleman {

    claim: any = {};

    previousCr: any = {};

    patches: ICustomResourcePatch[] = [];

    data: any = {};

    get(k: string): any { return this.data[k]; }

    set(k: string, v: any) { this.data[k] = v; }

    constructor(claim: any, previousCr: any, patches: ICustomResourcePatch[]) {

        this.claim = claim
        this.previousCr = previousCr
        this.patches = patches

    }

    get filteredPatches() {

        const patches = this.patches;

        return patches.filter((patch: any) => {

            return helperIsPatchApplicable(this, patch)

        })

    }

    async render() {

        const fClone = (obj: any) => JSON.parse(JSON.stringify(obj));

        let cr = fClone(this.previousCr)

        for (const patch of this.patches) {

            patch.ctx = () => this.ctx();

            cr = await patch.apply(cr)

            patch.validate(cr)
        }

        return cr
    }

    ctx() {

        const provider = this.get("provider") ?? "doppleman"
        const kind = this.get("kind") ?? "k8s-doppleman"

        return {

            get kind() {

                return kind

            },

            get provider() {

                return provider

            }

        }
    }


}

describe('CDK8s renderer', () => {

    it('can create backstage annotations', async () => {

        const templateCr = {

            kind: "FirestartrGithubRepository",

            metadata: {

                // Template generated name without uuid and non-normalized
                name: "Awesome-Project",

            },

            spec: {

                org: "sample-org",

                firestartr: {


                },

            }

        }

        const claim = {

            kind: "ComponentClaim",

            name: "Awesome-Project",

            providers: {

                github: {

                    name: "My-Very-First-Repo",

                    org: "sample-org",

                    description: "A sample description",

                }

            }

        }

        const UUIDInitializerPatches = await new UUIDInitializer().patches(claim, {});
        const normalizerPatch = await new NameNormalizer().patches(claim, {});
        const backstageInitializerPatches = await new BackstageInitializer().patches(claim, {});

        let patches: ICustomResourcePatch[] = [...UUIDInitializerPatches, ...normalizerPatch, ...backstageInitializerPatches]

        const doppleman = new Doppleman(claim, templateCr, patches);

        doppleman.set("provider", "github");

        const githubEntity = await doppleman.render()

        expect(githubEntity.metadata.annotations?.['backstage.io/kubernetes-id']).toEqual(claim.name);

    });
});
