import validate from './validate';

import Mustache from 'mustache';

import path from 'path';

import fs from 'fs';

import _ from 'lodash';

import log from './logger';

import common from 'catalog_common';

import { addTraceability } from './traceability';

import { validateFeatureArgs } from './featureArgsValidation';

export default function render(
  featurePath: string,
  featureRenderPath: string,
  entity: any,
  firestartrConfig: any = {},
  featureArgs: any = {},
) {
  const configData: any = validate(featurePath);

  validateArgsIfEnabled(featurePath, configData, featureArgs);

  const context: any = buildContext(
    entity,
    configData.args,
    firestartrConfig,
    featureArgs,
  );

  context.config = JSON.parse(
    renderContent(
      JSON.stringify(configData),

      context,
    ),
  );

  if ('filesTemplates' in context.config) {
    expandFiles(featurePath, configData, context);
  }

  const allowNonAnchoredPaths = allowsNonAnchoredPaths(configData);

  for (const file of context.config.files) {
    const { src, dest }: { src: string; dest: string } = file;

    if (allowNonAnchoredPaths) {
      assertNonEmptyString(src, 'file src');

      assertNonEmptyString(dest, 'file dest');
    } else {
      assertSafeRelativePath(src, 'file src');

      assertSafeRelativePath(dest, 'file dest');

      resolveInside(
        featurePath,
        path.join('templates', src),
        'file src',
        'feature directory',
      );

      resolveInside(
        featureRenderPath,
        dest,
        'file dest',
        'render target directory',
      );
    }
  }

  const output: any = { files: [], claimPatches: [] };

  context.config.files.forEach((file: any) => {
    const { src, dest }: { src: string; dest: string } = file;

    // For now let's keep upgradable flag for backward compatibility
    // by default it's false
    const userManaged = file.user_managed ?? file.upgradable ?? false;

    const targetBranch = file.target_branch ?? '';

    log.debug(`Rendering ${src} to ${dest}`);

    // render the content of the file
    const content = addTraceability(
      context,

      src,

      renderContent(
        fs.readFileSync(path.join(featurePath, 'templates', src)).toString(),

        context,
      ),
    );

    const destFilePath = path.join(`${featureRenderPath}`, dest);

    // write content to the destination file
    fs.mkdirSync(path.dirname(destFilePath), { recursive: true });

    fs.writeFileSync(destFilePath, content);

    // Include the file in the output
    output.files.push({
      localPath: destFilePath,

      repoPath: dest,

      userManaged: userManaged,

      targetBranch,
    });
  });

  // claimPatches are applied to the claim during claim stitching. Present in
  // the output even when empty or when the feature renders no files. The
  // legacy `patches` field is deliberately not copied: it is accepted in
  // config.yaml for backward compatibility but ignored for claim-level
  // behaviour.
  output.claimPatches = context.config.claimPatches || [];

  output.traceability = context.traceability;

  fs.mkdirSync(featureRenderPath, { recursive: true });

  fs.writeFileSync(
    path.join(featureRenderPath, 'config.json'),
    JSON.stringify(context.config),
  );

  // write the output file
  const configFile = path.join(featureRenderPath, 'output.json');

  fs.writeFileSync(configFile, JSON.stringify(output));

  return output;
}

export function getClaimPatches(
  featurePath: string,
  entity: any,
  firestartrConfig: any = {},
  featureArgs: any = {},
): any[] {
  const configData: any = validate(featurePath);
  validateArgsIfEnabled(featurePath, configData, featureArgs);
  const context: any = buildContext(
    entity,
    configData.args,
    firestartrConfig,
    featureArgs,
  );
  const rendered = JSON.parse(
    renderContent(JSON.stringify(configData), context),
  );
  return rendered.claimPatches ?? [];
}

export function buildContext(
  stitchedClaim: any,
  args: any,
  firestartrConfig: any,
  featureArgs: any,
) {
  const context: any = {};

  const resolveRef = (doc: any, ref: string[]): unknown => {
    const v: unknown = _.get(doc, ref);
    if (v !== undefined) return v;
    // Fallback for transition: try CR-shaped alternatives when stitchedClaim is CR-shaped
    // and vice versa. Covers the ADR 0006 table plus legacy feature_a provisioner paths.
    const altTable: Record<string, string[][]> = {
      'providers,github,org': [
        ['spec', 'org'],
        ['spec', 'provisioner', 'org'],
      ],
      'providers,github,branchStrategy,defaultBranch': [
        ['spec', 'repo', 'defaultBranch'],
        ['spec', 'provisioner', 'repo', 'defaultBranch'],
      ],
      'providers,github,name': [
        ['metadata', 'annotations', 'firestartr.dev/external-name'],
        ['metadata', 'name'],
      ],
      'providers,github,technology,stack': [
        ['spec', 'firestartr', 'technology', 'stack'],
        ['spec', 'provisioner', 'technology', 'stack'],
      ],
      name: [['metadata', 'name']],
      'annotations,firestartr.dev/dest-annotation': [
        ['metadata', 'annotations', 'firestartr.dev/dest-annotation'],
      ],
    };
    const key = ref.join(',');
    const alts = altTable[key];
    if (alts) {
      for (const alt of alts) {
        const av = _.get(doc, alt);
        if (av !== undefined) return av;
      }
    }
    // Reverse fallback: if ref is CR-shaped, try claim-shaped
    const reverseTable: Record<string, string[]> = {
      'spec,org': ['providers', 'github', 'org'],
      'spec,provisioner,technology,stack': [
        'providers',
        'github',
        'technology',
        'stack',
      ],
      'spec,firestartr,technology,stack': [
        'providers',
        'github',
        'technology',
        'stack',
      ],
      'metadata,name': ['name'],
      'metadata,annotations,firestartr.dev/dest-annotation': [
        'annotations',
        'firestartr.dev/dest-annotation',
      ],
      'spec,provisioner,org': ['providers', 'github', 'org'],
      'spec,provisioner,repo,defaultBranch': [
        'providers',
        'github',
        'branchStrategy',
        'defaultBranch',
      ],
      'spec,repo,defaultBranch': [
        'providers',
        'github',
        'branchStrategy',
        'defaultBranch',
      ],
      'metadata,annotations,firestartr.dev/external-name': [
        'providers',
        'github',
        'name',
      ],
    };
    const rev = reverseTable[ref.join(',')];
    if (rev) {
      const rv = _.get(doc, rev);
      if (rv !== undefined) return rv;
    }
    return v;
  };

  Object.entries(args).forEach(([key, arg]: [string, any]) => {
    if ('$default' in arg) {
      if (Array.isArray(arg['$default'])) {
        context[key] = resolveRef(stitchedClaim, arg['$default']);
      } else {
        context[key] = arg['$default'];
      }
    }

    if ('$ref' in arg) {
      const refValue = resolveRef(stitchedClaim, arg['$ref']);

      context[key] = refValue;
    } else if ('$lit' in arg) {
      context[key] = arg['$lit'];
    } else if ('$arg' in arg) {
      if (Object.prototype.hasOwnProperty.call(featureArgs, arg['$arg'])) {
        context[key] = featureArgs[arg['$arg']];
      }
    }
  });

  context.firestartrConfig = firestartrConfig;

  context.traceability = featureArgs['traceability'] || {};

  buildTemplateArgs(args, context);

  return context;
}
/**
 * Mutates the provided context object by adding properties for each argument
 * that has a `$template`, using the current context to render the template content.
 *
 * @param args - Argument definitions, where each entry may contain a `$template` key.
 * @param context - The context object to be mutated with rendered template values.
 * @returns void
 */
function buildTemplateArgs(args: any, context: any) {
  Object.entries(args).forEach(([key, arg]: [string, any]) => {
    if ('$template' in arg) {
      context[key] = renderContent(arg['$template'], context);
    }
  });
}

export function expandFiles(
  featurePath: string,
  configData: any,
  context: any,
) {
  let files = [];

  const allowNonAnchoredPaths = allowsNonAnchoredPaths(configData);

  for (const tpl of configData.filesTemplates) {
    const addToFiles = expandFilesTemplate(
      featurePath,
      tpl,
      context,
      allowNonAnchoredPaths,
    );

    files = files.concat(addToFiles).flat(Infinity);
  }

  context.config.files = context.config.files.concat(files).flat(Infinity);
}

function expandFilesTemplate(
  featurePath: string,
  tplPath: string,
  context: any,
  allowNonAnchoredPaths: boolean,
) {
  const templatePath = allowNonAnchoredPaths
    ? path.resolve(featurePath, tplPath)
    : resolveInside(
        featurePath,
        tplPath,
        'filesTemplates entry',
        'feature directory',
      );

  log.debug(`Expanding files section with template located at ${templatePath}`);

  let template: string;
  try {
    template = fs.readFileSync(templatePath).toString();
  } catch (err: any) {
    const message = err && err.message ? err.message : String(err);

    log.error(`Failed to read template file at "${templatePath}": ${message}`);

    throw new Error(
      `Failed to read template file at "${templatePath}": ${message}`,
    );
  }

  const renderedTemplate = renderContent(template, context);

  const data: any = common.io.fromYaml(renderedTemplate) || { files: [] };

  if (!data.files) data.files = [];

  return data.files.filter((file: any) => file);
}

export function renderContent(template: string, ctx: any) {
  return Mustache.render(template, ctx, {}, ['{{|', '|}}']);
}

export function assertNonEmptyString(
  value: unknown,
  what: string,
): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Feature path error: ${what} must be a non-empty string, got ${JSON.stringify(
        value,
      )}`,
    );
  }
}

export function assertSafeRelativePath(candidate: unknown, what: string) {
  assertNonEmptyString(candidate, what);

  if (path.isAbsolute(candidate)) {
    throw new Error(
      `Feature path error: ${what} "${candidate}" must be a relative path`,
    );
  }

  if (candidate.split(/[\\/]+/).includes('..')) {
    throw new Error(
      `Feature path error: ${what} "${candidate}" must not contain ".." path segments`,
    );
  }
}

function hasSymbolicLinkComponent(target: string): boolean {
  let current = target;

  for (;;) {
    try {
      return fs.realpathSync(current) !== current;
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        const parent = path.dirname(current);

        if (parent === current) {
          return false;
        }

        current = parent;

        continue;
      }

      throw err;
    }
  }
}

export function resolveInside(
  basePath: string,
  candidate: string,
  what: string,
  baseLabel: string,
) {
  assertSafeRelativePath(candidate, what);

  const root = path.resolve(basePath);

  const target = path.resolve(root, candidate);

  const relative = path.relative(root, target);

  const escaped =
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative);

  if (escaped) {
    throw new Error(
      `Feature path error: ${what} "${candidate}" escapes ${baseLabel} "${root}"`,
    );
  }

  if (hasSymbolicLinkComponent(target)) {
    throw new Error(
      `Feature path error: ${what} "${candidate}" must not traverse a symbolic link under ${baseLabel}`,
    );
  }

  return target;
}

export function allowsNonAnchoredPaths(configData: any): boolean {
  return configData?.meta?.allow_non_anchored_paths === true;
}

export function isFeatureArgsValidationEnabled(configData: any): boolean {
  return configData?.enable_validation === true;
}

function validateArgsIfEnabled(
  featurePath: string,
  configData: any,
  featureArgs: any,
): void {
  if (!isFeatureArgsValidationEnabled(configData)) {
    log.debug(
      `Feature ${featurePath} does not set enable_validation: true, skipping feature args validation`,
    );

    return;
  }

  validateFeatureArgs(featurePath, featureArgs);
}
