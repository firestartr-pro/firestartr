import os from 'os';
import path from 'path';
import fs from 'fs';

import Ajv from 'ajv/dist/2020';
import schemas from '../src/claims/base/schemas';
import type { RendererTestContext } from './auxiliar';
import { createTestContext, rendererTestFixtures } from './auxiliar';

describe('TFWorkspaceClaim variants', () => {
  jest.setTimeout(30000);

  process.env.ORG = 'firestartr-test';

  let context: RendererTestContext;

  beforeAll(async () => {
    context = await createTestContext({});
  });

  beforeEach(async () => {
    context = await context.resetRendererState();
  });

  afterAll(async () => {
    await context.destroy();
  });

  describe('Seam 3: schema validation', () => {
    it('rejects variant override with prohibited field (source)', () => {
      const ajv = new Ajv({ useDefaults: true });
      ajv.addSchema(schemas.schemas);

      const validate = ajv.getSchema(
        'firestartr.dev://terraform/TerraformProviderVariant',
      );

      const invalidVariant = {
        name: 'bad',
        overrides: {
          source: 'Inline',
          values: { env: 'dr' },
        },
      };

      const valid = validate?.(invalidVariant);
      expect(valid).toBe(false);
    });

    it('rejects variant override with prohibited field (module)', () => {
      const ajv = new Ajv({ useDefaults: true });
      ajv.addSchema(schemas.schemas);

      const validate = ajv.getSchema(
        'firestartr.dev://terraform/TerraformProviderVariant',
      );

      const invalidVariant = {
        name: 'bad',
        overrides: {
          module: 'github.com/other/module',
          values: { env: 'dr' },
        },
      };

      const valid = validate?.(invalidVariant);
      expect(valid).toBe(false);
    });

    it('rejects variant override with unknown field (typo)', () => {
      const ajv = new Ajv({ useDefaults: true });
      ajv.addSchema(schemas.schemas);

      const validate = ajv.getSchema(
        'firestartr.dev://terraform/TerraformProviderVariantOverride',
      );

      const invalidOverrides = {
        reegion: 'eu-west-2',
        values: { env: 'dr' },
      };

      const valid = validate?.(invalidOverrides);
      expect(valid).toBe(false);
    });

    it('rejects variant override with prohibited field (name)', () => {
      const ajv = new Ajv({ useDefaults: true });
      ajv.addSchema(schemas.schemas);

      const validate = ajv.getSchema(
        'firestartr.dev://terraform/TerraformProviderVariantOverride',
      );

      const invalidOverrides = {
        name: 'custom-name',
        values: { env: 'dr' },
      };

      const valid = validate?.(invalidOverrides);
      expect(valid).toBe(false);
    });

    it('accepts valid variant overrides', () => {
      const ajv = new Ajv({ useDefaults: true });
      ajv.addSchema(schemas.schemas);

      const validate = ajv.getSchema(
        'firestartr.dev://terraform/TerraformProviderVariantOverride',
      );

      const validOverrides = {
        values: { env: 'dr', region: 'eu-west-2' },
        context: {
          providers: [{ name: 'aws-dr' }],
        },
        policy: 'observe',
        tfStateKey: '00000000-0000-4000-8000-000000000000',
        sync: { enabled: true, schedule: '@daily' },
      };

      const valid = validate?.(validOverrides);
      expect(valid).toBe(true);
    });

    it('accepts valid variant with minimal overrides', () => {
      const ajv = new Ajv({ useDefaults: true });
      ajv.addSchema(schemas.schemas);

      const validate = ajv.getSchema(
        'firestartr.dev://terraform/TerraformProviderVariant',
      );

      const minimalVariant = {
        name: 'minimal',
        overrides: {
          values: { env: 'staging' },
        },
      };

      const valid = validate?.(minimalVariant);
      expect(valid).toBe(true);
    });

    it('rejects variant name longer than 10 characters', () => {
      const ajv = new Ajv({ useDefaults: true });
      ajv.addSchema(schemas.schemas);

      const validate = ajv.getSchema(
        'firestartr.dev://terraform/TerraformProviderVariant',
      );

      const longVariant = {
        name: 'this-is-too-long',
        overrides: { values: { env: 'dr' } },
      };

      const valid = validate?.(longVariant);
      expect(valid).toBe(false);
    });

    it('rejects variant missing name', () => {
      const ajv = new Ajv({ useDefaults: true });
      ajv.addSchema(schemas.schemas);

      const validate = ajv.getSchema(
        'firestartr.dev://terraform/TerraformProviderVariant',
      );

      const invalidVariant = {
        overrides: { values: { env: 'dr' } },
      };

      const valid = validate?.(invalidVariant);
      expect(valid).toBe(false);
    });

    it('rejects variant missing overrides', () => {
      const ajv = new Ajv({ useDefaults: true });
      ajv.addSchema(schemas.schemas);

      const validate = ajv.getSchema(
        'firestartr.dev://terraform/TerraformProviderVariant',
      );

      const invalidVariant = {
        name: 'no-over',
      };

      const valid = validate?.(invalidVariant);
      expect(valid).toBe(false);
    });
  });

  describe('Seam 1: renderer integration', () => {
    it('renders parent claim and variant claims', async () => {
      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { crsPath: rendererTestFixtures.noCrs, excludeGithubCrs: true },
      );

      const catalogResources = Object.values(renderedMap).filter(
        (cr: any) => cr.kind === 'Resource',
      );

      const resourceNames = catalogResources.map(
        (cr: any) => cr.metadata.name,
      );

      expect(resourceNames).toContain('tfworkspace-variants');
      expect(resourceNames).toContain('parent-workspace-dr-eu');
      expect(resourceNames).toContain('parent-workspace-dr-us');
    });

    it('composes variant name from main tf name + variant suffix', async () => {
      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { crsPath: rendererTestFixtures.noCrs, excludeGithubCrs: true },
      );

      const catalogResources = Object.values(renderedMap).filter(
        (cr: any) => cr.kind === 'Resource',
      ) as any[];

      const drEuResource = catalogResources.find(
        (cr: any) => cr.metadata.name === 'parent-workspace-dr-eu',
      );

      expect(drEuResource).toBeDefined();
      expect(drEuResource?.spec?.values?.name).toBe('parent-workspace-dr-eu');
    });

    it('deep-merges variant provider from parent with overrides', async () => {
      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { crsPath: rendererTestFixtures.noCrs, excludeGithubCrs: true },
      );

      const catalogResources = Object.values(renderedMap).filter(
        (cr: any) => cr.kind === 'Resource',
      );

      const parentResource = catalogResources.find(
        (cr: any) => cr.metadata.name === 'tfworkspace-variants',
      ) as any;

      const drEuResource = catalogResources.find(
        (cr: any) => cr.metadata.name === 'parent-workspace-dr-eu',
      ) as any;

      const drUsResource = catalogResources.find(
        (cr: any) => cr.metadata.name === 'parent-workspace-dr-us',
      ) as any;

      const parentTf = parentResource?.spec?.values;
      const euTf = drEuResource?.spec?.values;
      const usTf = drUsResource?.spec?.values;

      expect(parentTf.name).toBe('parent-workspace');
      expect(parentTf.values.env).toBe('prod');
      expect(parentTf.values.region).toBe('eu-west-1');
      expect(parentTf.values.instance_count).toBe(3);
      expect(parentTf.source).toBe('Remote');
      expect(parentTf.module).toBe(
        'https://github.com/infra/shared-module@main',
      );

      expect(euTf.name).toBe('parent-workspace-dr-eu');
      expect(euTf.values.env).toBe('dr');
      expect(euTf.values.region).toBe('eu-west-2');
      expect(euTf.values.instance_count).toBe(1);
      expect(euTf.source).toBe('Remote');
      expect(euTf.module).toBe(
        'https://github.com/infra/shared-module@main',
      );

      expect(usTf.name).toBe('parent-workspace-dr-us');
      expect(usTf.values.env).toBe('dr-us');
      expect(usTf.values.region).toBe('us-west-1');
      expect(usTf.values.instance_count).toBe(3);
      expect(usTf.source).toBe('Remote');
      expect(usTf.module).toBe(
        'https://github.com/infra/shared-module@main',
      );
    });

    it('sets variant-of annotation on variant firestartr CRs', async () => {
      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { crsPath: rendererTestFixtures.noCrs, excludeGithubCrs: true },
      );

      const firestartrCrs = Object.values(renderedMap).filter(
        (cr: any) => cr.kind === 'FirestartrTerraformWorkspace',
      );

      const variantCrs = firestartrCrs.filter(
        (cr: any) =>
          (cr as any).metadata?.annotations?.['firestartr.dev/variant-of'],
      );

      const nonVariantCrs = firestartrCrs.filter(
        (cr: any) =>
          !(cr as any).metadata?.annotations?.['firestartr.dev/variant-of'],
      );

      expect(nonVariantCrs.length).toBe(1);
      expect(variantCrs.length).toBe(2);

      for (const variantCr of variantCrs) {
        expect(
          (variantCr as any).metadata.annotations['firestartr.dev/variant-of'],
        ).toBe('parent-workspace');
      }
    });

    it('sets claim-ref annotation on variant CRs', async () => {
      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { crsPath: rendererTestFixtures.noCrs, excludeGithubCrs: true },
      );

      const firestartrCrs = Object.values(renderedMap).filter(
        (cr: any) => cr.kind === 'FirestartrTerraformWorkspace',
      );

      const variantCr = firestartrCrs.find(
        (cr: any) =>
          cr.metadata?.annotations?.['firestartr.dev/variant-of'],
      );

      expect(
        (variantCr as any)?.metadata?.annotations?.['firestartr.dev/claim-ref'],
      ).toBe('TFWorkspaceClaim/tfworkspace_variants');
    });

    it('renders a catalog entity for each variant', async () => {
      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { crsPath: rendererTestFixtures.noCrs, excludeGithubCrs: true },
      );

      const catalogResources = Object.values(renderedMap).filter(
        (cr: any) => cr.kind === 'Resource',
      );

      const resourceNames = catalogResources.map(
        (cr: any) => cr.metadata.name,
      );

      expect(resourceNames).toEqual(
        expect.arrayContaining([
          'tfworkspace-variants',
          'parent-workspace-dr-eu',
          'parent-workspace-dr-us',
        ]),
      );
    });

    it('inherits module and source from parent on variant CRs', async () => {
      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { crsPath: rendererTestFixtures.noCrs, excludeGithubCrs: true },
      );

      const catalogResources = Object.values(renderedMap).filter(
        (cr: any) => cr.kind === 'Resource',
      );

      const drEuResource = catalogResources.find(
        (cr: any) => cr.metadata.name === 'parent-workspace-dr-eu',
      ) as any;

      expect(drEuResource?.spec?.values?.source).toBe('Remote');
      expect(drEuResource?.spec?.values?.module).toBe(
        'https://github.com/infra/shared-module@main',
      );
    });

    it('sets terraform provider name as composed name', async () => {
      context = await context.resetRendererState();

      await context.applyPatches('tfworkspace_variants', [
        {
          op: 'replace',
          path: '/providers/terraform/variants',
          value: [
            {
              name: 'nop',
              overrides: {
                values: {
                  env: 'dr',
                  region: 'eu-west-2',
                },
              },
            },
          ],
        },
      ]);

      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { excludeGithubCrs: false },
      );

      const firestartrCrs = Object.values(renderedMap).filter(
        (cr: any) => cr.kind === 'FirestartrTerraformWorkspace',
      ) as any[];

      const variantCrs = firestartrCrs.filter(
        (cr: any) =>
          cr.metadata?.annotations?.['firestartr.dev/variant-of'],
      );

      expect(variantCrs.length).toBe(1);
      expect(variantCrs[0].metadata.name).toMatch(
        /^parent-workspace-nop-/,
      );
    });

    it('writes variant CRs with .variant.yaml suffix in the output directory', async () => {
      context = await context.resetRendererState();

      const { renderedMap } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { excludeGithubCrs: false },
      );

      const firestartrCrs = Object.values(renderedMap).filter(
        (cr: any) => cr.kind === 'FirestartrTerraformWorkspace',
      );

      const variantCrs = firestartrCrs.filter(
        (cr: any) =>
          (cr as any).metadata?.annotations?.['firestartr.dev/variant-of'],
      );

      const nonVariantCrs = firestartrCrs.filter(
        (cr: any) =>
          !(cr as any).metadata?.annotations?.['firestartr.dev/variant-of'],
      );

      const fs = require('fs');
      const resourcesDir = context.getResourcesOutDir();

      for (const variantCr of variantCrs) {
        const cr = variantCr as any;
        const variantFile = `FirestartrTerraformWorkspace.${cr.metadata.name}.variant.yaml`;
        expect(fs.existsSync(resourcesDir + '/' + variantFile)).toBe(true);
      }

      for (const nonVariantCr of nonVariantCrs) {
        const cr = nonVariantCr as any;
        const standardFile = `FirestartrTerraformWorkspace.${cr.metadata.name}.yaml`;
        expect(fs.existsSync(resourcesDir + '/' + standardFile)).toBe(true);
        const variantFile = `FirestartrTerraformWorkspace.${cr.metadata.name}.variant.yaml`;
        expect(fs.existsSync(resourcesDir + '/' + variantFile)).toBe(false);
      }
    });

    it('preserves variant CR identity on re-render (previous CR matching)', async () => {
      const { renderedMap: firstRender } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { crsPath: rendererTestFixtures.noCrs, excludeGithubCrs: false },
      );

      const variantCRs = Object.entries(firstRender)
        .filter(([, cr]: [string, any]) => cr.kind === 'FirestartrTerraformWorkspace'
          && cr.metadata?.annotations?.['firestartr.dev/variant-of'])
        .map(([, cr]) => cr) as any[];

      expect(variantCRs.length).toBe(2);

      const prevCRsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prev-variant-crs-'));
      for (const cr of variantCRs) {
        const filename = `${cr.kind}.${cr.metadata.name}.yaml`;
        const filePath = path.join(prevCRsDir, filename);

        // Write the CR with the exact annotations produced by the pipeline,
        // including the claim-ref that uses the parent claim name (via _parentClaimName).
        fs.writeFileSync(filePath, JSON.stringify(cr, null, 2));
      }

      const variantCRsFirstRender = new Map<string, { name: string; tfStateKey: string }>();
      for (const cr of variantCRs) {
        variantCRsFirstRender.set(cr.metadata.name, {
          name: cr.metadata.name,
          tfStateKey: cr.spec?.firestartr?.tfStateKey,
        });
      }

      context = await context.resetRendererState();

      const { renderedMap: secondRender } = await context.renderClaims(
        { claimRefs: ['TFWorkspaceClaim-tfworkspace_variants'] },
        { crsPath: prevCRsDir, excludeGithubCrs: false },
      );

      const variantCRsSecondRender = Object.entries(secondRender)
        .filter(([, cr]: [string, any]) => cr.kind === 'FirestartrTerraformWorkspace'
          && cr.metadata?.annotations?.['firestartr.dev/variant-of'])
        .map(([, cr]) => cr) as any[];

      expect(variantCRsSecondRender.length).toBe(2);

      for (const cr of variantCRsSecondRender) {
        const previous = variantCRsFirstRender.get(cr.metadata.name);
        expect(previous).toBeDefined();
        expect(cr.metadata.name).toBe(previous!.name);
        expect(cr.spec?.firestartr?.tfStateKey).toBe(previous!.tfStateKey);
      }

      fs.rmSync(prevCRsDir, { recursive: true, force: true });
    });
  });
});
