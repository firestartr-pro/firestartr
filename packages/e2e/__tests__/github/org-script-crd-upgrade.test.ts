import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as k8s from '@kubernetes/client-node';
import common from 'catalog_common';

import {
  applyAndWaitCrPaths,
  CleanupRunner,
  cleanupRenderedArtifacts,
  createNameBuilder,
  destroyFixtureResources,
  initE2e,
  orgScript,
  renderApplyAndWaitFixtures,
  type E2EApi,
  type FixturePatchesByClaimName,
  type OrgScriptOptions,
} from '../..';
import { getE2EState } from '../../src/api/internal-state';
import {
  buildClaimRef,
  FIRESTARTR_API_VERSION,
  getRelatedCrKindsForClaimKind,
} from '../../src/claim-taxonomy';
import { resolveFixtureMetadata } from '../../src/cleanup/fixture-metadata';
import { resolveFixtureResources } from '../../src/cleanup/fixture-plan';
import { parseApiVersion, resolveCustomResourceInfo } from '../../src/k8s/crd';
import { LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS } from '../../src/test-constants';

import type { K8sResource } from '../../src/k8s/types';

const CRD_UPGRADE_TEST_TIMEOUT_MS = LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS + 300000;

const ORG_SCRIPT_OPTIONS: OrgScriptOptions = {
  exclude: {
    systems: true,
    domains: true,
  },
};

const CRD_UPGRADE_PHASES = [
  // Apply released baseline CRDs before Dagger boots the released baseline
  // operator.
  'baseline-crds',
  // Create baseline-compatible CRs while Dagger's already-booted released
  // baseline operator is active.
  'baseline-create',
  // Apply in-branch CRDs before Dagger upgrades the operator/chart to the target.
  'target-crds',
  // Bump CR revisions, re-apply/re-wait with the target operator, then clean up.
  'target-validate',
] as const;

type CrdUpgradePhase = (typeof CRD_UPGRADE_PHASES)[number];

type LiveFixtureResource = K8sResource & {
  metadata?: K8sResource['metadata'] & {
    finalizers?: string[];
    labels?: Record<string, string>;
  };
};

type ReapplyManifest = Pick<K8sResource, 'apiVersion' | 'kind' | 'spec'> & {
  metadata: {
    name: string;
    namespace: string;
    annotations: Record<string, string>;
    finalizers?: string[];
    labels?: Record<string, string>;
  };
};

const CLAIM_REF_ANNOTATION =
  common.generic.getFirestartrAnnotation('claim-ref');
const REVISION_ANNOTATION = 'firestartr.dev/revision';

function getCrdUpgradePhase(): CrdUpgradePhase {
  const rawPhase = process.env.E2E_CRD_UPGRADE_PHASE?.trim();

  if (!rawPhase) {
    throw new Error(
      `E2E_CRD_UPGRADE_PHASE is required for org-script-crd-upgrade. Expected one of: ${CRD_UPGRADE_PHASES.join(', ')}. Dagger sets this while running the CRD upgrade orchestration; for direct local runs, use npm run test-suites -- crd-upgrade with E2E_CRD_UPGRADE_PHASE=<phase>, or invoke npm run test-crd-upgrade with the same env var.`,
    );
  }

  if (CRD_UPGRADE_PHASES.includes(rawPhase as CrdUpgradePhase)) {
    return rawPhase as CrdUpgradePhase;
  }

  throw new Error(
    `Unsupported E2E_CRD_UPGRADE_PHASE '${rawPhase}'. Expected one of: ${CRD_UPGRADE_PHASES.join(', ')}.`,
  );
}

// Older released CRDs may not accept some newer GitHub fields. Strip those
// fields so we can create baseline objects first and then validate them again
// after upgrading back to the in-branch CRDs.
function buildBaselineClaimPatches(prefix: string): FixturePatchesByClaimName {
  const nameBuilder = createNameBuilder(prefix);
  const frontendClaimName = nameBuilder.build('frontend');
  const backendClaimName = nameBuilder.build('backend');

  return {
    [frontendClaimName]: [
      {
        op: 'remove',
        path: '/providers/github/features',
      },
      {
        op: 'remove',
        path: '/providers/github/overrides/spec/repo/topics',
      },
    ],
    [backendClaimName]: [
      {
        op: 'remove',
        path: '/providers/github/topics',
      },
      {
        op: 'remove',
        path: '/providers/github/overrides/spec/repo/topics',
      },
    ],
  };
}

// This suite rewrites cluster-wide CRDs, so it must run serially.
const describeRunInBandOnly = process.argv.includes('--runInBand')
  ? describe
  : describe.skip;

describeRunInBandOnly('[crd-upgrade] Org Script E2E', () => {
  let client: E2EApi;
  let script: ReturnType<typeof orgScript> | undefined;
  let baselineCrdVersion = '';
  let targetValidationOutputPath = '';

  const phase = getCrdUpgradePhase();

  async function renderApplyAndWaitBaselineFixtures(): Promise<string[]> {
    if (!script) {
      throw new Error('Missing org-script fixtures');
    }

    // Render and create claims that are valid against the older schema. Dagger
    // invokes this phase only after the matching baseline operator is running.
    const baselinePatches = buildBaselineClaimPatches(client.getPrefix());
    return renderApplyAndWaitFixtures(client, script.fixtures, baselinePatches);
  }

  function nextRevision(currentRevision: string | undefined): string {
    const parsedRevision = Number.parseInt(currentRevision ?? '', 10);

    if (!Number.isFinite(parsedRevision) || parsedRevision < 1) {
      return '1';
    }

    return String(parsedRevision + 1);
  }

  function getResourceName(resource: K8sResource): string {
    const name = resource.metadata?.name?.trim();

    if (!name) {
      throw new Error(
        `Live ${resource.kind} resource is missing metadata.name`,
      );
    }

    return name;
  }

  async function listLiveFixtureResources(
    kind: string,
    claimRef: string,
  ): Promise<LiveFixtureResource[]> {
    const state = getE2EState(client);
    const { group, version } = parseApiVersion(FIRESTARTR_API_VERSION);
    const { plural, namespaced } = await resolveCustomResourceInfo(
      state.kubeConfigProvider,
      group,
      kind,
    );

    if (!namespaced) {
      throw new Error(
        `Cluster-scoped custom resources are not supported: ${kind}`,
      );
    }

    const customApi = state
      .kubeConfigProvider()
      .makeApiClient(k8s.CustomObjectsApi);
    const response = (await customApi.listNamespacedCustomObject({
      group,
      version,
      namespace: client.k8s.getNamespace(),
      plural,
    })) as { items?: LiveFixtureResource[] };

    return (response?.items ?? [])
      .filter(
        (resource) =>
          resource.metadata?.annotations?.[CLAIM_REF_ANNOTATION] === claimRef,
      )
      .sort((left, right) =>
        getResourceName(left).localeCompare(getResourceName(right)),
      );
  }

  function buildRevisionBumpedLiveManifest(
    resource: LiveFixtureResource,
  ): ReapplyManifest {
    const name = getResourceName(resource);
    const namespace =
      resource.metadata?.namespace?.trim() || client.k8s.getNamespace();
    const annotations = {
      ...(resource.metadata?.annotations ?? {}),
      [REVISION_ANNOTATION]: nextRevision(
        resource.metadata?.annotations?.[REVISION_ANNOTATION],
      ),
    };
    const manifest: ReapplyManifest = {
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      metadata: {
        name,
        namespace,
        annotations,
      },
      spec: resource.spec,
    };

    if (resource.metadata?.finalizers) {
      manifest.metadata.finalizers = resource.metadata.finalizers;
    }

    if (resource.metadata?.labels) {
      manifest.metadata.labels = resource.metadata.labels;
    }

    return manifest;
  }

  async function writeLiveFixtureCrManifestsWithRevision(): Promise<string[]> {
    if (!script) {
      throw new Error('Missing org-script fixtures');
    }

    // Dagger may run this phase in a fresh Jest/container process. Read the
    // baseline-created live CRs instead of re-rendering, otherwise new UUIDs can
    // create duplicate GitHub teams/repositories rather than updating the same
    // resources created by the baseline operator.
    targetValidationOutputPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'e2e-crd-upgrade-live-'),
    );
    const resolvedFixtures = resolveFixtureResources(
      client.getPrefix(),
      script.fixtures,
    );
    const fixtureMetadata = await resolveFixtureMetadata(
      client,
      resolvedFixtures,
    );
    const manifestPaths: string[] = [];
    const seenResources = new Set<string>();

    for (const { claimKind, claimName } of fixtureMetadata) {
      const claimRef = buildClaimRef(claimKind, claimName);
      let fixtureResourceCount = 0;

      for (const kind of getRelatedCrKindsForClaimKind(claimKind)) {
        const resources = await listLiveFixtureResources(kind, claimRef);

        for (const resource of resources) {
          const name = getResourceName(resource);
          const resourceKey = `${resource.kind}/${name}`;

          if (seenResources.has(resourceKey)) {
            continue;
          }

          seenResources.add(resourceKey);
          fixtureResourceCount += 1;
          const manifest = buildRevisionBumpedLiveManifest(resource);
          const manifestPath = path.join(
            targetValidationOutputPath,
            `${resource.kind}.${name}.yaml`,
          );
          await fs.writeFile(manifestPath, common.io.toYaml(manifest), 'utf-8');
          manifestPaths.push(manifestPath);
        }
      }

      if (fixtureResourceCount === 0) {
        throw new Error(
          `No baseline-created live CRs found for ${claimRef}; target validation must re-apply the resources created in the baseline phase.`,
        );
      }
    }

    return manifestPaths;
  }

  async function cleanupStaleResources(): Promise<void> {
    if (!script) {
      throw new Error('Missing org-script fixtures');
    }

    const preCleanup = new CleanupRunner();

    await preCleanup.run('destroy stale fixture resources', () =>
      destroyFixtureResources(client, client.getPrefix(), script.fixtures, {
        logPrefix: 'org-script-crd-upgrade',
        includePrefixed: true,
        strict: true,
      }),
    );

    preCleanup.throwOnErrors('org-script-crd-upgrade pre-cleanup');
  }

  beforeAll(async () => {
    // Keep names deterministic so orgScript fixtures and cleanup can agree.
    client = await initE2e(undefined, undefined, {
      namePrefix: 'org-script-crd-upgrade',
    });

    // The released CRD version is explicit so the suite can verify one concrete
    // upgrade path at a time.
    baselineCrdVersion =
      process.env.E2E_CRD_UPGRADE_BASELINE_VERSION?.trim() ?? '';

    if (!baselineCrdVersion) {
      throw new Error(
        'E2E_CRD_UPGRADE_BASELINE_VERSION environment variable is required for CRD upgrade test.',
      );
    }

    const prefix = client.getPrefix();

    // Build the same fixture graph we will exercise before and after the CRD
    // upgrade.
    script = orgScript(prefix, ORG_SCRIPT_OPTIONS);

    if (phase === 'baseline-create') {
      await cleanupStaleResources();
    }
  }, CRD_UPGRADE_TEST_TIMEOUT_MS);

  afterAll(async () => {
    const postCleanup = new CleanupRunner();
    const fixtures = script?.fixtures ?? [];

    if (!client) {
      return;
    }

    if (phase === 'target-validate') {
      // Restore the current CRDs first so later suites do not inherit the
      // downgraded schema.
      await postCleanup.run('restore in-branch CRDs', () =>
        client.k8s.applyInBranchCrds(),
      );

      await postCleanup.run('destroy fixture resources', () =>
        destroyFixtureResources(client, client.getPrefix(), fixtures, {
          logPrefix: 'org-script-crd-upgrade-afterall',
          includePrefixed: true,
          strict: true,
        }),
      );

      await postCleanup.run('cleanup rendered artifacts', () =>
        cleanupRenderedArtifacts(client),
      );
    }

    if (targetValidationOutputPath) {
      await postCleanup.run('cleanup target validation manifests', () =>
        fs.rm(targetValidationOutputPath, { recursive: true, force: true }),
      );
    }

    postCleanup.throwOnErrors(`org-script-crd-upgrade ${phase}`);
  }, CRD_UPGRADE_TEST_TIMEOUT_MS);

  it(
    `runs CRD upgrade phase: ${phase}`,
    async () => {
      if (phase === 'baseline-crds') {
        await client.k8s.applyCrds(baselineCrdVersion);
        return;
      }

      if (phase === 'baseline-create') {
        await renderApplyAndWaitBaselineFixtures();
        return;
      }

      if (phase === 'target-crds') {
        await client.k8s.applyInBranchCrds();
        return;
      }

      if (phase === 'target-validate') {
        const liveCrPaths = await writeLiveFixtureCrManifestsWithRevision();
        await applyAndWaitCrPaths(client, liveCrPaths);
        return;
      }

      throw new Error(
        `Unhandled CRD upgrade phase '${phase}'. Expected one of: ${CRD_UPGRADE_PHASES.join(', ')}.`,
      );
    },
    CRD_UPGRADE_TEST_TIMEOUT_MS,
  );
});
