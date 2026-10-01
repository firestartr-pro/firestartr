import * as path from 'path';
import * as fs from 'fs';

import catalog_common from 'catalog_common';
import { ArtifactAction } from './types';

export function readKindFromYaml(path: string) {
  if (!fs.existsSync(path)) {
    throw `The yaml file ${path} does not exists or is not readable`;
  }

  const artifact: any = catalog_common.io.fromYaml(
    fs.readFileSync(path, { encoding: 'utf8' }),
  );
  return artifact.kind.toLowerCase();
}

export function parseFileList(
  jsonFile: string,
  catalogUpdatedPath = '/',
): ArtifactAction[] {
  // Load JSON file
  const filePaths = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

  // Parse to objects like { kind: "component", name: "example" }
  const modifiedObjects: ArtifactAction[] = filePaths.map(
    (filePath: string) => {
      const fullPath = path.join(catalogUpdatedPath, filePath);
      const fileName = path.basename(filePath, path.extname(fullPath));

      // kind will be determined by path, except for deletetions, which will be readed from yaml
      let objectKind: string = path.basename(path.dirname(fullPath));
      objectKind = objectKind.replace(/s$/, ''); // Remove trailing 's'

      if (objectKind === 'deletion') {
        objectKind = readKindFromYaml(fullPath);
      }

      const parentDir = path.dirname(path.dirname(fullPath)); // Get the full path to the parent folder
      return {
        kind: objectKind,
        name: fileName,
        updatedCatalogPath: parentDir,
      };
    },
  );

  return modifiedObjects;
}

export function removeFromActionsArray(
  originalArray: ArtifactAction[],
  removals: ArtifactAction[],
): ArtifactAction[] {
  return originalArray.filter((element) => {
    return !removals.some((removal) => {
      return removal.kind === element.kind && removal.name === element.name;
    });
  });
}

// Checks creations and modifications array to get the real creations and modifications
// based on the existance of the artifact in the current state of the catalog (the one which
// we are changing)
export function checkUpdatesAndModifications(
  originalCreations: ArtifactAction[],
  originalModifications: ArtifactAction[],
  mainCatalogPath: string,
): { creations: ArtifactAction[]; modifications: ArtifactAction[] } {
  const creations: ArtifactAction[] = [];
  const modifications: ArtifactAction[] = [];

  originalCreations.forEach((entry: ArtifactAction) => {
    const filePath = path.join(
      mainCatalogPath,
      `${entry.kind.toLowerCase()}s`,
      `${entry.name}.yaml`,
    );

    if (fs.existsSync(filePath)) {
      modifications.push(entry);
    } else {
      creations.push(entry);
    }
  });

  originalModifications.forEach((entry: ArtifactAction) => {
    const filePath = path.join(
      mainCatalogPath,
      `${entry.kind.toLowerCase()}s`,
      `${entry.name}.yaml`,
    );

    if (fs.existsSync(filePath)) {
      modifications.push(entry);
    } else {
      creations.push(entry);
    }
  });

  return { creations, modifications };
}
