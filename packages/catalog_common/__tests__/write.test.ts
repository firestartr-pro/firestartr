import io from "../src/io";
import * as path from "path";
import * as fs from "fs";
import { fromYaml } from "../src/io/common";

describe("Write entity", () => {
  // Create a tmp directory for test writing
  const tmpPath = path.join("/tmp", "catalog_write_test" + Date.now());

  beforeAll(() => {
    if (!fs.existsSync(tmpPath)) {
      fs.mkdirSync(tmpPath);
    }

    ["components", "groups", "systems", "users"].forEach((folder) => {
      const folderPath = path.join(tmpPath, folder);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath);
      }
    });
  });

  it("Artifacts can be written and timestamp is added", () => {
    const destinationPath = path.join(tmpPath, "systems", "test.yaml");

    const exampleSystem = {
      apiVersion: "backstage.io/v1alpha1",
      kind: "System",
      metadata: {
        name: "test",
        description: "test system",
        annotations: {
          "fire-starter.dev/uuid:": "8d3babb9-e1f1-4a2c-af93-2a0466d3f76e",
        },
      },
      spec: {
        owner: "example",
        provisioner: { },
      },
    };

    io.writeEntity(exampleSystem, tmpPath);

    const artifactLoaded: any = fromYaml(
      fs.readFileSync(destinationPath).toString()
    );

    expect(fs.existsSync(destinationPath)).toBeTruthy();

    // Check annotation for timestamp exists
    expect(
      artifactLoaded.metadata?.annotations?.["fire-starter.dev/timestamp"]
    ).toBeDefined();
  });
});
