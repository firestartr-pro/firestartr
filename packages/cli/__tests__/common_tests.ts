import * as path from "path";
import * as fs from "fs";

export const fixturesPath = path.join(__dirname, "fixtures");
export const fixturesCatalogPath = path.join(fixturesPath, "catalog");
export const fixturesCatalogDesiredPath = path.join(
  fixturesPath,
  "catalog_desired"
);



export const cretaionsFile = path.join(__dirname, "fixtures/creations.json");
export const deletionsFile = path.join(__dirname, "fixtures/deletions.json");
export const modificationsFile = path.join(
  __dirname,
  "fixtures/modifications.json"
);

export const deletionsPath = path.join(fixturesCatalogPath, "deletions");
export const deletedUser = path.join(
  deletionsPath,
  "users",
  "example-user-5.yaml"
);
export const deletedGroup = path.join(
  deletionsPath,
  "groups",
  "example-group-5.yaml"
);
export const deletedRepo = path.join(
  deletionsPath,
  "components",
  "example-component-4.yaml"
);

export const exampleCatalogFromCatalogManager = path.join(
  __dirname,
  "fixtures/mock_catalog"
);

export const expectedCatalogPath = "/"; // Will be forced in beforeAll()

export const expectedCreations = [
  {
    kind: "component",
    name: "example-component-3",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "group",
    name: "example-group-4",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "user",
    name: "example-user-4",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
];

export const expectedModifications = [
  {
    kind: "component",
    name: "example-component-1",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "component",
    name: "example-component-2",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "group",
    name: "example-group-1",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "group",
    name: "example-group-2",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "group",
    name: "example-group-3",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "user",
    name: "example-user-1",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "user",
    name: "example-user-2",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "user",
    name: "example-user-3",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
];

export const expectedDeletions = [
  {
    kind: "user",
    name: "example-user-5",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "group",
    name: "example-group-5",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
  {
    kind: "component",
    name: "example-component-4",
    updatedCatalogPath: fixturesCatalogDesiredPath,
  },
];

export function prepareModificationsFile(
  kind: "modifications" | "creations" | "deletions"
): string {
  let file: string = "";

  switch (kind) {
    case "creations":
      file = cretaionsFile;
      break;
    case "modifications":
      file = modificationsFile;
      break;
    case "deletions":
      file = deletionsFile;
      break;
  }

  const previousFileContents = fs.readFileSync(file, "utf-8");
  fs.writeFileSync(
    file,
    previousFileContents.replace(
      new RegExp("/library/packages/cli/__tests__/fixtures/catalog", "g"),
      fixturesCatalogPath
    )
  );

  return previousFileContents;
}

export function restoreModificationsFile(
  kind: "modifications" | "creations" | "deletions",
  previousContents: string
) {
  let file: string = "";

  switch (kind) {
    case "creations":
      file = cretaionsFile;
      break;
    case "modifications":
      file = modificationsFile;
      break;
    case "deletions":
      file = deletionsFile;
      break;
  }

  fs.writeFileSync(file, previousContents);
}

export function cleanProcessEnv(originalEnv: any) {
  process.env = {
    TERM: originalEnv.TERM,
    SHELL: originalEnv.SHELL,
    USER: originalEnv.USER,
    PATH: originalEnv.PATH,
    PWD: originalEnv.PWD,
    EDITOR: originalEnv.EDITOR,
    SHLVL: originalEnv.SHLVL,
    HOME: originalEnv.HOME,
    LOGNAME: originalEnv.LOGNAME,
    _: originalEnv._,
  };
}

// This is here only for avoid errors in tests
describe("#loading common_tests", () => {
  it("loaded", () => {
    expect(true).toBe(true);
  });
});
