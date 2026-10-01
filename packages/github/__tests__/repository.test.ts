import { listReleases, getContent, setContent, uploadFile, deleteFile, getRepoInfo, getRepoSecret, getBranchProtection, getTeams } from "../src/repository"
import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from "path"

jest.mock("../src/auth_installation", () =>{
    const getInstallationID = jest.fn(async function(org: string){ return '19234234' })

    return { getInstallationID }
})

jest.mock("@octokit/auth-app", () => {
  return {
    createAppAuth: function(){
      return async function(){
        return {
          token: "mocked-token"
        }
      }
    }
  }
})

jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    rest: {
      repos:{
        listReleases: () => {
          return {
            data: [
              { name: 'tech_docs: v0.2.0', tag_name: 'tech_docs-v0.2.0', commit: 'ae1e050' },
              { name: 'mocked: v1.0.0', tag_name: 'mocked-v1.0.0', commit: 'ae1e050' },
              { name: 'released: v0.0.1', tag_name: 'released-v0.0.1', commit: 'ae1e050' },
            ]
          };
        },
        getContent: (data: any) => {
          if (data.path === 'not/exists') {
            throw 'Does not exists';
          }

          return {
            data: {
              content: Buffer.from('Example content').toString('base64'),
              sha: '0ad123321',
            },
          }
        },
        createOrUpdateFileContents: (data: any) => {
          const neededOptions: string[] = [ 'owner', 'repo', 'path', 'message', 'content', 'branch' ];

          if ( data.path === '' && (data.sha !== undefined)) {
            throw 'sha must be undefined'
          }

          neededOptions.forEach(option => {
            if (!data[option] || (data[option] === undefined)) {
              throw `${option} must be defined`
            }
          });

          if ( data.path === 'not/exists' ) {
            if (data.sha !== undefined) {
              throw 'sha must be undefined for not/exists path'
            }
          } else if ( data.sha === undefined ) {
            throw 'sha must be defined'
          }



        },
        deleteFile: (data: any) => {
          const neededOptions: string[] = [ 'owner', 'repo', 'path', 'message', 'sha', 'branch' ];

          neededOptions.forEach(option => {
            if (!data[option] || (data[option] === undefined)) {
              throw `${option} must be defined`
            }
          });
        }
      },
      actions: {
        getRepoSecret: () => ({
          data: {
            name: 'ACTIONS_TOKEN',
            updated_at: '2026-07-17T09:00:00Z',
          },
        }),
      },
    },
    repos: {
      get: () => {
        return {
          data: {
            name: 'example',
            description: 'The estructure does not matter, this is a mocked response',
            owner: 'example-org',
          }
        }
      },
      getBranchProtection: () => {
        return {
          data: {
            custom: 'Custom protection response'
          }
        }
      },
      listTeams: () => {
        return {
          data: ['a-team', 'example', 'other-team']
        }
      }
    },
    request: () => {
      // Tar with a valid feature for tests
      const tarFile = path.join(__dirname, 'fixtures/features-tech_docs-v0.2.0.tar.gz');

      return {
        data: fs.readFileSync(tarFile)
      }
    },
  })),
}));

const mockedPluginFunction = jest.fn().mockReturnValue(Octokit);

beforeEach(() => {
  Octokit.plugin = mockedPluginFunction;
});

describe('#github.repository', () => {

  it.skip("Should be able to enumerate releases", async () => {
    expect((await listReleases("features")).length).toBeGreaterThan(0)
  });

  it.skip("Should be able to get the contents of a Github file", async () => {
    const content = await getContent(".release-please-manifest.json", "features", "prefapp")
    expect(content).not.toBeNull()
    expect(content).toMatch('Example content');
  })

  it.skip("Should be able to set contents to a Github file", async () => {
    // If function does not throw, no assertions must be made
    expect.assertions(0);
    try {
      await setContent('destination/file', 'File contents to upload', 'example-repo', 'owner', 'main', 'Test upload')
    } catch( e: any ) {
      console.log(`Unexpected error: ${e}`);
      expect(e).toBe(e);
    }
  });

  it("Should be able to upload a file to github", async () => {
    // If function does not throw, no assertions must be made
    expect.assertions(0);

    const exampleFilePath = path.join(__dirname, 'fixtures/exampleFile.txt');

    try {
      await uploadFile('destination/file', exampleFilePath, 'example-repo', 'owner', 'main', 'Test upload')
    } catch ( e: any ) {
      console.log(`Unexpected error: ${e}`);
      expect(e).toBe(e);
    }
  });

  it("Should throw if the file to upload to github does not exists", async () => {
    expect.assertions(1);
    try {
      await uploadFile('destination/file', '/path/does/not/exists', 'example-repo', 'owner', 'main', 'Test upload')
    } catch( e ) {
      expect(e).toMatch('/path/does/not/exists does not exists or is not readable')
    }
  });

  it("Should be able to delete a file from github", async () => {
    expect.assertions(0);

    try {
      await deleteFile('some/file', 'example-repo', 'owner', 'main', 'Test delete');
    } catch ( e: any ) {
      console.log(`Unexpected error: ${e}`);
      expect(e).toBe(e);
    }
  });

  it("Should throw an error if the file to delete does not exists", async () => {
    expect.assertions(1);

    try {
      await deleteFile('not/exists', 'example-repo', 'owner', 'main', 'Test delete');
    } catch ( e: any ) {
      expect(e).toMatch('File not/exists does not exist in example-repo');
    }
  });

  it("Should be able to get the repository information", async () => {
    const repoInfo = await getRepoInfo('example-org', 'example');
    expect(repoInfo).not.toBeNull();
    expect(repoInfo.name).toBe('example');
  });

  it("Should be able to get repository secret metadata", async () => {
    const repoSecret = await getRepoSecret('example-org', 'example', 'ACTIONS_TOKEN');
    expect(repoSecret.name).toBe('ACTIONS_TOKEN');
    expect(repoSecret.updated_at).toBe('2026-07-17T09:00:00Z');
  });

  it("Should be able to get branch protections", async () => {
    expect(await getBranchProtection('example-org', 'example', 'main')).not.toBeNull();
  })

  it("Should be able to get teams for a repo", async () => {
    expect(await getTeams('example-org', 'example')).not.toBeNull();
  })
})
