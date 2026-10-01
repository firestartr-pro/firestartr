import Writer from './writer';

import * as fsasync from 'fs/promises';
import * as path from 'path';
import log from './logger';

/**
 * Represents a file to be written to the Terraform workspace.
 * @property content The file contents, base64-encoded. This will be decoded before writing to disk.
 * @property path The relative path (from the project root) where the file should be written.
 */
export interface FirestartrTerraformWorkspaceSpecFile {
  /**
   * The file contents, base64-encoded. This will be decoded before writing to disk.
   */
  content: string;

  /**
   * The relative path (from the project root) where the file should be written.
   */
  path: string;
}

type FirestartrTerraformWorkspaceSpecFiles =
  FirestartrTerraformWorkspaceSpecFile[];
export class WriterAdditionalFiles extends Writer {
  files: FirestartrTerraformWorkspaceSpecFile[];
  constructor(files: FirestartrTerraformWorkspaceSpecFiles) {
    super();
    this.files = files;
  }

  // This writer complies with the abstract Writer class but does not render content in the traditional sense.
  async _render() {
    return '';
  }

  async writeToTerraformProject(projectPath: string) {
    for (const file of this.files) {
      try {
        const targetPath = path.resolve(projectPath, file.path);
        const absProjectPath = path.resolve(projectPath);
        if (!targetPath.startsWith(absProjectPath + path.sep)) {
          throw new Error(`Path traversal detected: ${file.path}`);
        }

        await fsasync.mkdir(path.dirname(targetPath), { recursive: true });

        await fsasync.writeFile(
          targetPath,
          Buffer.from(file.content, 'base64').toString('utf8'),
        );
      } catch (err) {
        throw new Error(`Error writing additional file: ${file.path}: ${err}`);
      }
    }
  }
}
