import { getAffectedRepositories } from "../src/comparer";
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import common from "catalog_common"
import { setPath } from "../src/config";

describe('getAffectedRepositories', () => {

    jest.setTimeout(30000);

    /**
     * Unique per-run temp root so parallel Jest workers never
     * race over shared hard-coded /tmp paths.
     */
    let tempRoot: string;

    const mainClaimsDir = () => path.join(tempRoot, "mainclaims");
    const prClaimsDir = () => path.join(tempRoot, "prclaims");

    beforeAll(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claims-"));
    });

    afterAll(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    beforeEach(() => {

        /**
         * Cleans the folders and claims for the test
         */
        if(fs.existsSync(mainClaimsDir()))
            fs.rmSync(mainClaimsDir(), { recursive: true });

        if(fs.existsSync(prClaimsDir()))
            fs.rmSync(prClaimsDir(), { recursive: true });

    });

    it('Is able to detect a claim affected to github repository', async () => {


        /**
         * 1. Creates the folders and claims for the test
         * 2. Copies the folder comparer to the main branch folder
         * 3. Copies the folder comparer to the PR branch folder and modifies the claim
         *    to change the default branch and the visibility
         * 4. Gets the affected repositories
         * 5. Checks the result
         */
        prepareFoldersAndClaims(mainClaimsDir(), prClaimsDir());

        setPath("claimsDefaults", path.join(__dirname, "fixtures", "initializers" ));

        const result = await getAffectedRepositories(

            mainClaimsDir(),

            prClaimsDir(),

            path.join(__dirname, "fixtures", "wetreposconfig", "config.yaml")

        );

        expect(result.repos).toEqual(

            {

                "firestartr-test/state-github": "notify.yaml",

                "firestartr-test/catalog": "notify.yaml"

            }

        );

        expect(Object.keys(result.changedResources).length).toEqual(2);
        expect(Object.keys(result.changedResources)[0]).toEqual("Component-test-catalog")
        expect(Object.keys(result.changedResources)[1]).toMatch(
          /^FirestartrGithubRepository-test-catalog/
        )

        expect(result.changedResources["Component-test-catalog"]).toEqual(
            {
                "changes": [
                    {
                        "op": "replace",
                        "path": "/spec/lifecycle",
                        "value": "modified"
                    }
                ],
                "reason": "MODIFIED"
            },
        );
    });

    it('Is able to detect a claim affected to the state-secrets repository', async () => {

        /**
         * 1. Creates the folders and claims for the test
         * 2. Copies the folder comparer to the main branch folder
         * 3. Copies the folder comparer to the PR branch folder
         * 4. Copies the secrets claim and its referenced claims (group, user, domain
         *    and system) from base_claims into both branch folders
         * 5. Modifies the PR branch secrets claim to change the external secrets
         *    refresh interval
         * 6. Gets the affected repositories
         * 7. Checks that the ExternalSecret CR change is attributed to state-secrets
         */
        prepareFoldersAndClaims(mainClaimsDir(), prClaimsDir());

        const baseClaims = path.join(__dirname, "fixtures", "base_claims");

        // Referenced claims closure of base_claims/secrets/secret_a.yaml.
        // systems/system_a.yaml already exists in the comparer fixtures (claim my-system),
        // so the system_a claim is copied into the extra/ folder to avoid the collision.
        const claimClosure = [
            ["secrets", "secret_a.yaml"],
            ["groups", "group_a.yaml"],
            ["users", "user_a.yaml"],
            ["domains", "domain_a.yaml"],
            ["systems", "system_a.yaml"],
        ];

        for (const branch of [mainClaimsDir(), prClaimsDir()]) {
            for (const [dir, file] of claimClosure) {
                const targetDir = dir === "systems" ? "extra" : dir;
                fs.mkdirSync(path.join(branch, targetDir), { recursive: true });
                fs.copyFileSync(
                    path.join(baseClaims, dir, file),
                    path.join(branch, targetDir, file)
                );
            }
        }

        const claimFromPR: any = common.io.fromYaml(fs.readFileSync(path.join(prClaimsDir(), "secrets", "secret_a.yaml"), "utf-8"));

        claimFromPR.providers.external_secrets.externalSecrets.refreshInterval = "45d";

        fs.writeFileSync(path.join(prClaimsDir(), "secrets", "secret_a.yaml"), common.io.toYaml(claimFromPR));

        setPath("claimsDefaults", path.join(__dirname, "fixtures", "initializers"));

        const result = await getAffectedRepositories(

            mainClaimsDir(),

            prClaimsDir(),

            path.join(__dirname, "fixtures", "wetreposconfig", "config.yaml")

        );

        expect(result.repos).toEqual(

            {

                "firestartr-test/state-github": "notify.yaml",

                "firestartr-test/catalog": "notify.yaml",

                "firestartr-test/state-secrets": "notify.yaml"

            }

        );

        expect(result.changedResources["ExternalSecret-secret-a"]).toEqual(
            {
                "changes": [
                    {
                        "op": "replace",
                        "path": "/spec/refreshInterval",
                        "value": "45d"
                    }
                ],
                "reason": "MODIFIED"
            },
        );
    });

});



function prepareFoldersAndClaims(mainClaimsDir: string, prClaimsDir: string) {

    fs.mkdirSync(mainClaimsDir, { recursive: true });

    fs.mkdirSync(prClaimsDir, { recursive: true });

    // copy folder recursively
    fs.cpSync(

        path.join(__dirname, "fixtures", "comparer"),

        mainClaimsDir,

        { recursive: true }
    );

    fs.cpSync(

        path.join(__dirname, "fixtures", "comparer"),

        prClaimsDir,

        { recursive: true }

    );

    const claimFromPR: any = common.io.fromYaml(fs.readFileSync(path.join(prClaimsDir ,"components", "test-catalog.yaml"), "utf-8"));

    claimFromPR.providers.github.branchStrategy.defaultBranch = "develop";

    claimFromPR.lifecycle = "modified";

    fs.writeFileSync(path.join(prClaimsDir ,"components", "test-catalog.yaml"),common.io.toYaml(claimFromPR))

}
