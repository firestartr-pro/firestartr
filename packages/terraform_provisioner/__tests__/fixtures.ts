import * as fs from 'fs';
import common from 'catalog_common';

export const getCrFn = (path: string) => {

    return  common.io.fromYaml(fs.readFileSync(path, 'utf8'));

}


describe('test', () => {

        it('test', () => {

            expect(true).toBe(true);

        });

    } );
