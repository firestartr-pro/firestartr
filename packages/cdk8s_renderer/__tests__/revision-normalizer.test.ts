import * as path from "path";
import * as fs from "fs";
import common from "catalog_common";

import { RevisionNormalizer } from "../src/normalizers/RevisionNormalizer";

describe('Revision normalizer', () => {

    it('Can increase revision', async () => {

        const crPath = path.join(__dirname, 'fixtures','normalizer-revision', 'cr.yaml');

        const previousCr =  common.io.fromYaml(fs.readFileSync(crPath, 'utf8'));

        const revisionNormalizer = new RevisionNormalizer()

        const patches = await revisionNormalizer.patches({}, previousCr)

        const modifiedCr = patches[0].apply(previousCr)

        console.log(modifiedCr)

        expect(modifiedCr.metadata.annotations['firestartr.dev/revision']).toEqual('2')

    });


    it('Can add a revision', async () => {

        const crPath = path.join(__dirname, 'fixtures','normalizer-revision', 'cr2.yaml');

        const previousCr =  common.io.fromYaml(fs.readFileSync(crPath, 'utf8'));

        const revisionNormalizer = new RevisionNormalizer()

        const patches = await revisionNormalizer.patches({}, previousCr)

        const modifiedCr = patches[0].apply(previousCr)

        console.log(modifiedCr)

        expect(modifiedCr.metadata.annotations['firestartr.dev/revision']).toEqual('1')

    });

    it('Fails on wrong revision format', async () => {
        
        try {

            expect.assertions(1)

            const crPath = path.join(__dirname, 'fixtures','normalizer-revision', 'cr-error.yaml');
    
            const previousCr =  common.io.fromYaml(fs.readFileSync(crPath, 'utf8'));
    
            const revisionNormalizer = new RevisionNormalizer()
    
            const patches = await revisionNormalizer.patches({}, previousCr)
    
            patches[0].apply(previousCr)


        } catch (e: any) {

            expect(e.message.includes('INVALID_REVISION')).toBeTruthy()

        }

    });

});
