import {
  apply,
  customCommand,
  destroy,
  init,
  output,
  plan,
  validate,
} from './utils';
import { WriterAdditionalFiles } from './writer_additional_files';
import { WriterImports } from './writer_imports';
import { WriterMainTf } from './writer_main_tf';
import { WriterProviderJson } from './writer_provider_tf_json';
import { WriterTfVarsJson } from './writer_tfvars_json';

import { PassThrough } from 'stream';

import * as fs from 'fs';
import * as path from 'path';

import log from './logger';
import type { ProcessHandler } from './process_handler';

import {
  computeInlineWorkspaceFiles,
  validateWorkspaceStructure,
} from './utils';

export class TFProjectManager {
  async tearUpProject() {
    const resolvedProjectPath = this.projectPath
      ? path.resolve(this.projectPath)
      : '';

    // Remove the entire workspace directory
    // Never delete debug workspaces. Support both gh-debug (existing) and
    // the new tf-debug workspace prefix.
    if (
      resolvedProjectPath &&
      (resolvedProjectPath.startsWith('/tmp/gh-debug/') ||
        resolvedProjectPath.startsWith('/tmp/tf-debug/') ||
        process.env.FIRESTARTR_DEBUG === 'true')
    ) {
      // Never delete debug workspaces, per spec.
      log.info(
        `[terraform-provisioner]: SKIP teardown for debug workspace at ${this.projectPath}`,
      );
      return;
    }
    if (
      resolvedProjectPath &&
      resolvedProjectPath.startsWith('/tmp/') &&
      resolvedProjectPath !== '/tmp'
    ) {
      try {
        fs.rmSync(resolvedProjectPath, {
          recursive: true,
          force: true,
        });
        log.info(
          `[terraform-provisioner]: Workspace at ${resolvedProjectPath} torn up successfully`,
        );
      } catch (e) {
        throw new Error(
          `[terraform-provisioner]: Failed to tear up local project at ${this.projectPath}: ${e}`,
        );
      }
    } else {
      throw new Error(
        `[terraform-provisioner]: Unsafe or missing projectPath for tear-up: ${this.projectPath}`,
      );
    }
  }

  ctx: any;
  mainTfWriter: WriterMainTf;
  providerJsonWriter: WriterProviderJson;
  tfVarsJsonWriter: WriterTfVarsJson;
  additionalFilesWriter: WriterAdditionalFiles;
  secrets: any[];
  projectPath: string;
  tfOutput: any = '';
  stream: PassThrough;
  _ctl?: ProcessHandler;

  customArgs: any[] = [];
  onImport = false;

  constructor(ctx: any) {
    this.onImport = !!ctx.importMode;

    this.ctx = ctx;
    // Normalize incoming debug project paths so the provisioner tolerates both
    // old (suffixed) and new (stripped) naming. If ctx.projectPath points to a
    // /tmp/tf-debug path, strip a trailing UUID-like suffix from the final
    // segment so reuse checks look at the deterministic folder.
    const incomingPath = ctx.projectPath as string;
    if (
      typeof incomingPath === 'string' &&
      incomingPath.startsWith('/tmp/tf-debug/')
    ) {
      const dir = path.dirname(incomingPath);
      const name = path.basename(incomingPath);
      // If the incoming debug folder includes a tfStateKey suffix, preserve
      // it when normalizing. We expect the operator to set projectPath to
      // `/tmp/tf-debug/<kind>-<baseName>-<tfStateKey>` when tfStateKey is
      // available. Strip only a trailing UUID-like suffix if present.
      const baseName = name.replace(
        /-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,
        '',
      );
      const normalized = path.join(dir, baseName);
      // If the deterministic folder exists, use it. If not, but there is an
      // existing legacy suffixed folder, fall back to that so we remain
      // tolerant of older operators that still write suffixed debug folders.
      if (fs.existsSync(normalized)) {
        this.projectPath = normalized;
      } else {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          const escapedBaseName = baseName.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&',
          );
          const legacyDirRegex = new RegExp(
            `^${escapedBaseName}-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$`,
          );
          const candidate = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .find((n) => legacyDirRegex.test(n));
          if (candidate) {
            // Prefer using the deterministic normalized path even if a
            // legacy suffixed candidate exists. Try to atomically rename the
            // legacy folder to the normalized name so subsequent runs use
            // a single, stable location. If rename fails, fall back to the
            // legacy candidate to avoid breaking execution.
            const candidatePath = path.join(dir, candidate);
            try {
              fs.renameSync(candidatePath, normalized);
              this.projectPath = normalized;
            } catch (renameErr) {
              // Renaming may fail (permissions, cross-fs). Fall back to
              // legacy candidate to preserve behavior.
              log.warn(
                `[terraform-provisioner]: failed to rename legacy debug folder ${candidatePath} -> ${normalized}: ${renameErr}`,
              );
              this.projectPath = candidatePath;
            }
          } else {
            this.projectPath = normalized;
          }
        } catch (e) {
          // If reading the directory fails for any reason, fall back to the
          // normalized path — this keeps behavior deterministic and avoids
          // throwing from the constructor.
          this.projectPath = normalized;
        }
      }
    } else {
      this.projectPath = ctx.projectPath;
    }

    // Ensure ctx.projectPath matches the resolved projectPath so subsequent
    // debug initialization (which reads ctx.projectPath) operates on the
    // same directory the project managers will write to. This prevents a
    // timing mismatch where debug.init creates the deterministic folder but
    // the project manager writes into a different (suffixed) folder.
    try {
      if (this.ctx && typeof this.ctx === 'object')
        this.ctx.projectPath = this.projectPath;
    } catch (e) {
      // Non-fatal: keep behavior deterministic even if we cannot mutate ctx
    }

    this.mainTfWriter = new WriterMainTf(
      ctx.inline,
      ctx.requiredProviders,
      ctx.backend,
      ctx.tfStateKey,
    );

    this.providerJsonWriter = new WriterProviderJson(
      ctx.inline,
      ctx.requiredProviders,
      ctx.backend,
      ctx.tfStateKey,
    );

    this.tfVarsJsonWriter = new WriterTfVarsJson(ctx.values, ctx.references);

    if ('files' in ctx) {
      this.additionalFilesWriter = new WriterAdditionalFiles(ctx['files']);
    }

    this.secrets = ctx.secrets;
    this.onImport = !!ctx.importMode;
  }

  set ctl(ctl: ProcessHandler) {
    this._ctl = ctl;
  }

  get ctl() {
    return this._ctl;
  }

  getOutput() {
    return this.tfOutput;
  }

  setStreamCallbacks(
    fnData: Function,
    fnEnd: (...args: any[]) => void,
    reopen = true,
  ) {
    if (reopen || !this.stream) this.stream = new PassThrough();

    this.stream.on('data', (data: Buffer) => {
      fnData(data.toString());
    });

    this.stream.on('end', fnEnd);
  }

  async build() {
    // If this context indicates a debug workspace, initialize debug artifacts
    // early so files like cr.yaml/deps.yaml are present before build steps.
    try {
      log.debug(
        `[terraform-provisioner]: build() start - ctx.projectPath=${this.ctx?.projectPath} projectPath=${this.projectPath}`,
      );
      const debug = require('./debug');
      await debug.initTfDebug(this.ctx);
      log.debug(
        `[terraform-provisioner]: build() after initTfDebug - ctx.projectPath=${this.ctx?.projectPath} projectPath=${this.projectPath}`,
      );
    } catch (e: any) {
      // Best-effort; failures here should not block normal execution but
      // emit a warning so operators know why debug artifacts may be absent.
      log.warn(
        `[terraform-provisioner]: failed to init tf debug artifacts: ${e?.message ?? e}`,
      );
    }

    if (this.ctx?.reuseExistingProject) {
      if (!fs.existsSync(this.projectPath)) {
        throw new Error(
          `[terraform-provisioner]: Workspace reuse requested but projectPath does not exist: ${this.projectPath}. Cannot continue.`,
        );
      }
      try {
        const entries = fs.readdirSync(this.projectPath);
        // Directory listing may contain user-supplied filenames; keep at debug level
        // to avoid leaking sensitive names in normal info logs.
        log.debug(
          `[terraform-provisioner]: reuse check - projectPath contents: ${JSON.stringify(
            entries,
          )}`,
        );
      } catch (e) {
        log.warn(
          `[terraform-provisioner]: failed to read projectPath ${this.projectPath}: ${e}`,
        );
      }
      const expectedFiles = await computeInlineWorkspaceFiles(this.ctx);
      // expectedFiles may include user-supplied paths; log at debug level only.
      log.debug(
        `[terraform-provisioner]: reuse check - expected files: ${JSON.stringify(
          expectedFiles,
        )}`,
      );
      const missing = validateWorkspaceStructure(
        this.projectPath,
        expectedFiles,
      );
      // Missing files may reveal internal filenames; keep at debug level.
      log.debug(
        `[terraform-provisioner]: reuse check - missing files: ${JSON.stringify(
          missing,
        )}`,
      );
      if (missing.length === 0) {
        log.info(
          `[terraform-provisioner]: Reusing existing Inline workspace at ${this.projectPath}`,
        );
        // imports.tf is command-scoped: always (re)generate it for import commands after reuse validation.
        if (this.onImport) {
          const writerImports = new WriterImports(this.customArgs);
          await writerImports.render();
          await writerImports.writeToTerraformProject(
            path.join(this.projectPath, 'imports.tf'),
          );

          // Always re-init backend after imports.tf is rebuilt (import mode)
          this.tfOutput += await init(
            this.projectPath,
            this.secrets,
            this.stream,
            this.ctl,
          );
        }

        return;
      }

      throw new Error(
        `[terraform-provisioner]: Workspace reuse requested but missing required files: ${missing.join(', ')}. Cannot continue.`,
      );
    }
    log.info(
      `[terraform-provisioner]: Creating new Inline workspace at ${this.projectPath}`,
    );
    await this.mainTfWriter.render();
    this.mainTfWriter.writeToTerraformProject(
      path.join(this.projectPath, 'firestartr-main.tf'),
    );

    await this.providerJsonWriter.render();
    this.providerJsonWriter.writeToTerraformProject(
      path.join(this.projectPath, 'firestartr-providers.tf.json'),
    );

    await this.tfVarsJsonWriter.render();
    this.tfVarsJsonWriter.writeToTerraformProject(
      path.join(this.projectPath, 'terraform.tfvars.json'),
    );

    if (this.additionalFilesWriter) {
      await this.additionalFilesWriter.render();
      await this.additionalFilesWriter.writeToTerraformProject(
        this.projectPath,
      );
    }

    if (this.onImport) {
      const writerImports = new WriterImports(this.customArgs);
      await writerImports.render();

      await writerImports.writeToTerraformProject(
        path.join(this.projectPath, 'imports.tf'),
      );

      // Note: for freshly built workspaces, __init() will run before the import command executes.
      // Only reuse mode needs an extra init immediately after regenerating imports.tf.
    }
  }

  async __init() {
    // When reuseExistingProject is set, the workspace is already initialized.
    // build() validated the workspace structure before allowing reuse.
    if (this.ctx?.reuseExistingProject) return;
    this.tfOutput += await init(
      this.projectPath,
      this.secrets,
      this.stream,
      this.ctl,
    );
  }

  async validate() {
    await this.__init();

    this.tfOutput += await validate(this.projectPath, this.secrets);
  }

  async plan(format: 'human' | 'json') {
    await this.__init();

    if (format === 'json') this.tfOutput = null;

    this.tfOutput = await plan(
      this.projectPath,
      this.secrets,
      format,
      ['plan'],
      this.stream,
      this.ctl,
    );

    if (this.stream) this.stream.end();
  }

  async planDestroy(format: 'human' | 'json') {
    await this.__init();

    if (format === 'json') this.tfOutput = null;

    this.tfOutput = await plan(
      this.projectPath,
      this.secrets,
      format,
      ['plan', '-destroy'],
      this.stream,
      this.ctl,
    );
  }

  async apply() {
    await this.__init();

    this.tfOutput += await apply(
      this.projectPath,
      this.secrets,
      this.stream,
      this.ctl,
    );

    if (this.stream) this.stream.end();
  }

  async customCommand() {
    await this.__init();

    if (this.customArgs.length < 1) {
      throw new Error('Error in customCommand: there are no customArgs to run');
    }

    this.tfOutput += await customCommand(
      this.projectPath,
      this.secrets,
      this.customArgs,
      this.stream,
    );

    if (this.stream) this.stream.end();
  }

  async customImport() {
    await this.__init();

    this.tfOutput += await apply(this.projectPath, this.secrets, this.stream);

    if (this.stream) this.stream.end();
  }

  async destroyStateOnly() {
    await this.__init();

    // let's list what the state has
    const addressesList = (
      (await customCommand(
        this.projectPath,
        this.secrets,
        ['state', 'list'],
        this.stream,
      )) as string
    )
      .split(/\n/)
      .filter((line: string) => line.replace(/\n|\s/g, ''));

    log.info(
      `[terraform-provisioner]: destroyStateOnly: Obtained the addresses of the resources ${addressesList.join(',')}`,
    );

    if (addressesList.length > 0) {
      await customCommand(
        this.projectPath,
        this.secrets,
        ['state', 'rm'].concat(addressesList),
        this.stream,
      );

      log.info(
        `[terraform-provisioner]: destroyStateOnly: deleted from the state the following addresses ${addressesList.join(',')}`,
      );
    } else {
      log.info(
        '[terraform-provisioner]: destroyStateOnly: warning the state is already empty, no destroy has taken place',
      );
    }

    if (this.stream) this.stream.end();
  }

  async destroy() {
    await this.__init();

    this.tfOutput += await destroy(
      this.projectPath,
      this.secrets,
      this.stream,
      this.ctl,
    );

    if (this.stream) this.stream.end();
  }

  async output() {
    await this.__init();

    return await output(this.projectPath, this.secrets);
  }
}
