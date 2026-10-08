#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import Debug from 'debug';

let index;
try {
  ({ default: index } = await import('../dist/index.js'));
} catch {
  ({ default: index } = await import('../index.ts'));
}

const messageLog = Debug('firestartr:features_renderer:validate');

const INPUT_KIND = process.env.INPUT_KIND || 'ComponentClaim';

async function runRenderTests(featurePath) {
  const { tests } = index.auxiliar.loadAndValidateRenderTests(featurePath)

  const configData = index.validate(featurePath)

  for (const t of tests) {
    // Support both `claim` (new, stitchedClaim shape) and legacy `cr` for backward compat
    const claimRelPath = t.claim ?? t.cr;
    if (!claimRelPath) {
      throw new Error(`Test "${t.name}" must have \`claim\` (or legacy \`cr\`)`);
    }
    const claimPath = index.auxiliar.resolveCrPath(featurePath, claimRelPath)
    const claimDoc = index.auxiliar.loadYaml(claimPath);

    if (claimDoc.kind !== INPUT_KIND) {
      throw new Error(
        `Test "${t.name}" uses kind "${claimDoc.kind}" but expected "${INPUT_KIND}"`,
      );
    }

    const ctx = index.buildContext(claimDoc, configData.args, {}, t.args ?? {});

    const cfgResolved = JSON.parse(
      index.renderContent(JSON.stringify(configData), ctx),
    );

    // Mirror what render() does: expand filesTemplates so that the expected
    // output computed below matches the output.json produced by render().
    ctx.config = cfgResolved;
    if ('filesTemplates' in cfgResolved) {
      index.expandFiles(featurePath, configData, ctx);
    }

    messageLog(
      `Resolved config for test "${t.name}": %O`,
      JSON.stringify(cfgResolved, null, 2),
    );

    // temp dir is /tmp/<feature_name>/<test_name>
    const tmpDir = await index.auxiliar.mkNamedTmp(cfgResolved.feature_name, t.name);

    await index.render(
      featurePath,  // featurePath
      tmpDir,       // featureRenderPath
      claimDoc,     // entity / stitchedClaim
      {},           // firestartrConfig
      t.args ?? {}, // featureArgs from YAML
    );

    const resolvedConfig = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8'));
    const expected = index.auxiliar.buildExpectedOutput(resolvedConfig, tmpDir);

    const outputPath = path.join(tmpDir, 'output.json');
    if (!fs.existsSync(outputPath)) {
      throw new Error(`output.json not produced for test "${t.name}"`);
    }

    const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

    assert.deepStrictEqual(
      output,
      expected,
      `output.json mismatch for test "${t.name}"`,
    );

    // Ensure every declared file exists
    for (const f of resolvedConfig.files || []) {
      const destPath = path.join(tmpDir, f.dest);
      if (!fs.existsSync(destPath)) {
        throw new Error(`Missing file "${destPath}" for test "${t.name}"`);
      }
    }

    console.log(`[OK] ${featurePath} :: ${t.name} → ${tmpDir}`);
  }
}

/** ------------ main ------------ */

(async function main() {
  const featuresPaths = [];

  console.log('Validating features');

  for (const arg of process.argv.slice(2)) {
    featuresPaths.push(arg);
  }

  if (featuresPaths.length === 0) {
    console.log('No features supplied to validate');
  }

  const structuralErrors = {};
  const renderErrors = {};

  // Structural validation
  for (const featurePath of featuresPaths) {
    try {
      index.validate(featurePath);
      console.log(`[VALID] Structure OK: ${featurePath}`);
    } catch (error) {
      const msg = String(error?.message || error);
      structuralErrors[featurePath] = msg;
      console.error(`[INVALID] Structure FAILED: ${featurePath} :: ${msg}`);
    }
  }

  // Generic render conformance test, only for structurally valid features
  for (const featurePath of featuresPaths) {
    if (structuralErrors[featurePath]) continue;

    try {
      await runRenderTests(featurePath);
    } catch (err) {
      renderErrors[featurePath] = String(err?.message || err);
    }
  }

  if (Object.keys(structuralErrors).length > 0 || Object.keys(renderErrors).length > 0) {
    console.error('Some features failed validation');
    if (Object.keys(structuralErrors).length > 0) {
      console.error('— Structural errors:');
      console.table(structuralErrors);
    }
    if (Object.keys(renderErrors).length > 0) {
      console.error('— Generic test errors:');
      console.table(renderErrors);
    }
    process.exit(1);
  }

  console.log('All features validated successfully');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

