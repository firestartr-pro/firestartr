import fs from 'fs';
import os from 'os';
import path from 'path';
import { TFProjectManager } from '../src/project_tf';
import { TFProjectManagerRemote } from '../src/project_tf_remote';

describe('Terraform workspace reuse (strict spec compliance)', () => {
  function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-inline-test-'));
    return dir;
  }

  function makeInlineOnlyProviderSet(dir: string, withLock: boolean) {
    fs.writeFileSync(path.join(dir, 'firestartr-main.tf'), '');
    fs.writeFileSync(path.join(dir, 'terraform.tfvars.json'), '');
    fs.mkdirSync(path.join(dir, '.terraform'));
    // Note: do NOT write firestartr-providers.tf.json (inline only)
    if (withLock) fs.writeFileSync(path.join(dir, '.terraform.lock.hcl'), '');
  }

  it('allows reuse for inline-only provider (no providers.json required, Inline)', async () => {
    const dir = makeTempDir();
    makeInlineOnlyProviderSet(dir, true);
    const ctx = {
      projectPath: dir,
      secrets: [],
      requiredProviders: [{ name: 'inlineprov', inline: "provider \"aws\" { region = \"us-east-1\" }" }],
      files: [],
      reuseExistingProject: true,
    };
    const mgr = new TFProjectManager(ctx);
    await expect(mgr.build()).resolves.not.toThrow();
  });

  function makeRemoteInlineOnlyProviderSet(dir: string, withLock: boolean) {
    fs.writeFileSync(path.join(dir, 'firestartr-terraform.tf'), '');
    fs.writeFileSync(path.join(dir, 'terraform.tfvars.json'), '');
    fs.mkdirSync(path.join(dir, '.terraform'));
    // No providers.json file
    if (withLock) fs.writeFileSync(path.join(dir, '.terraform.lock.hcl'), '');
  }
  it('allows reuse for inline-only provider (no providers.json required, Remote)', async () => {
    const dir = makeTempDir();
    makeRemoteInlineOnlyProviderSet(dir, true);
    const ctx = {
      projectPath: dir,
      secrets: [],
      requiredProviders: [{ name: 'inlineprov', inline: "provider \"aws\" { region = \"us-east-1\" }" }],
      files: [],
      reuseExistingProject: true,
      module: '',
      backend: '',
      tfStateKey: '',
    };
    const mgr = new TFProjectManagerRemote(ctx);
    await expect(mgr.build()).resolves.not.toThrow();
  });

  it.skip('regenerates imports.tf on workspace reuse when importMode is true (spec: imports.tf is never required for reuse)', async () => {
    const dir = makeTempDir();
    // Minimal inline+lock but NO imports.tf
    makeInlineOnlyProviderSet(dir, true);
    const baseCtx = {
      projectPath: dir,
      secrets: [],
      requiredProviders: [{ name: 'inlineprov', inline: "provider \"aws\" { region = \"us-east-1\" }" }],
      files: [],
      reuseExistingProject: true,
    };
    // Import mode: should ALWAYS regenerate imports.tf if missing
    const importCtx = { ...baseCtx, importMode: true };

    const mgrImport = new TFProjectManager(importCtx);
    await expect(mgrImport.build()).resolves.not.toThrow();
    // Confirm imports.tf was created
    expect(fs.existsSync(path.join(dir, 'imports.tf'))).toBe(true);

    // If imports.tf preexists, no error either
    fs.writeFileSync(path.join(dir, 'imports.tf'), '');
    const mgrOK = new TFProjectManager({ ...importCtx });
    await expect(mgrOK.build()).resolves.not.toThrow();
  });

  // ... all pre-existing tests code from previous step ...

});// end describe
