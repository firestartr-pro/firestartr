import { describe, expect, it } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  appInputsSchemaDir,
  loadAppInputsFile,
  parseAppInputsYaml,
} from '../src/schema/appInputs';

const PACKAGE_ROOT = process.cwd();
const SCHEMAS_DIR = appInputsSchemaDir(PACKAGE_ROOT);

const VALID_YAML = `
org: acme
app: billing
service:
  repo: billing-api
  release_type: node
  service_names:
    - billing-api
targets:
  - platform: eks-prod
    tenant: core
    env: dev
    cluster_url: https://eks-prod.example.com
    track: snapshots
    flavor: default
chart:
  name: web-service
  version: 1.2.3
  registry: ghcr
slack_channel: "#alerts"
owner: team-core
system: payments
`;

describe('AppInputs loader and validator', () => {
  it('accepts a valid YAML document with all optional fields', () => {
    const result = parseAppInputsYaml(VALID_YAML, SCHEMAS_DIR);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.app).toBe('billing');
      expect(result.data.targets).toHaveLength(1);
      expect(result.data.targets[0].track).toBe('snapshots');
    }
  });

  it('accepts a minimal valid YAML document without optional fields', () => {
    const minimal = `
app: billing
service:
  repo: billing-api
  release_type: node
targets:
  - platform: eks-prod
    tenant: core
    env: pro
    cluster_url: https://eks-prod.example.com
    track: releases
chart:
  name: web-service
  version: 1.2.3
  registry: ghcr
`;
    const result = parseAppInputsYaml(minimal, SCHEMAS_DIR);

    expect(result.valid).toBe(true);
  });

  it('rejects unknown properties with path information', () => {
    const withUnknown = `
app: billing
unknown_field: nope
service:
  repo: billing-api
  release_type: node
targets:
  - platform: eks-prod
    tenant: core
    env: dev
    cluster_url: https://eks-prod.example.com
    track: pre-releases
chart:
  name: web-service
  version: 1.2.3
  registry: ghcr
`;
    const result = parseAppInputsYaml(withUnknown, SCHEMAS_DIR);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('unknown_field'))).toBe(true);
    }
  });

  it('rejects invalid track enum and empty targets with instance paths', () => {
    const invalid = `
app: billing
service:
  repo: billing-api
  release_type: node
  service_names: []
targets:
  - platform: eks-prod
    tenant: core
    env: dev
    cluster_url: https://eks-prod.example.com
    track: nightly
chart:
  name: web-service
  version: 1.2.3
  registry: ghcr
`;
    const result = parseAppInputsYaml(invalid, SCHEMAS_DIR);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes('/targets/0/track'))).toBe(
        true,
      );
      expect(
        result.errors.some((e) => e.includes('/service/service_names')),
      ).toBe(true);
    }
  });

  it('reports YAML syntax errors', () => {
    const result = parseAppInputsYaml('app: [unclosed', SCHEMAS_DIR);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain('YAML parse error');
    }
  });

  it('loads and validates an inputs file from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'app-inputs-test-'));
    try {
      const filePath = join(dir, 'inputs.yaml');
      await writeFile(filePath, VALID_YAML, 'utf8');

      const result = await loadAppInputsFile(filePath, SCHEMAS_DIR);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.app).toBe('billing');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads schema from package root even when cwd is outside the package', () => {
    const prevCwd = process.cwd();
    try {
      process.chdir(tmpdir());
      const result = parseAppInputsYaml(
        VALID_YAML,
        appInputsSchemaDir(PACKAGE_ROOT),
      );
      expect(result.valid).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
