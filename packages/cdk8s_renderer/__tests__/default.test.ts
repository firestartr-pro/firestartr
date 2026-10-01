import { GlobalDefault } from "../src/defaults/global";
import { InitializerDefault } from "../src/defaults/initializer";
import DefaultSectionSchema from "../src/schemas/default";
import * as path from "path";
import * as fs from "fs";
import common from "catalog_common";
import * as jsonPatch from "fast-json-patch";
import {applyBlockAwareDefaults} from '../src/loader/claimsDefaulter'

import fjp from 'fast-json-patch'

describe("The initializers logic", () => {

    it("can correctly validate the data it has", async () => {
        const correctData: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/defaults/correct_default.yaml"
        ), "utf-8").toString());
        const correctGlobalDefaults: GlobalDefault = new GlobalDefault(correctData);
        expect(
            await correctGlobalDefaults.validate(DefaultSectionSchema)
        ).toEqual(true);
        const correctInitializerDefaults: InitializerDefault = new InitializerDefault(
            correctData
        );
        expect(
            await correctInitializerDefaults.validate(DefaultSectionSchema)
        ).toEqual(true);

        const incorrectData: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/defaults/incorrect_default.yaml"
        ), "utf-8").toString());
        const incorrectGlobalDefaults: GlobalDefault = new GlobalDefault(
            incorrectData
        );
        expect(
            await incorrectGlobalDefaults.validate(DefaultSectionSchema)
        ).toEqual(false);
        const incorrectInitializerDefaults: InitializerDefault = new InitializerDefault(
            incorrectData
        );
        expect(
            await incorrectInitializerDefaults.validate(DefaultSectionSchema)
        ).toEqual(false);
    });

    it("can correctly apply globals and validate the results", async () => {
        const crToUpdate: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/crs/FirestartrGithubRepository.test-catalog.yaml"
        ), "utf-8").toString());
        const data: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/defaults/correct_default.yaml"
        ), "utf-8").toString());

        const globalDefault: GlobalDefault = new GlobalDefault(data);
        const patches: any = (await globalDefault.patches({}, {}))[0];

        // Can correctly identify itself
        expect(patches.identify()).toEqual("defaults/global")

        const patchedCR: any = await patches.apply(crToUpdate);
        expect(patchedCR.spec.org).toEqual(data.globalValues.org);
        expect(
            patchedCR.spec.actions.oidc.useDefault
        ).toEqual(
        data.globalValues.actions.oidc.useDefault
        );
        expect(await patches.validate(patchedCR)).toEqual(true);
        patchedCR.spec.org = "a";
        expect(await patches.validate(patchedCR)).toEqual(false);
    });

    it("can correctly apply initializers and validate the results", async () => {
        const crToUpdate: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/crs/FirestartrGithubRepository.test-catalog.yaml"
        ), "utf-8").toString());
        const data: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/defaults/correct_default.yaml"
        ), "utf-8").toString());

        const initializerDefault: InitializerDefault = new InitializerDefault(data);
        const patches: any = (await initializerDefault.patches({}, {}))[0];

        // Can correctly identify itself
        expect(patches.identify()).toEqual("defaults/initializer")

        const patchedCR: any = await patches.apply(crToUpdate);
        expect(
            patchedCR.spec.firestartr.technology.stack
        ).not.toEqual(
        data.defaultValues.firestartr.technology.stack
        );
        expect(
            patchedCR.spec.repo.codeowners
        ).not.toEqual(
        data.defaultValues.repo.codeowners
        );
        expect(await patches.validate(patchedCR)).toEqual(true);

        crToUpdate.spec.firestartr.technology = {}
        crToUpdate.spec.repo = {}
        const patchedCRInitializersApplied: any = await patches.apply(crToUpdate);
        expect(
            patchedCRInitializersApplied.spec.firestartr.technology.stack
        ).toEqual(
        data.defaultValues.firestartr.technology.stack
        );
        expect(
            patchedCRInitializersApplied.spec.repo.allowAutoMerge
        ).toEqual(
        data.defaultValues.repo.allowAutoMerge
        );
        expect(
            patchedCRInitializersApplied.spec.repo.codeowners
        ).toEqual(
        data.defaultValues.repo.codeowners
        );
        expect(await patches.validate(patchedCRInitializersApplied)).toEqual(true);
        patchedCRInitializersApplied.spec.firestartr.technology = {}
        patchedCRInitializersApplied.spec.repo = {}
        expect(await patches.validate(patchedCRInitializersApplied)).toEqual(false);
    });

    it("can patch a CR using a previous CR as a base, instead of initializers", async () => {
        const crToUpdate: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/crs/FirestartrGithubRepository.test-catalog.yaml"
        ), "utf-8").toString());
        const previousCR: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/crs/FirestartrGithubRepository.test-catalog-2.yaml"
        ), "utf-8").toString());
        const data: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/defaults/correct_default.yaml"
        ), "utf-8").toString());

        const initializerDefault: InitializerDefault = new InitializerDefault(data);
        const patches: any = (await initializerDefault.patches({}, previousCR))[0];

        // Can correctly identify itself
        expect(patches.identify()).toEqual("defaults/initializer")

        let patchedCR: any = await patches.apply(crToUpdate);
        expect(patchedCR.spec.firestartr.technology).not.toEqual(
            previousCR.spec.firestartr.technology
        );
        expect(patchedCR.spec.repo).not.toEqual(previousCR.spec.repo);
        expect(await patches.validate(patchedCR)).toEqual(true);

        crToUpdate.spec.firestartr.technology = {}
        crToUpdate.spec.repo = {}

        patchedCR = await patches.apply(crToUpdate);
        expect(patchedCR.spec.firestartr.technology).toEqual(
            previousCR.spec.firestartr.technology
        );
        expect(patchedCR.spec.repo).toEqual(previousCR.spec.repo);
        expect(patchedCR.spec.firestartr.technology).not.toEqual(
            data.defaultValues.firestartr.technology
        );
        expect(patchedCR.spec.repo).not.toEqual(data.defaultValues.repo);
        expect(await patches.validate(patchedCR)).toEqual(true);

    });

    it("can merge an initializer array with the CR's array", async () => {
        const crToUpdate: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/crs/FirestartrGithubRepository.test-catalog.yaml"
        ), "utf-8").toString());
        const data: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/defaults/default_with_arrays.yaml"
        ), "utf-8").toString());

        const initializerDefault: InitializerDefault = new InitializerDefault(data);
        const patches: any = (await initializerDefault.patches({}, {}))[0];
        const patchedCR: any = await patches.apply(jsonPatch.deepClone(crToUpdate));
        expect(patchedCR.spec.permissions[0]).toEqual(crToUpdate.spec.permissions[0]);
        expect(patchedCR.spec.permissions[1]).toEqual(crToUpdate.spec.permissions[1]);
        expect(patchedCR.spec.permissions[4]).toEqual(data.defaultValues.permissions[0]);
        expect(patchedCR.spec.permissions[5]).toEqual(data.defaultValues.permissions[1]);
    });

    it("can merge a global array with the CR's array", async () => {
        const crToUpdate: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/crs/FirestartrGithubRepository.test-catalog.yaml"
        ), "utf-8").toString());
        const data: any = common.io.fromYaml(fs.readFileSync(path.join(
            __dirname, "fixtures/defaults/default_with_arrays.yaml"
        ), "utf-8").toString());

        const initializerDefault: GlobalDefault = new GlobalDefault(data);
        const patches: any = (await initializerDefault.patches({}, {}))[0];
        const patchedCR: any = await patches.apply(jsonPatch.deepClone(crToUpdate));
        expect(patchedCR.spec.permissions[0]).toEqual(crToUpdate.spec.permissions[0]);
        expect(patchedCR.spec.permissions[1]).not.toEqual(crToUpdate.spec.permissions[1]);
        expect(patchedCR.spec.permissions[2]).not.toEqual(crToUpdate.spec.permissions[2]);
        expect(patchedCR.spec.permissions[1]).toEqual(data.globalValues.permissions[2]);
        expect(patchedCR.spec.permissions[2]).toEqual(data.globalValues.permissions[3]);
        expect(patchedCR.spec.permissions[4]).toEqual(data.globalValues.permissions[0]);
        expect(patchedCR.spec.permissions[5]).toEqual(data.globalValues.permissions[1]);
    });

    it('is able to preserve claim-level defined blocks', async () => {

        const claim = {
            providers: {
                terraform: {
                    sync: {
                        enabled: true,
                        schedule: "@minutely"
                    }
                }
            }
        }

        const claimDefault = {
            providers: {
                terraform: {
                    sync: {
                        enabled: true,
                        period: "24h"
                    }
                }
            }
        }

        expect(
            applyBlockAwareDefaults(claim, claimDefault),
        ).toMatchObject({
            providers: {
                terraform: {
                    sync:{
                        enabled: true,
                        schedule: "@minutely"
                    }
                }
            }
        })

        expect(
            applyBlockAwareDefaults({
                providers: {
                    terraform: {}
                }
            }, claimDefault),
        ).toMatchObject({
            providers: {
                terraform: {
                    sync:{
                        enabled: true,
                        period: "24h"
                    }
                }
            }
        })


    })
});
