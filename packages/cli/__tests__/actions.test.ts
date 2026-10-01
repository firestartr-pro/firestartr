import {
  readKindFromYaml,
  parseFileList,
  removeFromActionsArray,
  checkUpdatesAndModifications,
} from "../src/actions";
import {
  fixturesCatalogPath,
  fixturesCatalogDesiredPath,
  cretaionsFile,
  deletionsFile,
  modificationsFile,
  deletedGroup,
  deletedRepo,
  deletedUser,
  deletionsPath,
  expectedCreations,
  expectedModifications,
} from "./common_tests";
import { ArtifactAction } from "../src/types";

describe("actions", () => {
  describe("#readKindFromYaml", () => {
    it("kind of component must be component", () => {
      expect(readKindFromYaml(deletedRepo)).toMatch("component");
    });

    it("kind of group must be group", async () => {
      expect(readKindFromYaml(deletedGroup)).toMatch("group");
    });

    it("kind of user must be user", async () => {
      expect(readKindFromYaml(deletedUser)).toMatch("user");
    });
  });

  describe("#parseFileList", () => {
    it("Shoud load a list of objects from modificacion.json", async () => {
      const list: ArtifactAction[] = parseFileList(
        modificationsFile,
        fixturesCatalogDesiredPath
      );
      expect(list.length).toBe(5);
      expect(list).toEqual(
        expect.arrayContaining([
          {
            kind: "user",
            name: "example-user-4",
            updatedCatalogPath: fixturesCatalogDesiredPath,
          },
          {
            kind: "group",
            name: "example-group-3",
            updatedCatalogPath: fixturesCatalogDesiredPath,
          },
          {
            kind: "group",
            name: "example-group-4",
            updatedCatalogPath: fixturesCatalogDesiredPath,
          },
          {
            kind: "component",
            name: "example-component-2",
            updatedCatalogPath: fixturesCatalogDesiredPath,
          },
          {
            kind: "component",
            name: "example-component-3",
            updatedCatalogPath: fixturesCatalogDesiredPath,
          },
        ])
      );
    });

    it("Shoud load a list of objects from creations.json", async () => {
      const list: ArtifactAction[] = parseFileList(
        cretaionsFile,
        fixturesCatalogDesiredPath
      );
      expect(list.length).toBe(6);
      expect(list[0]).toEqual({
        kind: "user",
        name: "example-user-1",
        updatedCatalogPath: fixturesCatalogDesiredPath,
      });
      expect(list[1]).toEqual({
        kind: "user",
        name: "example-user-2",
        updatedCatalogPath: fixturesCatalogDesiredPath,
      });
      expect(list[2]).toEqual({
        kind: "user",
        name: "example-user-3",
        updatedCatalogPath: fixturesCatalogDesiredPath,
      });
      expect(list[3]).toEqual({
        kind: "group",
        name: "example-group-1",
        updatedCatalogPath: fixturesCatalogDesiredPath,
      });
      expect(list[4]).toEqual({
        kind: "group",
        name: "example-group-2",
        updatedCatalogPath: fixturesCatalogDesiredPath,
      });
      expect(list[5]).toEqual({
        kind: "component",
        name: "example-component-1",
        updatedCatalogPath: fixturesCatalogDesiredPath,
      });
    });

    it("Shoud load a list of objects from deletions.json", async () => {
      const list: ArtifactAction[] = parseFileList(
        deletionsFile,
        deletionsPath
      );
      expect(list.length).toBe(3);
      expect(list[0]).toEqual({
        kind: "user",
        name: "example-user-5",
        updatedCatalogPath: deletionsPath,
      });
      expect(list[1]).toEqual({
        kind: "group",
        name: "example-group-5",
        updatedCatalogPath: deletionsPath,
      });
      expect(list[2]).toEqual({
        kind: "component",
        name: "example-component-4",
        updatedCatalogPath: deletionsPath,
      });
    });
  });

  describe("#removeFromArray", () => {
    it("Should remove equvalent entries from the origin array", () => {
      const oringalArray: ArtifactAction[] = [
        {
          kind: "user",
          name: "example-user-1",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "user",
          name: "example-user-2",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "user",
          name: "example-user-3",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "group",
          name: "example-group-1",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "group",
          name: "example-group-2",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "component",
          name: "example-component-1",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "component",
          name: "example-component-2",
          updatedCatalogPath: fixturesCatalogPath,
        },
      ];

      const emptyRemovalsArray: ArtifactAction[] = [];

      const notMacthRemovalsArray: ArtifactAction[] = [
        {
          kind: "user",
          name: "example-user-5",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "user",
          name: "example-user-6",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "user",
          name: "example-user-7",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "group",
          name: "example-group-8",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "group",
          name: "example-group-9",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "component",
          name: "example-component-10",
          updatedCatalogPath: fixturesCatalogPath,
        },
      ];

      const matchSomeArtifacts: ArtifactAction[] = [
        {
          kind: "user",
          name: "example-user-1",
          updatedCatalogPath: "/diferent/path/does/not/matter",
        },
        {
          kind: "user",
          name: "example-user-2",
          updatedCatalogPath: "/diferent/path/does/not/matter",
        },
        {
          kind: "group",
          name: "example-group-1",
          updatedCatalogPath: "/diferent/path/does/not/matter",
        },
        {
          kind: "component",
          name: "example-component-1",
          updatedCatalogPath: "/diferent/path/does/not/matter",
        },
        {
          kind: "system",
          name: "example-system-1",
          updatedCatalogPath: "/diferent/path/does/not/matter",
        },
      ];

      const expectedNewArray: ArtifactAction[] = [
        {
          kind: "user",
          name: "example-user-3",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "group",
          name: "example-group-2",
          updatedCatalogPath: fixturesCatalogPath,
        },
        {
          kind: "component",
          name: "example-component-2",
          updatedCatalogPath: fixturesCatalogPath,
        },
      ];

      expect(
        removeFromActionsArray(oringalArray, emptyRemovalsArray)
      ).toStrictEqual(oringalArray);
      expect(
        removeFromActionsArray(oringalArray, notMacthRemovalsArray)
      ).toStrictEqual(oringalArray);
      expect(
        removeFromActionsArray(oringalArray, matchSomeArtifacts)
      ).toStrictEqual(expectedNewArray);
    });
  });

  describe("#checkUpdatesAndModifications", () => {
    it("modifications and updates must be changed according to the previous file existance", () => {
      const originalCreations: ArtifactAction[] = parseFileList(
        cretaionsFile,
        fixturesCatalogDesiredPath
      );
      const originalModifications: ArtifactAction[] = parseFileList(
        modificationsFile,
        fixturesCatalogDesiredPath
      );

      const { creations, modifications } = checkUpdatesAndModifications(
        originalCreations,
        originalModifications,
        fixturesCatalogPath
      );

      expect(creations).toEqual(expect.arrayContaining(expectedCreations));
      expect(expectedCreations).toEqual(expect.arrayContaining(creations));
      expect(modifications).toEqual(
        expect.arrayContaining(expectedModifications)
      );
      expect(expectedModifications).toEqual(
        expect.arrayContaining(modifications)
      );
    });
  });
});
