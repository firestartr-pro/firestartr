import {
  apply,
  destroy,
  init,
  initFromModule,
  output,
  plan,
  validate,
  customCommand,
} from './utils';
import { WriterTerraform } from './writer_terraform';
import { WriterTfVarsJson } from './writer_tfvars_json';
import { WriterProviderJson } from './writer_provider_tf_json';
import { WriterImports } from './writer_imports';

import common from 'catalog_common';
import { spawn } from 'child_process';
import { error } from 'console';

import { WriterAdditionalFiles } from './writer_additional_files';
import { resolveMirroredModuleSource } from './mirror-repos';
import { configGit } from './utils';

import { PassThrough } from 'stream';

import log from './logger';
import type { ProcessHandler } from './process_handler';

import * as path from 'path';
import * as fs from 'fs';

import {
  computeRemoteWorkspaceFiles,
  validateWorkspaceStructure,
} from './utils';

export class TFProjectManagerRemote {
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

  writerTerraform: WriterTerraform;
  providerJsonWriter: WriterProviderJson;
  tfVarsJsonWriter: WriterTfVarsJson;
  additionalFilesWriter: WriterAdditionalFiles;
  ctx: any;
  secrets: any[];
  projectPath: string;
  tfOutput: any = '';
  stream: PassThrough;
  customArgs: any[] = [];
  onImport = false;
  _ctl?: ProcessHandler;

  constructor(ctx: any) {
    this.onImport = !!ctx.importMode;

    this.ctx = ctx;
    this.projectPath = ctx.projectPath;
    this.secrets = ctx.secrets;

    this.writerTerraform = new WriterTerraform(
      ctx.requiredProviders,
      ctx.backend,
      ctx.tfStateKey,
      false,
    );

    if ('tfStatePath' in this.ctx) {
      this.writerTerraform.tfStatePath = this.ctx['tfStatePath'];
    }

    this.providerJsonWriter = new WriterProviderJson(
      ctx.inline,
      ctx.requiredProviders,
      ctx.backend,
      ctx.tfStateKey,
    );

    if ('files' in ctx) {
      this.additionalFilesWriter = new WriterAdditionalFiles(ctx['files']);
    }

    this.tfVarsJsonWriter = new WriterTfVarsJson(ctx.values, ctx.references);
    this.onImport = !!ctx.importMode;
  }

  set ctl(ctl: ProcessHandler) {
    this._ctl = ctl;
  }

  get ctl(): ProcessHandler | undefined {
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
      const debug = require('./debug');
      await debug.initTfDebug(this.ctx);
    } catch (e: any) {
      // Best-effort; failures here should not block normal execution but
      // emit a warning so operators know why debug artifacts may be absent.
      log.warn(
        `[terraform-provisioner]: failed to init tf debug artifacts: ${e?.message ?? e}`,
      );
    }

    // Workspace reuse block for remote
    if (this.ctx?.reuseExistingProject) {
      if (!fs.existsSync(this.projectPath)) {
        throw new Error(
          `[terraform-provisioner]: Workspace reuse requested but projectPath does not exist: ${this.projectPath}. Cannot continue.`,
        );
      }
      const expectedFiles = await computeRemoteWorkspaceFiles(this.ctx);
      const missing = validateWorkspaceStructure(
        this.projectPath,
        expectedFiles,
      );
      if (missing.length === 0) {
        log.info(
          `[terraform-provisioner]: Reusing existing Remote workspace at ${this.projectPath}`,
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
      `[terraform-provisioner]: Creating new Remote workspace at ${this.projectPath}`,
    );
    fs.rmSync(this.projectPath, { recursive: true, force: true });

    await configGit();
    await this.__initFromModule();

    await this.writerTerraform.render();
    this.writerTerraform.writeToTerraformProject(
      path.join(this.projectPath, 'firestartr-terraform.tf'),
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
      undefined,
      this.ctl,
    );
  }

  async __initFromModule() {
    fs.mkdirSync(this.projectPath, { recursive: true });

    // Transparently resolve to a local mirror source if one is available/eligible
    const effectiveModuleSource = await resolveMirroredModuleSource(
      this.ctx.module,
    );
    this.tfOutput += await initFromModule(
      this.projectPath,
      effectiveModuleSource,
      this.secrets,
      undefined,
      this.ctl,
    );
  }

  async validate() {
    await this.__init();

    this.tfOutput += await validate(this.projectPath, this.secrets);
  }

  async plan(format: 'human' | 'json') {
    await this.__init();

    if (format === 'json') {
      this.tfOutput = await plan(
        this.projectPath,
        this.secrets,
        format,
        ['plan'],
        this.stream,
        this.ctl,
      );
    } else {
      this.tfOutput += await plan(
        this.projectPath,
        this.secrets,
        format,
        ['plan'],
        this.stream,
        this.ctl,
      );
    }

    if (this.stream) this.stream.end();
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

  async planDestroy(format: 'human' | 'json') {
    await this.__init();

    if (format === 'json') {
      this.tfOutput = await plan(this.projectPath, this.secrets, format, [
        'plan',
        '-destroy',
      ]);
    } else {
      this.tfOutput += await plan(this.projectPath, this.secrets, format, [
        'plan',
        '-destroy',
      ]);
    }
  }

  async output() {
    await this.__init();

    return await output(this.projectPath, this.secrets);
  }
}
