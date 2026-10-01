import { spawn } from 'child_process';
import common from 'catalog_common';
import { planGet } from './tf/analyzer';

import { PassThrough } from 'stream';

import log from './logger';

import type { ProcessHandler } from './process_handler';
import { processHandler } from './process_handler';

import * as fs from 'fs';

import * as path from 'path';

const TOFU_LOCK_TIMEOUT = '-lock-timeout=60s';

const MAX_APPLY_ATTEMPTS = 3;
const TRANSIENT_APPLY_RETRY_DELAY_MS = 1000;

const GITHUB_INCONSISTENT_APPLY_SIGNATURE = [
  'Provider produced inconsistent result after apply',
  'root object was present, but now absent',
];

/**
 * Matches the known GitHub provider eventual-consistency failure only.
 * Keep both markers so unrelated apply errors fail immediately.
 */
function isGitHubInconsistentApplyError(error: Error): boolean {
  const text = error.message;
  return GITHUB_INCONSISTENT_APPLY_SIGNATURE.every((line) =>
    text.includes(line),
  );
}

// ========== NEW HELPERS for workspace reuse validation ==========

// Returns true iff the rendered provider JSON would not be empty (so the providers file should exist)
import { WriterTerraform } from './writer_terraform';

export async function shouldWriteProviderJson(ctx: any): Promise<boolean> {
  // Technically ctx.backend and ctx.tfStateKey may be undefined for inline, which matches writer usage
  const rendered = await new WriterTerraform(
    ctx.requiredProviders || [],
    ctx.backend,
    ctx.tfStateKey,
    false,
  ).render('json');
  return rendered.trim() !== '';
}

/**
 * Compute the expected generated workspace files for Inline projects.
 */
export async function computeInlineWorkspaceFiles(ctx: any): Promise<string[]> {
  // Always required for Inline
  const files = ['firestartr-main.tf', 'terraform.tfvars.json', '.terraform'];
  // Providers file: Only if a provider JSON would be rendered
  if (await shouldWriteProviderJson(ctx)) {
    files.push('firestartr-providers.tf.json');
  }
  // Lock file: required if there are any providers
  if (ctx.requiredProviders && ctx.requiredProviders.length > 0) {
    files.push('.terraform.lock.hcl');
  }
  // NOTE: imports.tf is a command-scoped artifact; it must NOT be required for workspace reuse validation.
  // Additional files if any (e.g., from files spec)
  if (ctx.files && Array.isArray(ctx.files)) {
    for (const file of ctx.files) {
      if (file.path) files.push(file.path);
    }
  }
  return files;
}

/**
 * Compute the expected generated workspace files for Remote projects.
 */
export async function computeRemoteWorkspaceFiles(ctx: any): Promise<string[]> {
  // Always required for Remote
  const files = [
    'firestartr-terraform.tf',
    'terraform.tfvars.json',
    '.terraform',
  ];
  // Providers file: Only if a provider JSON would be rendered
  if (await shouldWriteProviderJson(ctx)) {
    files.push('firestartr-providers.tf.json');
  }
  // Lock file: required if there are any providers
  if (ctx.requiredProviders && ctx.requiredProviders.length > 0) {
    files.push('.terraform.lock.hcl');
  }
  // NOTE: imports.tf is a command-scoped artifact; it must NOT be required for workspace reuse validation.
  // Additional files if any (e.g., from files spec)
  if (ctx.files && Array.isArray(ctx.files)) {
    for (const file of ctx.files) {
      if (file.path) files.push(file.path);
    }
  }
  return files;
}

/**
 * Validate workspace structure: checks for existence of all required files/dirs.
 * Returns array of missing paths (or [] if all exist).
 */
export function validateWorkspaceStructure(
  projectPath: string,
  expectedFiles: string[],
): string[] {
  const absProjectPath = path.resolve(projectPath);
  return expectedFiles.filter((fileName) => {
    const filePath = path.resolve(absProjectPath, fileName);
    if (!filePath.startsWith(absProjectPath + path.sep)) {
      throw new Error(
        `Path traversal detected in expected workspace file: ${fileName}`,
      );
    }
    try {
      const stat = fs.statSync(filePath);
      // .terraform is the only directory entry; everything else must be a regular file
      if (fileName === '.terraform') return !stat.isDirectory();
      return !stat.isFile();
    } catch (e: any) {
      if (e.code === 'ENOENT') return true;
      throw e;
    }
  });
}
// ========== END NEW HELPERS ==========

export async function validate(path: string, secrets: any[]) {
  return await tfExec(path, ['validate'], secrets);
}

export async function init(
  path: string,
  secrets: any[],
  stream?: PassThrough,
  ctl?: ProcessHandler,
) {
  return await tfExec(path, ['init'], secrets, ['-input=false'], stream, ctl);
}

export async function initFromModule(
  path: string,
  source: string,
  secrets: any[],
  stream?: PassThrough,
  ctl?: ProcessHandler,
) {
  return tfExec(
    path,
    ['init', `-from-module=${source}`],
    secrets,
    [],
    stream,
    ctl,
  );
}

export async function plan(
  path: string,
  secrets: any[],
  format: 'human' | 'json',
  args = ['plan'],
  stream?: PassThrough,
  ctl?: ProcessHandler,
) {
  log.info(`Running terraform plan with ${format} in path ${path}`);

  const plan: any = await tfExec(
    path,

    args.concat(format === 'json' ? ['-json'] : []),

    secrets,

    ['-input=false'],

    stream,
    ctl,
  );

  if (format === 'json') {
    const tfPlan = planGet(plan);

    return tfPlan;
  }

  return plan;
}

export async function apply(
  path: string,
  secrets: any[],
  stream?: PassThrough,
  ctl?: ProcessHandler,
) {
  log.debug(`Running terraform apply in path ${path}`);

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_APPLY_ATTEMPTS; attempt++) {
    try {
      return await tfExec(
        path,
        ['apply', '-auto-approve', TOFU_LOCK_TIMEOUT],
        secrets,
        ['-input=false'],
        stream,
        ctl,
      );
    } catch (error) {
      lastError = error as Error;

      if (isGitHubInconsistentApplyError(lastError)) {
        if (attempt < MAX_APPLY_ATTEMPTS) {
          log.warn(
            `Transient GitHub provider apply error detected (attempt ${attempt} of ${MAX_APPLY_ATTEMPTS}); retrying after ${TRANSIENT_APPLY_RETRY_DELAY_MS}ms: ${GITHUB_INCONSISTENT_APPLY_SIGNATURE.join(', ')}`,
          );
          await common.generic.sleep(TRANSIENT_APPLY_RETRY_DELAY_MS);
          continue;
        }

        log.warn(
          `Transient GitHub provider apply error persisted after ${MAX_APPLY_ATTEMPTS} attempts; giving up.`,
        );
      }

      throw lastError;
    }
  }

  throw lastError;
}

export async function customCommand(
  path: string,
  secrets: any[],
  args: any[],
  stream?: PassThrough,
) {
  log.debug(
    `Running terraform customCommand in path ${path} ${args.join(',')}`,
  );
  return await tfExec(path, args, secrets, [], stream);
}

export async function destroy(
  path: string,
  secrets: any[],
  stream?: PassThrough,
  ctl?: ProcessHandler,
) {
  log.debug(`Running terraform destroy in path ${path}`);
  return await tfExec(
    path,
    ['destroy', '-auto-approve', TOFU_LOCK_TIMEOUT],
    secrets,
    ['-input=false'],
    stream,
    ctl,
  );
}

export async function output(path: string, secrets: any[]) {
  log.debug(`Running terraform output in path ${path}`);
  return await tfExec(path, ['output', '-json'], secrets, []);
}

export async function tfExec(
  path: string,
  args: Array<string>,
  secrets: any[],
  extraArgs = ['-input=false'],
  stream?: PassThrough,
  ctl?: ProcessHandler,
) {
  const env: any = {};
  const tfCacheDir =
    typeof ctl?.tfCacheDir === 'string' && ctl.tfCacheDir.trim() !== ''
      ? ctl.tfCacheDir
      : undefined;

  if (tfCacheDir) {
    env['TF_PLUGIN_CACHE_DIR'] = tfCacheDir;

    try {
      fs.mkdirSync(tfCacheDir, { recursive: true });
    } catch (error: any) {
      throw new Error(
        `Failed to create TF plugin cache directory "${tfCacheDir}": ${error?.message ?? error}`,
      );
    }
  }

  return new Promise((ok, ko) => {
    const tfProcess: any = spawn(
      'tofu',

      args.concat(extraArgs),

      {
        cwd: path,

        stdio: ['inherit', 'pipe', 'pipe'],

        env: {
          ...process.env,
          ...env,
        },
      },
    );

    let output = '';
    let flagStdoutEnd = false;
    let flagStderrEnd = false;
    let outputErrors = '';
    let processTimeout = false;

    tfProcess.stdout.on('data', (log: any) => {
      const line = common.io.stripAnsi(log.toString());

      output += line;

      if (stream) stream.write(line);
    });

    tfProcess.stderr.on('data', (log: any) => {
      const line = common.io.stripAnsi(log.toString());

      outputErrors += line;

      if (stream) stream.write(line);
    });

    tfProcess.stdout.on('end', () => {
      flagStdoutEnd = true;
    });

    tfProcess.stderr.on('end', () => {
      flagStderrEnd = true;
    });

    tfProcess.on('exit', async (code: any) => {
      let retryCount = 0;

      while (!flagStdoutEnd && !flagStderrEnd && retryCount < 10) {
        retryCount++;

        await common.generic.sleep(500);
      }

      // this process has been killed/terminated
      // by timeout (not in our control)
      if (processTimeout) {
        log.error(
          `Terraform output ${path}: ${[output, outputErrors].join('')}`,
        );
        ko(
          common.generic.buildCommandExecutionError(
            [output, outputErrors, '\n<PROCESS TIMEOUT>'].join(''),
            common.generic.normalizeExitCode(code),
            args.concat(extraArgs),
            {
              errorName: 'TerraformCommandError',
              label: 'Terraform command',
            },
          ),
        );

        return;
      }

      if (code !== 0) {
        log.error(
          `Terraform output ${path}: ${[output, outputErrors].join('')}`,
        );
        ko(
          common.generic.buildCommandExecutionError(
            [output, outputErrors].join(''),
            common.generic.normalizeExitCode(code),
            args.concat(extraArgs),
            {
              errorName: 'TerraformCommandError',
              label: 'Terraform command',
            },
          ),
        );
      } else {
        log.info(`Terraform output ${path}: ${output}`);
        ok(output);
      }
    });

    if (ctl) {
      void processHandler(tfProcess, ctl, () => {
        // callback to be called by the process handler
        // we set on our flag to avoid sending our own messages
        processTimeout = true;
      });
    }
  });
}

/**
 * Clone a remote repository as a git bare mirror.
 */
export async function gitCloneMirror(
  remoteUrl: string,
  mirrorPath: string,
): Promise<void> {
  return new Promise((ok, ko) => {
    const args = ['clone', '--mirror', remoteUrl, mirrorPath];
    const gitProcess = spawn('git', args, {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    gitProcess.stdout.on('data', (data: any) => {
      stdout += data.toString();
    });
    gitProcess.stderr.on('data', (data: any) => {
      stderr += data.toString();
    });
    gitProcess.on('close', (code: number | null, signal: string) => {
      if (code === 0) {
        ok();
      } else if (code === null) {
        ko(
          new Error(
            `git clone --mirror was killed by signal: ${signal}. ${stderr || stdout}`,
          ),
        );
      } else {
        ko(new Error(`git clone --mirror failed: ${stderr || stdout}`));
      }
    });
    gitProcess.on('error', (err: any) =>
      ko(new Error(`git spawn failed: ${err}`)),
    );
  });
}

/**
 * Perform a git remote update on an existing mirror repo.
 */
export async function gitRemoteUpdate(mirrorPath: string): Promise<void> {
  return new Promise((ok, ko) => {
    const gitProcess = spawn('git', ['remote', 'update'], {
      cwd: mirrorPath,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    gitProcess.stdout.on('data', (data: any) => {
      stdout += data.toString();
    });
    gitProcess.stderr.on('data', (data: any) => {
      stderr += data.toString();
    });
    gitProcess.on('close', (code: number | null, signal: string) => {
      if (code === 0) {
        ok();
      } else if (code === null) {
        ko(
          new Error(
            `git remote update was killed by signal: ${signal}. ${stderr || stdout}`,
          ),
        );
      } else {
        ko(new Error(`git remote update failed: ${stderr || stdout}`));
      }
    });
    gitProcess.on('error', (err: any) =>
      ko(new Error(`git spawn failed: ${err}`)),
    );
  });
}

/**
 * Run 'git fetch --prune' in a bare or mirror repository.
 * Throws if the operation fails.
 */
export async function gitFetchPrune(mirrorPath: string): Promise<void> {
  return new Promise((ok, ko) => {
    const gitProcess = spawn('git', ['fetch', '--prune'], {
      cwd: mirrorPath,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    gitProcess.stdout.on('data', (data: any) => {
      stdout += data.toString();
    });
    gitProcess.stderr.on('data', (data: any) => {
      stderr += data.toString();
    });
    gitProcess.on('close', (code: number | null, signal: string) => {
      if (code === 0) {
        ok();
      } else if (code === null) {
        ko(
          new Error(
            `git fetch --prune was killed by signal: ${signal}. ${stderr || stdout}`,
          ),
        );
      } else {
        ko(new Error(`git fetch --prune failed: ${stderr || stdout}`));
      }
    });
    gitProcess.on('error', (err: any) =>
      ko(new Error(`git spawn failed: ${err}`)),
    );
  });
}

const GITCONFIG_PATH = '/home/node/.gitconfig';

/**
 * Removes the credential-carrying /home/node/.gitconfig if it exists.
 * Idempotent; safe to call as many times as needed.
 */
export function removeGitConfig(): void {
  if (fs.existsSync(GITCONFIG_PATH)) {
    fs.rmSync(GITCONFIG_PATH);
  }
}

// Backstop: wipe the credential file when this process exits. In a container
// that barely reduces exposure — the filesystem dies with the process anyway.
// The real window is the pod lifetime: the token stays on disk by design
// because concurrent slots and the mirror refresher share this rewrite.
// Mode 0600 does not stop tofu or its providers, which run as the same user;
// that residual risk is SC-05 (#2818), out of scope for this change.
// Registered only against the synchronous 'exit' event so it never interferes
// with the operator's own graceful SIGINT/SIGTERM shutdown or tofu termination.
let gitConfigCleanupRegistered = false;
function ensureGitConfigExitCleanup(): void {
  if (gitConfigCleanupRegistered) {
    return;
  }
  gitConfigCleanupRegistered = true;
  process.once('exit', removeGitConfig);
}

/**
 * Writes the required url rewriting stanza to /home/node/.gitconfig based on the current org's GitHub App token.
 * This is the ONLY allowed implementation of project git-auth per package specs.
 *
 * When TFM_SKIP_GIT_CONFIG=true is set, the function removes any existing
 * /home/node/.gitconfig and returns early without writing a new one. This is
 * used in dev/test environments where no GitHub App credentials are available
 * (e.g. local dev, smoke tests using prefapp/tfm mirrors).
 */
export async function configGit() {
  if (process.env.TFM_SKIP_GIT_CONFIG === 'true') {
    removeGitConfig();
    return;
  }
  // Import github dynamically to avoid Jest ESM issues when not specifically running this function
  // (see CONSTITUTION and RULES: must not change test machinery)
  const githubModule = await import('github');
  const github = githubModule.default || githubModule;
  removeGitConfig();
  const org = common.environment.getFromEnvironment(common.types.envVars.org);
  // Provided in your code logic, but may wrap for null fallback if required
  // Here, github.getGithubAppToken is async as used elsewhere
  const ghToken = await (github as any).getGithubAppToken(org);
  // SC-04: both the rewrite base and insteadOf must carry a trailing slash.
  // Git insteadOf is a string prefix swap: if only insteadOf has the slash,
  // https://github.com/org/repo.git becomes https://firestartr:…@github.comorg/repo.git.
  // With both slashed, the rewrite is path-bounded (never github.com.attacker.tld)
  // and the resulting URL stays valid. Mode 0600 because the file holds a bearer token.
  // Residual: the token lives in the rewritten URL. If git prints that URL in an
  // error and it reaches logs, it leaks another way (SC-01), out of scope here.
  fs.writeFileSync(
    GITCONFIG_PATH,
    `[url "https://firestartr:${ghToken}@github.com/"]\ninsteadOf = https://github.com/\n`,
    { mode: 0o600 },
  );
  ensureGitConfigExitCleanup();
}
