import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import common from 'catalog_common';

import {
  disableRepositoryAdminEnforcement,
  disableRepositoryAdminEnforcementForFeatureRepos,
  disableRepositoryAdminEnforcementInManifest,
} from '../../src/repository-admin-enforcement';

const tempDirs: string[] = [];

async function writeManifestContent(content: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-admins-'));
  tempDirs.push(tempDir);
  const manifestPath = path.join(tempDir, 'manifest.yaml');
  await fs.writeFile(manifestPath, content, 'utf-8');
  return manifestPath;
}

describe('repository admin enforcement', () => {
  afterAll(async () => {
    await Promise.all(
      tempDirs.map((tempDir) =>
        fs.rm(tempDir, { recursive: true, force: true }),
      ),
    );
  });

  it('disables enforceAdmins on GitHub repository branch protections', () => {
    const resource = {
      kind: 'FirestartrGithubRepository',
      spec: {
        branchProtections: [
          {
            branch: 'main',
            enforceAdmins: true,
          },
          {
            branch: 'release',
          },
        ],
      },
    };

    expect(disableRepositoryAdminEnforcement(resource)).toBe(true);
    expect(resource.spec.branchProtections).toEqual([
      {
        branch: 'main',
        enforceAdmins: false,
      },
      {
        branch: 'release',
        enforceAdmins: false,
      },
    ]);
  });

  it('leaves non-repository resources unchanged', () => {
    const resource = {
      kind: 'FirestartrGithubGroup',
      spec: {
        branchProtections: [
          {
            branch: 'main',
            enforceAdmins: true,
          },
        ],
      },
    };

    expect(disableRepositoryAdminEnforcement(resource)).toBe(false);
    expect(resource.spec.branchProtections).toEqual([
      {
        branch: 'main',
        enforceAdmins: true,
      },
    ]);
  });

  it('leaves repository manifests unchanged without rendered feature CRs', async () => {
    const manifestPath = await writeManifestContent(
      `apiVersion: firestartr.dev/v1
kind: FirestartrGithubRepository
metadata:
  name: repo-a
spec:
  branchProtections:
    - branch: main
      enforceAdmins: true
`,
    );

    await disableRepositoryAdminEnforcementForFeatureRepos([manifestPath]);

    const resource = common.io.fromYaml(
      await fs.readFile(manifestPath, 'utf-8'),
    ) as {
      spec: {
        branchProtections: Array<{ enforceAdmins: boolean }>;
      };
    };
    expect(resource.spec.branchProtections[0].enforceAdmins).toBe(true);
  });

  it('disables repository admin enforcement for rendered feature repos', async () => {
    const repoPath = await writeManifestContent(
      `apiVersion: firestartr.dev/v1
kind: FirestartrGithubRepository
metadata:
  name: repo-a
spec:
  branchProtections:
    - branch: main
      enforceAdmins: true
`,
    );
    const featurePath = await writeManifestContent(
      `apiVersion: firestartr.dev/v1
kind: FirestartrGithubRepositoryFeature
metadata:
  name: feature-a
spec: {}
`,
    );

    await disableRepositoryAdminEnforcementForFeatureRepos([
      repoPath,
      featurePath,
    ]);

    const resource = common.io.fromYaml(
      await fs.readFile(repoPath, 'utf-8'),
    ) as {
      spec: {
        branchProtections: Array<{ enforceAdmins: boolean }>;
      };
    };
    expect(resource.spec.branchProtections[0].enforceAdmins).toBe(false);
  });

  it('updates only GitHub repository resources in multi-document manifests', async () => {
    const manifestPath = await writeManifestContent(
      `apiVersion: firestartr.dev/v1
kind: FirestartrGithubGroup
metadata:
  name: group-a
---
apiVersion: firestartr.dev/v1
kind: FirestartrGithubRepository
metadata:
  name: repo-a
spec:
  branchProtections:
    - branch: main
      enforceAdmins: true
`,
    );

    await disableRepositoryAdminEnforcementInManifest(manifestPath);

    const resources = (await fs.readFile(manifestPath, 'utf-8'))
      .split(/^---\s*$/m)
      .map((document) => common.io.fromYaml(document.trim())) as Array<{
      kind: string;
      spec?: {
        branchProtections?: Array<{ enforceAdmins: boolean }>;
      };
    }>;

    expect(resources[0].kind).toBe('FirestartrGithubGroup');
    expect(resources[1].spec?.branchProtections?.[0].enforceAdmins).toBe(false);
  });
});
