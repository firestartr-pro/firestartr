
// Mock the this.octokit object with the required methods
const mockOctokit = {
    rest: {
        repos: {
            get: jest.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
        },
        git: {
            getRef: jest.fn().mockResolvedValue({ data: { object: { sha: 'refsha' } } }),
            getCommit: jest.fn().mockResolvedValue({ data: { tree: { sha: 'commitsha' } } }),
            createTree: jest.fn().mockResolvedValue({ data: { sha: 'newtreesha' } }),
            createCommit: jest.fn().mockResolvedValue({ data: { sha: 'newcommitsha' } }),
            updateRef: jest.fn().mockResolvedValue({}),
        },
    },
};

jest.mock("github", () =>{

    return {

        getOctokitForOrg: function(org: string){
 
            return mockOctokit       
        }
    }


})

import {Scaffolder}  from "../src/scaffolder";
import * as path from 'path';
import * as child_process from 'child_process';
import * as fs from 'fs';

describe('scaffolder', () => {

    const scaffolder = new Scaffolder("firestartr-test");

    it('Should retrieve skeleton paths', async () => {

       let skeletonPaths = scaffolder.getSkeletonsPaths(path.join(__dirname, 'fixtures/catalog/.scaffolders'));

        expect(skeletonPaths).toEqual(['skeleton1', 'skeleton2']);

    });

    it('Should retrieve files in directories', async () => {

        const files = scaffolder.getFilesInDirectory(path.join(__dirname, 'fixtures/catalog/.scaffolders/skeleton1'));

        expect(files.length).toBe(2)

    });

    it('Should create tree', async () => {

       const tree = scaffolder.createTree([
            {
              fullPath: path.join(__dirname,'fixtures/catalog/.scaffolders/skeleton1/myfile.file'),
              relativePath: 'myfile.file'
            },
            {
              fullPath: path.join(__dirname, 'fixtures/catalog/.scaffolders/skeleton1/mysecondfile.file'),
              relativePath: 'mysecondfile.file'
            }
          ],
          "tmp"
        );

        expect(tree).toEqual([
            {
                path: 'tmp/myfile.file',
                mode: '100644',
                type: 'blob',
                content: ''
            },
            {
                path: 'tmp/mysecondfile.file',
                mode: '100644',
                type: 'blob',
                content: 'test-content\n'
            }
        ])

    });


    it('should sync the catalog scaffolders', async () => {
        // Set up the test data and environment
        const finalPath = path.join("/tmp/", '.scaffolders');

        

        scaffolder.octokit = mockOctokit;

        child_process
            .execSync(`cp -r ${path.join(__dirname, 'fixtures/catalog/.scaffolders')} /tmp/`)

        expect(fs.existsSync(path.join(finalPath, 'skeleton1'))).toBe(true)
        expect(fs.existsSync(path.join(finalPath, 'skeleton2'))).toBe(true)

        await scaffolder.syncSkeletons(finalPath, 'test')

        expect(fs.existsSync(path.join(finalPath, 'skeleton1'))).toBe(false)
        expect(fs.existsSync(path.join(finalPath, 'skeleton2'))).toBe(false)


      });


});
