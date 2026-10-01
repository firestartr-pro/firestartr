import {initSystemFS} from "../src"

import path from "path"

import {EntityGHRepo} from "../src/entities/ghrepo"
import {Entity, PatchOperations} from "../src/entities/base"

// Mock the github module so we control repoExists
jest.mock('github');
import github from 'github';

// Type assertion for cleaner Jest mock usage
const mockRepoExists = github.repo.repoExists as jest.Mock;
const mockListBranches = github.branches.listBranches as jest.Mock;
const mockGetBranchProtection = github.repo.getBranchProtection as jest.Mock;

describe("EntityGHRepo entity", () => {
  let entity: EntityGHRepo;

  beforeEach(async () => {
    entity = await initSystemFS(
      path.join(__dirname, "fixtures/ghrepo/cr.yaml"),
      path.join(__dirname, "fixtures/ghrepo/deps.yaml"),
    ) as EntityGHRepo;
  });

   it("is able to render its values", async () => {
     expect(entity instanceof EntityGHRepo).toBe(true);
     mockRepoExists.mockResolvedValueOnce(false);
     await entity.loadResources("apply");
     expect(mockRepoExists).toHaveBeenCalled();
   });



   it("emits branch_protections config for legacy branchProtections in CR", async () => {
     mockRepoExists.mockResolvedValueOnce(false);
     await entity.loadResources("apply");
     const config = entity.document.config;
     expect(Array.isArray(config.branch_protections)).toBe(true);
     expect(config.branch_protections.length).toBe(1);
     expect(config.branch_protections[0].branch).toBe("main");
     // Explicit empty/non-empty arrays/booleans present
     expect(config.branch_protections[0].statusChecks).toEqual(["statuscheck1", "statuscheck2"]);
     expect(config.branch_protections[0].requiredReviewersCount).toBe(2);
     expect(config.branch_protections[0].requiredCodeownersReviewers).toBe(false);
     expect(config.branch_protections[0].enforceAdmins).toBe(true);
     expect(config.branch_protections[0].requireSignedCommits).toBe(true);
      expect(config.branch_protections[0].requireConversationResolution).toBe(false);
    });

    it("registers import entries for each CR branch protection only", async () => {
      // CR fixture has only one branchProtection: "main"
      await entity.loadResources("apply");
      await entity.loadAddressesToImport();

      const imports = entity.importDocument.imports;
      expect(imports).toEqual(
        expect.arrayContaining([
          {
            to: 'github_branch_protection.this["main"]',
            id: `${entity.cr.name}:main`,
          },
        ]),
      );

      // Should NOT include non-CR (discovered/remote) branches
      expect(imports).not.toEqual(
        expect.arrayContaining([
          {
            to: 'github_branch_protection.this["release"]',
            id: `${entity.cr.name}:release`,
          },
        ]),
      );
    });

  afterEach(() => {
    jest.restoreAllMocks();
  });

})

describe("hasDiscussions in provisionRepository", () => {
  let previousRefResolver: any;

  beforeAll(() => {
    previousRefResolver = Entity.refResolver;
    Entity.setRefResolver(() => null);
  });

  it("should pass hasDiscussions: true to config.repository", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main", hasDiscussions: true }
      }
    });

    await gh.provisionRepository();
    const config = gh.document.config;
    expect(config.repository.hasDiscussions).toBe(true);
  });

  it("should pass hasDiscussions: false to config.repository", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main", hasDiscussions: false }
      }
    });

    await gh.provisionRepository();
    const config = gh.document.config;
    expect(config.repository.hasDiscussions).toBe(false);
  });

  it("should pass undefined hasDiscussions when absent from CR spec", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" }
      }
    });

    await gh.provisionRepository();
    const config = gh.document.config;
    expect(config.repository.hasDiscussions).toBeUndefined();
  });

  afterAll(() => {
    Entity.setRefResolver(previousRefResolver);
  });
});

describe("validatePages logic", () => {
  let previousRefResolver: any;

  beforeAll(() => {
    previousRefResolver = Entity.refResolver;
    Entity.setRefResolver(() => null);
  });

  it("should succeed for creation when pages.branch equals defaultBranch", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "repo1" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: { source: { branch: "main" } }
      }
    });
    await expect(gh["validatePages"]("create", false)).resolves.toBeUndefined();
  });

  it("should throw for creation when pages.branch differs from defaultBranch", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "repo1" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: { source: { branch: "gh-pages" } }
      }
    });
    await expect(gh["validatePages"]("create", false)).rejects.toThrow(
      /Pages branch must equal default branch/
    );
  });

  it("should succeed for update if pages.branch != defaultBranch and branch exists remotely", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "repo2" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: { source: { branch: "gh-pages" } }
      }
    });
    gh.runWithGithubProvider = async (fn: any) => {
      await fn();
    };
    jest.spyOn(require("github").default.branches, "getBranch").mockResolvedValue({});
    await expect(gh["validatePages"]("update", true)).resolves.toBeUndefined();
  });

  it("should throw for update if pages.branch != defaultBranch and branch does not exist remotely", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "repo2" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: { source: { branch: "gh-pages" } }
      }
    });
    gh.runWithGithubProvider = async (fn: any) => {
      try { await fn(); } catch (e) { throw e; }
    };
    const error404 = new Error("Not Found");
    (error404 as any).status = 404;
    jest.spyOn(require("github").default.branches, "getBranch").mockRejectedValue(error404);
    await expect(gh["validatePages"]("update", true)).rejects.toThrow(
      /Pages branch 'gh-pages' does not exist/
    );
  });

  it("should throw when https_enforced is true and cname is absent", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "repo3" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: { https_enforced: true }
      }
    });
    await expect(gh["validatePages"]("apply", true)).rejects.toThrow(
      /https_enforced requires cname to be set/
    );
  });

  it("should succeed when https_enforced is true and cname is present", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "repo4" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: { https_enforced: true, cname: "example.com" }
      }
    });
    await expect(gh["validatePages"]("apply", true)).resolves.toBeUndefined();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Entity.setRefResolver(previousRefResolver);
  });
});

describe("provisionLabels - idempotent label imports", () => {
  let previousRefResolver: any;

  beforeAll(() => {
    previousRefResolver = Entity.refResolver;
    Entity.setRefResolver(() => null);
  });

  afterAll(() => {
    Entity.setRefResolver(previousRefResolver);
  });

  it("creates import entries for labels that already exist in GitHub", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        actions: { oidc: { useDefault: true, includeClaimKeys: [] } },
        permissions: [],
        repo: {
          defaultBranch: "main",
          labels: [
            { name: "label1", color: "ffffff", description: "" },
            { name: "label2", color: "000000", description: "" },
          ],
        },
      },
    });

    // Mock runWithGithubProvider to avoid credential resolution
    // and directly simulate the GitHub API responses
    let callCount = 0;
    gh.runWithGithubProvider = async (_fn: any) => {
      callCount++;
      if (callCount === 1) return true; // repoExists
      // getRepoIssuesLabels - only label1 exists in GitHub
      return [
        { name: "label1", color: "ffffff", description: "" },
      ];
    };

    const patchImportDataSpy = jest.spyOn(gh, "patchImportData");

    await gh.loadResources("apply");

    // Should add import for label1 (exists in GitHub) but not label2 (doesn't exist)
    const labelImports = patchImportDataSpy.mock.calls.filter(
      (call) =>
        call[0].value.to && call[0].value.to.includes('github_issue_label'),
    );
    expect(labelImports.length).toBe(1);
    expect(labelImports[0][0].value.to).toBe(
      'github_issue_label.this["label1"]',
    );
    expect(labelImports[0][0].value.id).toBe("test-repo:label1");
  });

  it("does not create import entries when no labels exist in GitHub", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        actions: { oidc: { useDefault: true, includeClaimKeys: [] } },
        permissions: [],
        repo: {
          defaultBranch: "main",
          labels: [
            { name: "label1", color: "ffffff", description: "" },
          ],
        },
      },
    });

    let callCount = 0;
    gh.runWithGithubProvider = async (_fn: any) => {
      callCount++;
      if (callCount === 1) return true; // repoExists
      return []; // getRepoIssuesLabels - no labels exist
    };

    const patchImportDataSpy = jest.spyOn(gh, "patchImportData");

    await gh.loadResources("apply");

    const labelImports = patchImportDataSpy.mock.calls.filter(
      (call) =>
        call[0].value.to && call[0].value.to.includes('github_issue_label'),
    );
    expect(labelImports.length).toBe(0);
  });

  it("does not check for label imports when repo does not exist yet", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        actions: { oidc: { useDefault: true, includeClaimKeys: [] } },
        permissions: [],
        repo: {
          defaultBranch: "main",
          labels: [
            { name: "label1", color: "ffffff", description: "" },
          ],
        },
      },
    });

    gh.runWithGithubProvider = async (_fn: any) => {
      return false; // repoExists - false, repo doesn't exist
    };

    const patchImportDataSpy = jest.spyOn(gh, "patchImportData");

    await gh.loadResources("apply");

    const labelImports = patchImportDataSpy.mock.calls.filter(
      (call) =>
        call[0].value && call[0].value.to && call[0].value.to.includes('github_issue_label'),
    );
    expect(labelImports.length).toBe(0);
  });
});

describe("provisionLabels - import and drift correction", () => {
  let gh: EntityGHRepo;
  let patchImportDataSpy: jest.SpyInstance;
  let runWithGithubProviderMock: jest.Mock;

  const baseCr = {
    kind: "FirestartrGithubRepository",
    apiVersion: "firestartr.dev/v1",
    metadata: { name: "test-repo" },
    spec: {
      org: "testorg",
      actions: { oidc: { useDefault: true, includeClaimKeys: [] } },
      permissions: [],
      repo: {
        defaultBranch: "main",
      },
    },
  };

  beforeEach(() => {
    patchImportDataSpy = undefined as any;
    runWithGithubProviderMock = undefined as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function buildGh() {
    gh = new EntityGHRepo(baseCr);
    runWithGithubProviderMock = jest.fn();
    gh.runWithGithubProvider = runWithGithubProviderMock;
    patchImportDataSpy = jest.spyOn(gh, "patchImportData");
  }

  function labelImports() {
    return patchImportDataSpy.mock.calls.filter(
      (call: any[]) =>
        call[0].value.to && call[0].value.to.includes('github_issue_label'),
    );
  }

  it("generates import blocks for all pre-existing labels", async () => {
    buildGh();
    gh.cr.spec.repo.labels = [
      { name: "bug", color: "ff0000", description: "" },
      { name: "enhancement", color: "00ff00", description: "" },
    ];
    runWithGithubProviderMock
      .mockResolvedValueOnce(true) // repoExists
      .mockResolvedValueOnce([    // getRepoIssuesLabels — both exist
        { name: "bug", color: "ff0000", description: "" },
        { name: "enhancement", color: "00ff00", description: "" },
      ]);

    await gh.loadResources("apply");

    expect(runWithGithubProviderMock).toHaveBeenCalledTimes(2);
    expect(labelImports().length).toBe(2);
    expect(labelImports()[0][0].value.to).toBe(
      'github_issue_label.this["bug"]',
    );
    expect(labelImports()[1][0].value.to).toBe(
      'github_issue_label.this["enhancement"]',
    );
  });

  it("label not on GitHub gets no import entry", async () => {
    buildGh();
    gh.cr.spec.repo.labels = [
      { name: "feature", color: "0000ff", description: "" },
    ];
    runWithGithubProviderMock
      .mockResolvedValueOnce(true) // repoExists
      .mockResolvedValueOnce([]);  // getRepoIssuesLabels — none exist

    await gh.loadResources("apply");

    expect(labelImports().length).toBe(0);
  });

  it("API-normalizes pre-existing label with differing color/description before import", async () => {
    buildGh();
    gh.cr.spec.repo.labels = [
      { name: "bug", color: "ff0000", description: "A bug report" },
    ];
    runWithGithubProviderMock
      .mockResolvedValueOnce(true) // repoExists
      .mockResolvedValueOnce([    // getRepoIssuesLabels - different color/desc
        { name: "bug", color: "cccccc", description: "" },
      ])
      .mockResolvedValueOnce(undefined); // updateRepoLabel

    await gh.loadResources("apply");

    // 3 calls: repoExists, getRepoIssuesLabels, updateRepoLabel
    expect(runWithGithubProviderMock).toHaveBeenCalledTimes(3);
    expect(labelImports().length).toBe(1);
  });

  it("skips API normalize when label already matches CR values", async () => {
    buildGh();
    gh.cr.spec.repo.labels = [
      { name: "bug", color: "ff0000", description: "bug" },
    ];
    runWithGithubProviderMock
      .mockResolvedValueOnce(true) // repoExists
      .mockResolvedValueOnce([    // getRepoIssuesLabels - exact match
        { name: "bug", color: "ff0000", description: "bug" },
      ]);

    await gh.loadResources("apply");

    // Only 2 calls: repoExists, getRepoIssuesLabels (no updateRepoLabel needed)
    expect(runWithGithubProviderMock).toHaveBeenCalledTimes(2);
    expect(labelImports().length).toBe(1);
  });
});

describe("loadAddressesToImport - Pages import", () => {
  let previousRefResolver = Entity.refResolver;

  beforeAll(() => {
    previousRefResolver = Entity.refResolver;
    Entity.setRefResolver(() => null);
  });

  afterAll(() => {
    Entity.setRefResolver(previousRefResolver);
  });

  it("should add Pages import when spec.pages is defined", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: { source: { branch: "main", path: "/" } }
      }
    });

    // Mock patchImportData to capture calls
    const patchImportDataSpy = jest.spyOn(gh, "patchImportData");

    await gh.loadAddressesToImport();

    // Verify that patchImportData was called for Pages resource
    const pagesImportCall = patchImportDataSpy.mock.calls.find((call) =>
      call[0].value.to === "github_repository_pages.this[0]"
    );

    expect(pagesImportCall).toBeDefined();
    expect(pagesImportCall?.[0]).toEqual({
      op: "add",
      path: "/imports/-",
      value: {
        to: "github_repository_pages.this[0]",
        id: "test-repo",
      },
    });
  });

  it("should not add Pages import when spec.pages is undefined", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        // No pages defined
      }
    });

    const patchImportDataSpy = jest.spyOn(gh, "patchImportData");

    await gh.loadAddressesToImport();

    // Verify that patchImportData was NOT called for Pages resource
    const pagesImportCall = patchImportDataSpy.mock.calls.find((call) =>
      call[0].value.to === "github_repository_pages.this[0]"
    );

    expect(pagesImportCall).toBeUndefined();
  });

  it("should add both Pages and variables imports together", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: { source: { branch: "main" } }
      }
    });

    // Use patchData to set up variables in the document (same as provisionVariables does)
    gh.patchData({
      path: '/config/variables/-',
      op: PatchOperations.add,
      value: { variableName: "VAR1" },
    });
    gh.patchData({
      path: '/config/variables/-',
      op: PatchOperations.add,
      value: { variableName: "VAR2" },
    });

    const patchImportDataSpy = jest.spyOn(gh, "patchImportData");

    await gh.loadAddressesToImport();

    const importTos = patchImportDataSpy.mock.calls.map((call) => call[0].value.to);

    // Verify both Pages and variables imports are present
    expect(importTos).toContain("github_repository_pages.this[0]");
    expect(importTos).toContain('github_actions_variable.this["VAR1"]');
    expect(importTos).toContain('github_actions_variable.this["VAR2"]');
  });

  it("should use repository name as import id for Pages", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "my-custom-repo-name" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: { source: { branch: "main" } }
      }
    });

    const patchImportDataSpy = jest.spyOn(gh, "patchImportData");

    await gh.loadAddressesToImport();

    const pagesImportCall = patchImportDataSpy.mock.calls.find((call) =>
      call[0].value.to === "github_repository_pages.this[0]"
    );

    expect(pagesImportCall?.[0].value.id).toBe("my-custom-repo-name");
  });

  it("should add Pages import when spec.pages has buildType workflow", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: { buildType: "workflow" }
      }
    });

    const patchImportDataSpy = jest.spyOn(gh, "patchImportData");

    await gh.loadAddressesToImport();

    const pagesImportCall = patchImportDataSpy.mock.calls.find((call) =>
      call[0].value.to === "github_repository_pages.this[0]"
    );

    expect(pagesImportCall).toBeDefined();
    expect(pagesImportCall?.[0]).toEqual({
      op: "add",
      path: "/imports/-",
      value: {
        to: "github_repository_pages.this[0]",
        id: "test-repo",
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});

describe("provisionPages - buildType handling", () => {
  let previousRefResolver: any;

  beforeAll(() => {
    previousRefResolver = Entity.refResolver;
    Entity.setRefResolver(() => null);
  });

  it("should provision legacy pages with source when buildType is legacy", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: {
          buildType: "legacy",
          source: { branch: "main", path: "/docs" },
          cname: "example.com"
        }
      }
    });

    gh["provisionPages"]();

    const config = gh.document.config;
    expect(config.pages).toEqual({
      buildType: "legacy",
      source: {
        branch: "main",
        path: "/docs"
      },
      cname: "example.com"
    });
  });

  it("should provision workflow pages without source when buildType is workflow", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: {
          buildType: "workflow",
          cname: "example.com"
        }
      }
    });

    gh["provisionPages"]();

    const config = gh.document.config;
    expect(config.pages).toEqual({
      buildType: "workflow",
      cname: "example.com"
    });
    expect(config.pages.source).toBeUndefined();
  });

  it("should default to legacy buildType when buildType is not specified", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: {
          source: { branch: "main", path: "/" }
        }
      }
    });

    gh["provisionPages"]();

    const config = gh.document.config;
    expect(config.pages.buildType).toBe("legacy");
    expect(config.pages.source).toEqual({
      branch: "main",
      path: "/"
    });
  });

  it("should use defaultBranch when legacy pages source branch is not specified", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "develop" },
        pages: {
          buildType: "legacy"
        }
      }
    });

    gh["provisionPages"]();

    const config = gh.document.config;
    expect(config.pages.source).toEqual({
      branch: "develop",
      path: "/"
    });
  });

  it("should include public in config when defined", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: {
          source: { branch: "main" },
          public: true
        }
      }
    });

    gh["provisionPages"]();

    const config = gh.document.config;
    expect(config.pages.public).toBe(true);
  });

  it("should include https_enforced in config when defined", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: {
          source: { branch: "main" },
          cname: "example.com",
          https_enforced: true
        }
      }
    });

    gh["provisionPages"]();

    const config = gh.document.config;
    expect(config.pages.https_enforced).toBe(true);
  });

  it("should omit public from config when undefined", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: {
          source: { branch: "main" }
        }
      }
    });

    gh["provisionPages"]();

    const config = gh.document.config;
    expect(config.pages.public).toBeUndefined();
  });

  it("should omit https_enforced from config when undefined", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: {
          source: { branch: "main" }
        }
      }
    });

    gh["provisionPages"]();

    const config = gh.document.config;
    expect(config.pages.https_enforced).toBeUndefined();
  });

  it("should omit cname from config when undefined", async () => {
    const gh = new EntityGHRepo({
      kind: "FirestartrGithubRepository",
      apiVersion: "firestartr.dev/v1",
      metadata: { name: "test-repo" },
      spec: {
        org: "testorg",
        repo: { defaultBranch: "main" },
        pages: {
          source: { branch: "main" }
        }
      }
    });

    gh["provisionPages"]();

    const config = gh.document.config;
    expect(config.pages.cname).toBeUndefined();
  });

  afterAll(() => {
    Entity.setRefResolver(previousRefResolver);
  });
});
