import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import common from 'catalog_common';
import {
  buildClaimRef,
  getRelatedCrKindsForClaimKind,
} from '../../src/claim-taxonomy';
import { findRenderedCrPaths, readClaimResource } from '../../src/cr-finder';

import type { TestContext } from '../../src/types';

describe('cr-finder org webhook support', () => {
  it('returns the user CR kind for user claims', () => {
    expect(getRelatedCrKindsForClaimKind('UserClaim')).toEqual([
      'FirestartrGithubMembership',
    ]);
  });

  it('returns the org webhook CR kind for org webhook claims', () => {
    expect(getRelatedCrKindsForClaimKind('OrgWebhookClaim')).toEqual([
      'FirestartrGithubOrgWebhook',
    ]);
  });

  it('returns the terraform workspace CR kind for tfworkspace claims', () => {
    expect(getRelatedCrKindsForClaimKind('TFWorkspaceClaim')).toEqual([
      'FirestartrTerraformWorkspace',
    ]);
  });

  it('accepts org webhook claims when reading claim resources', async () => {
    const context = {
      getFile: async () => 'kind: OrgWebhookClaim\nname: demo-hook\n',
      fromYaml: (content: string) => common.io.fromYaml(content),
    } as unknown as TestContext;

    await expect(readClaimResource(context, 'orgwebhook_a')).resolves.toEqual({
      kind: 'OrgWebhookClaim',
      name: 'demo-hook',
    });
  });

  it('accepts tfworkspace claims when reading claim resources', async () => {
    const context = {
      getFile: async () => 'kind: TFWorkspaceClaim\nname: demo-workspace\n',
      fromYaml: (content: string) => common.io.fromYaml(content),
    } as unknown as TestContext;

    await expect(readClaimResource(context, 'tfworkspace_a')).resolves.toEqual({
      kind: 'TFWorkspaceClaim',
      name: 'demo-workspace',
    });
  });

  it('rejects system claims as direct renderLocally resources', async () => {
    const context = {
      getFile: async () => 'kind: SystemClaim\nname: demo-system\n',
      fromYaml: (content: string) => common.io.fromYaml(content),
    } as unknown as TestContext;

    await expect(readClaimResource(context, 'system_a')).rejects.toThrow(
      "Unsupported claim kind 'SystemClaim' in system_a. Supported claim kinds: GroupClaim, UserClaim, ComponentClaim, TFWorkspaceClaim, OrgWebhookClaim, OrgSettingsClaim",
    );
  });

  it('rejects claims without a non-empty name', async () => {
    const context = {
      getFile: async () => 'kind: OrgWebhookClaim\nname: \n',
      fromYaml: (content: string) => common.io.fromYaml(content),
    } as unknown as TestContext;

    await expect(readClaimResource(context, 'orgwebhook_a')).rejects.toThrow(
      'Invalid claim in orgwebhook_a: expected non-empty claim name',
    );
  });

  it('finds rendered org webhook CRs by claim-ref annotation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-cr-finder-'));
    const matchingCrPath = path.join(tempDir, 'org-webhook.yaml');
    const otherCrPath = path.join(tempDir, 'other-org-webhook.yaml');

    try {
      await fs.writeFile(
        matchingCrPath,
        common.io.toYaml({
          apiVersion: 'firestartr.dev/v1',
          kind: 'FirestartrGithubOrgWebhook',
          metadata: {
            name: 'demo-hook',
            annotations: {
              [common.generic.getFirestartrAnnotation('claim-ref')]:
                'OrgWebhookClaim/demo-hook',
            },
          },
        }),
        'utf-8',
      );

      await fs.writeFile(
        otherCrPath,
        common.io.toYaml({
          apiVersion: 'firestartr.dev/v1',
          kind: 'FirestartrGithubOrgWebhook',
          metadata: {
            name: 'other-hook',
            annotations: {
              [common.generic.getFirestartrAnnotation('claim-ref')]:
                'OrgWebhookClaim/other-hook',
            },
          },
        }),
        'utf-8',
      );

      await expect(
        findRenderedCrPaths(
          tempDir,
          'OrgWebhookClaim',
          buildClaimRef('OrgWebhookClaim', 'demo-hook'),
        ),
      ).resolves.toEqual([matchingCrPath]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('finds rendered terraform workspace CRs by claim-ref annotation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-cr-finder-'));
    const matchingCrPath = path.join(tempDir, 'tfworkspace.yaml');
    const otherCrPath = path.join(tempDir, 'other-tfworkspace.yaml');

    try {
      await fs.writeFile(
        matchingCrPath,
        common.io.toYaml({
          apiVersion: 'firestartr.dev/v1',
          kind: 'FirestartrTerraformWorkspace',
          metadata: {
            name: 'demo-workspace',
            annotations: {
              [common.generic.getFirestartrAnnotation('claim-ref')]:
                'TFWorkspaceClaim/demo-workspace',
            },
          },
        }),
        'utf-8',
      );

      await fs.writeFile(
        otherCrPath,
        common.io.toYaml({
          apiVersion: 'firestartr.dev/v1',
          kind: 'FirestartrTerraformWorkspace',
          metadata: {
            name: 'other-workspace',
            annotations: {
              [common.generic.getFirestartrAnnotation('claim-ref')]:
                'TFWorkspaceClaim/other-workspace',
            },
          },
        }),
        'utf-8',
      );

      await expect(
        findRenderedCrPaths(
          tempDir,
          'TFWorkspaceClaim',
          buildClaimRef('TFWorkspaceClaim', 'demo-workspace'),
        ),
      ).resolves.toEqual([matchingCrPath]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
