import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import common from 'catalog_common';
import { AllowedProviders } from 'render';
import { buildClaimRef } from '../claim-taxonomy';
import { buildCommonClaimPatches } from '../claim-patches';
import {
  findRenderedCrPaths,
  patchResourceSpecContext,
  readClaimResource,
} from '../cr-finder';
import {
  resolveE2eBaseClaimsPath,
  resolveE2eFixturesPath,
} from '../fixtures-path';
import { createNameBuilder, normalizeNamePrefix } from '../names';
import { renderClaims } from '../render';
import { disableRepositoryAdminEnforcementForFeatureRepos } from '../repository-admin-enforcement';
import { PROVIDER_CONFIGS } from '../test-constants';
import { createTestContext } from '../test-context';
import { deepMerge } from '../utils/deep-merge';
import { E2EState } from './state';

import type {
  ClaimsApi,
  ClaimsConfig,
  JsonPatchOperation,
  RenderLocallyOptions,
  RenderLocallyResult,
  TestContext,
} from '../types';

function resolveRenderProvider(claimKind: string): AllowedProviders {
  if (claimKind === 'TFWorkspaceClaim') {
    return AllowedProviders.terraform;
  }

  return AllowedProviders.github;
}

function normalizeFixtureName(name: string): string {
  return name.replace(/-/g, '_');
}

function buildClaimName(prefix: string, fixtureName: string): string {
  return createNameBuilder(prefix).build(fixtureName);
}

function resolveContextFiles(state: E2EState, fixtureName: string): string[] {
  if (!state.onlyFiles || state.onlyFiles.length === 0) {
    return [];
  }

  const normalizedOnlyFiles = (state.onlyFiles ?? []).map(normalizeFixtureName);
  const files = new Set([...normalizedOnlyFiles, fixtureName]);
  return Array.from(files);
}

async function ensureContext(
  state: E2EState,
  fixtureName: string,
): Promise<TestContext> {
  if (!state.context) {
    const baseClaimsPath = state.fixturesBasePath
      ? path.join(state.fixturesBasePath, 'base_claims')
      : resolveE2eBaseClaimsPath();
    const onlyFiles = resolveContextFiles(state, fixtureName);

    state.context =
      onlyFiles.length > 0
        ? await createTestContext({
            baseClaimsPath,
            onlyFiles,
          })
        : await createTestContext({
            baseClaimsPath,
          });
    return state.context;
  }

  try {
    await state.context.getFile(fixtureName);
  } catch {
    // The fixture is not yet in the temp dir. Add it without destroying the
    // existing context so that previously-rendered files (e.g. renamed and
    // patched claims that other fixtures reference) remain available to the
    // renderer's lazy-loader.
    await state.context.addFile(fixtureName);
  }

  return state.context;
}

async function applyMergeIfNeeded(
  context: TestContext,
  claimFile: string,
  merge?: Record<string, unknown>,
): Promise<void> {
  if (!merge) return;

  const content = await context.getFile(claimFile);
  const parsed = context.fromYaml(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Claim ${claimFile} is not a mergeable YAML object`);
  }

  const merged = deepMerge(parsed as Record<string, unknown>, merge);
  const claimFilePath = await context.getFilePath(claimFile);

  await fs.writeFile(claimFilePath, common.io.toYaml(merged), 'utf-8');
}

function resolveClaimsConfig(state: E2EState): Required<ClaimsConfig> {
  const fixturesBasePath = state.fixturesBasePath ?? resolveE2eFixturesPath();
  const initializers =
    state.claimsConfig.initializers ??
    path.join(fixturesBasePath, 'initializers');
  const globals =
    state.claimsConfig.globals ?? path.join(fixturesBasePath, 'globals');

  return {
    initializers,
    globals,
    defaults: state.claimsConfig.defaults ?? initializers,
  };
}

export function createClaimsApi(state: E2EState): ClaimsApi {
  return {
    setContext(context: TestContext): void {
      state.context = context;
      state.lastRenderedCrsPath = undefined;
    },

    getContext(): TestContext | null {
      return state.context;
    },

    setConfig(config: ClaimsConfig): void {
      state.claimsConfig = { ...config };
    },

    async restartContext(): Promise<void> {
      if (!state.context) {
        throw new Error('Cannot restart context before it is created');
      }

      state.context = await state.context.restart();
      state.lastRenderedCrsPath = undefined;
    },

    async destroyContext(): Promise<void> {
      if (state.context) {
        await state.context.destroy();
        state.context = null;
      }

      state.lastRenderedCrsPath = undefined;
      state.renderedArtifacts = [];
    },

    setPrefix(prefix: string): void {
      state.prefix = normalizeNamePrefix(prefix);
      state.lastRenderedCrsPath = undefined;
    },

    async patchContextFile(
      name: string,
      patches: JsonPatchOperation[],
    ): Promise<void> {
      const fixtureName = normalizeFixtureName(name);
      const context = await ensureContext(state, fixtureName);
      await context.applyPatches(fixtureName, patches);
    },

    async renderLocally(
      name: string,
      options: RenderLocallyOptions = {},
    ): Promise<RenderLocallyResult> {
      const sourceFixtureName = normalizeFixtureName(
        options.sourceFixtureName ?? name,
      );
      const context = await ensureContext(state, sourceFixtureName);
      const claimName = options.claimName ?? buildClaimName(state.prefix, name);

      // Keep the file basename aligned with the generated claim name so claim
      // references and rendered output annotations stay deterministic.
      await context.duplicateFile(sourceFixtureName, claimName);
      if (!options.sourceFixtureName && !options.claimName) {
        await context.removeFile(sourceFixtureName);
      }
      await applyMergeIfNeeded(context, claimName, options.merge);

      // Read the claim kind before patching so we can build kind-aware patches.
      const initialClaim = await readClaimResource(context, claimName);

      const allPatches = [
        ...buildCommonClaimPatches(claimName, state.org, initialClaim.kind),
        ...(options.patches ?? []),
      ];
      await context.applyPatches(claimName, allPatches);

      // Re-read after patches because tests may override /name and we must
      // resolve the rendered CR using the final claim reference.
      const patchedClaim = await readClaimResource(context, claimName);

      const outputPath = await fs.mkdtemp(
        path.join(os.tmpdir(), 'e2e-render-'),
      );
      try {
        const claimsPath = context.getClaimsDir();
        const claimPath = await context.getFilePath(claimName);
        const config = resolveClaimsConfig(state);

        // Render only the requested claim entry while keeping the full temp
        // claims directory available for the renderer's lazy-loaded refs.
        const { crsPath } = await renderClaims(outputPath, {
          initializers: config.initializers,
          globals: config.globals,
          claims: claimsPath,
          claimsDefaults: config.defaults,
          claimEntries: [claimPath],
          provider: resolveRenderProvider(patchedClaim.kind),
          previousCrsPath: state.lastRenderedCrsPath,
        });

        state.lastRenderedCrsPath = crsPath;

        const claimRef = buildClaimRef(patchedClaim.kind, patchedClaim.name);

        const crPaths = await findRenderedCrPaths(
          crsPath,
          patchedClaim.kind,
          claimRef,
        );

        if (crPaths.length < 1) {
          throw new Error(
            `No rendered CR paths found for ${patchedClaim.kind}/${patchedClaim.name}`,
          );
        }

        for (const renderedCrPath of crPaths) {
          if (patchedClaim.kind === 'TFWorkspaceClaim') {
            await patchResourceSpecContext(renderedCrPath, {
              backend: {
                ref: PROVIDER_CONFIGS.tfBackend,
              },
              providers: [
                {
                  ref: PROVIDER_CONFIGS.tfProvider,
                },
              ],
            });
          } else {
            await patchResourceSpecContext(renderedCrPath, {
              backend: {
                ref: PROVIDER_CONFIGS.backend,
              },
              provider: {
                ref: PROVIDER_CONFIGS.github,
              },
            });
          }
        }

        // Repository features use github-files-set to commit files after the
        // repository exists. Admin-enforced branch protection blocks those
        // direct commits, so keep this bypass scoped to render outputs that
        // include feature CRs instead of mutating every e2e repository apply.
        await disableRepositoryAdminEnforcementForFeatureRepos(crPaths);

        const result = { crPaths, outputPath };
        for (const renderedCrPath of crPaths) {
          state.renderedArtifacts.push({
            crPath: renderedCrPath,
            outputPath: result.outputPath,
          });
        }

        return result;
      } catch (error) {
        await fs.rm(outputPath, { recursive: true, force: true });
        throw error;
      }
    },
  };
}
