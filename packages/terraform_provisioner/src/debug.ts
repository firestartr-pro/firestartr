import common from 'catalog_common';
import * as fs from 'fs/promises';
import * as path from 'path';
import log from './logger';

const DEBUG_PREFIX = '/tmp/tf-debug/';

export async function initTfDebug(ctx: any) {
  try {
    const projectPath = ctx?.projectPath;
    if (!projectPath || !projectPath.startsWith(DEBUG_PREFIX)) return;

    // Normalize projectPath by stripping a trailing UUID-like suffix from the
    // final path segment. This makes the debug folder deterministic even if
    // callers still supply a name with an embedded tfStateKey or uuid suffix.
    const dir = path.dirname(projectPath);
    const name = path.basename(projectPath);
    const baseName = name.replace(
      /-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,
      '',
    );
    const normalizedProjectPath = path.join(dir, baseName);

    // Ensure the session project dir and a dedicated subdir for
    // terraform_provisioner exist. Do NOT remove an existing deterministic
    // debug folder here — removing it during build() breaks the reuse
    // validation when build() is invoked a second time for output().
    await fs.mkdir(normalizedProjectPath, { recursive: true });
    const debugArtifactsDir = path.join(
      normalizedProjectPath,
      'tf_provisioner_debug',
    );
    await fs.mkdir(debugArtifactsDir, { recursive: true });

    // Write cr.yaml and deps.yaml if provided on context
    if (ctx.rawCr) {
      await fs.writeFile(
        path.join(debugArtifactsDir, 'cr.yaml'),
        common.io.toYaml(ctx.rawCr),
      );
    }

    if (ctx.deps) {
      await fs.writeFile(
        path.join(debugArtifactsDir, 'deps.yaml'),
        common.io.toYaml(ctx.deps),
      );
    }

    // Enable file logging for debug runs
    log.enableFileLogging(path.join(debugArtifactsDir, 'debug.log'));
  } catch (e: any) {
    log.warn(
      `[terraform-provisioner]: failed to init tf debug artifacts: ${e}`,
    );
  }
}

export async function writeTfOutput(projectPath: string, output: string) {
  try {
    if (!projectPath || !projectPath.startsWith(DEBUG_PREFIX)) return;

    const debugArtifactsDir = path.join(projectPath, 'tf_provisioner_debug');
    await fs.mkdir(debugArtifactsDir, { recursive: true });
    await fs.writeFile(
      path.join(debugArtifactsDir, 'terraform-output.txt'),
      output,
    );
  } catch (e: any) {
    log.warn(`[terraform-provisioner]: failed to write terraform output: ${e}`);
  }
}

export async function writeConfig(projectPath: string, config: any) {
  try {
    if (!projectPath || !projectPath.startsWith(DEBUG_PREFIX)) return;

    const debugArtifactsDir = path.join(projectPath, 'tf_provisioner_debug');
    await fs.mkdir(debugArtifactsDir, { recursive: true });
    await fs.writeFile(
      path.join(debugArtifactsDir, 'config.json'),
      JSON.stringify(config, null, 2),
    );
  } catch (e: any) {
    log.warn(`[terraform-provisioner]: failed to write config.json: ${e}`);
  }
}
