import YAML, { YAMLMap, YAMLSeq } from 'yaml';

import { deterministicPath } from '../../claims/deterministicPath.js';
import { serializeClaim } from '../../claims/keyOrdering.js';
import { createClaimValidator } from '../../utils/ajvValidation.js';
import { isRecord } from '../../utils/isRecord.js';

import { extractFeatureMajor, preserveEol } from './shared.js';
import type { RenderedFile } from './types.js';
import type { AppInputs } from '../../schema/appInputs.js';

const STATE_REPO_APPS_FEATURE = 'state_repo_apps';

export interface ServiceClaimDefaults {
  owner?: string;
  system?: string;
  githubOrg: string;
}

export interface RenderStateAppClaimOptions {
  inputs: AppInputs;
  serviceClaim: ServiceClaimDefaults;
  stateRepoAppsMajor: number;
  claimSchemasDir: string;
  existingContent?: string;
}

export async function renderStateAppClaim(
  options: RenderStateAppClaimOptions,
): Promise<RenderedFile> {
  const {
    inputs,
    serviceClaim,
    stateRepoAppsMajor,
    claimSchemasDir,
    existingContent,
  } = options;
  const appClaimName = `app-${inputs.app}`;
  const path = deterministicPath('ComponentClaim', appClaimName);
  const targetRef = `${STATE_REPO_APPS_FEATURE}-v${stateRepoAppsMajor}`;
  const validator = createClaimValidator({ schemasDir: claimSchemasDir });

  if (existingContent === undefined) {
    const owner = inputs.owner ?? serviceClaim.owner;
    const system = inputs.system ?? serviceClaim.system;
    const claim: Record<string, unknown> = {
      kind: 'ComponentClaim',
      version: '1.0',
      name: appClaimName,
      ...(system !== undefined ? { system } : {}),
      ...(owner !== undefined ? { owner } : {}),
      type: 'service',
      lifecycle: 'production',
      providers: {
        github: {
          name: appClaimName,
          org: serviceClaim.githubOrg,
          description: `State repository for ${inputs.app} application`,
          visibility: 'private',
          allowAutoMerge: true,
          deleteBranchOnMerge: true,
          allowUpdateBranch: true,
          actions: {
            oidc: {
              useDefault: true,
            },
          },
          branchStrategy: {
            name: 'none',
            defaultBranch: 'main',
          },
          additionalBranches: [
            {
              name: 'deployment',
              orphan: true,
            },
          ],
          features: [
            {
              name: STATE_REPO_APPS_FEATURE,
              ref: targetRef,
            },
          ],
        },
      },
    };

    const result = await validator.validate(claim, 'ComponentClaim');
    if (!result.valid) {
      return {
        path,
        outcome: {
          kind: 'conflict',
          reason: `Rendered ${path} failed ComponentClaim validation: ${result.errors.join('; ')}`,
        },
      };
    }

    return {
      path,
      content: serializeClaim(claim),
      outcome: { kind: 'create' },
    };
  }

  const doc = YAML.parseDocument(existingContent);
  if (doc.errors.length > 0) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Malformed YAML in ${path}: ${doc.errors[0].message}`,
      },
    };
  }

  const parsed: unknown = doc.toJS();
  if (!isRecord(parsed)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected YAML mapping in ${path}`,
      },
    };
  }

  let providersNode = doc.get('providers', true);
  if (doc.has('providers') && !(providersNode instanceof YAMLMap)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected "providers" to be a YAML mapping in ${path}`,
      },
    };
  }
  if (!(providersNode instanceof YAMLMap)) {
    providersNode = doc.createNode({});
    doc.set('providers', providersNode);
  }
  const providersMap = providersNode as YAMLMap;

  const rawGithub: unknown = providersMap.get('github', true);
  if (providersMap.has('github') && !(rawGithub instanceof YAMLMap)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected "providers.github" to be a YAML mapping in ${path}`,
      },
    };
  }
  let githubMap: YAMLMap;
  if (rawGithub instanceof YAMLMap) {
    githubMap = rawGithub;
  } else {
    githubMap = doc.createNode({});
    providersMap.set('github', githubMap);
  }

  const rawFeatures: unknown = githubMap.get('features', true);
  if (githubMap.has('features') && !(rawFeatures instanceof YAMLSeq)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Expected "providers.github.features" to be a YAML sequence in ${path}`,
      },
    };
  }
  let featuresSeq: YAMLSeq;
  if (rawFeatures instanceof YAMLSeq) {
    featuresSeq = rawFeatures;
  } else {
    featuresSeq = doc.createNode([]);
    githubMap.set('features', featuresSeq);
  }

  let existingFeature: YAMLMap | undefined;
  for (const item of featuresSeq.items) {
    if (
      item instanceof YAMLMap &&
      item.get('name') === STATE_REPO_APPS_FEATURE
    ) {
      existingFeature = item;
      break;
    }
  }

  if (existingFeature) {
    const existingObj = existingFeature.toJS(doc) as Record<string, unknown>;
    const existingMajor = extractFeatureMajor(
      existingObj,
      STATE_REPO_APPS_FEATURE,
    );
    if (existingMajor === stateRepoAppsMajor) {
      return {
        path,
        content: existingContent,
        outcome: { kind: 'noop' },
      };
    }

    const existingVersionDesc =
      typeof existingObj.ref === 'string'
        ? existingObj.ref
        : typeof existingObj.version === 'string'
          ? existingObj.version
          : 'unknown version';
    return {
      path,
      content: existingContent,
      outcome: { kind: 'noop' },
      notes: [
        `Warning: ${STATE_REPO_APPS_FEATURE} is pinned to ${existingVersionDesc} (expected major v${stateRepoAppsMajor}); left unchanged.`,
      ],
    };
  }

  featuresSeq.add(
    doc.createNode({
      name: STATE_REPO_APPS_FEATURE,
      ref: targetRef,
    }),
  );

  const mergedObj = doc.toJS();
  if (!isRecord(mergedObj)) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Merged ${path} is not a YAML mapping`,
      },
    };
  }
  // Labels are excluded from comparison; validate the merged claim as-is.
  const validation = await validator.validate(mergedObj, 'ComponentClaim');
  if (!validation.valid) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Merged ${path} failed ComponentClaim validation: ${validation.errors.join('; ')}`,
      },
    };
  }

  return {
    path,
    content: preserveEol(doc.toString(), existingContent),
    outcome: { kind: 'merge', added: [`feature:${STATE_REPO_APPS_FEATURE}`] },
  };
}
