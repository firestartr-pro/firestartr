import YAML, { YAMLMap, YAMLSeq } from 'yaml';

import { deterministicPath } from '../../claims/deterministicPath.js';
import { getFeatureReferences } from '../../utils/features.js';
import { validateFeatureArgs } from '../../utils/featureSchema.js';
import { isRecord } from '../../utils/isRecord.js';
import { mergeObjects } from '../../utils/mutateClaim.js';
import { parseRepoSlug } from '../dotFirestartr.js';

import { extractFeatureMajor, preserveEol } from './shared.js';
import type { RenderedFile } from './types.js';
import type { AppInputs, AppTrack } from '../../schema/appInputs.js';

const BUILD_DISPATCH_FEATURE = 'build_and_dispatch_docker_images';
const RELEASE_PLEASE_FEATURE = 'release_please';

const TRACK_FILTER_ARGS: Record<AppTrack, string> = {
  snapshots: 'trigger_filter_by_env_snapshot',
  'pre-releases': 'trigger_filter_by_env_pre_releases',
  releases: 'trigger_filter_by_env_releases',
};

const ALL_TRACKS: readonly AppTrack[] = [
  'snapshots',
  'pre-releases',
  'releases',
];

export interface DefaultTrackFilters {
  snapshot: string;
  preReleases: string;
  releases: string;
}

export interface RenderServiceClaimOptions {
  org: string;
  inputs: AppInputs;
  existingContent: string;
  path?: string;
  authStrategy: string;
  featureMajors: {
    build_and_dispatch_docker_images: number;
    release_please: number;
  };
  featureSchemas: {
    build_and_dispatch_docker_images: Record<string, unknown>;
    release_please: Record<string, unknown>;
  };
  defaultFilters: DefaultTrackFilters;
}

function defaultFilterForTrack(
  defaults: DefaultTrackFilters,
  track: AppTrack,
): string {
  switch (track) {
    case 'snapshots':
      return defaults.snapshot;
    case 'pre-releases':
      return defaults.preReleases;
    case 'releases':
      return defaults.releases;
  }
}

function parseFilterItems(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isWildcard(items: string[]): boolean {
  return items.includes('*');
}

function filterCoversEnv(items: string[], env: string): boolean {
  return isWildcard(items) || items.includes(env);
}

interface FilterMergeResult {
  conflict?: string;
  overrides: Record<string, string>;
}

function computeFilterOverrides(
  inputs: AppInputs,
  existingArgs: Record<string, unknown>,
  defaultFilters: DefaultTrackFilters,
): FilterMergeResult {
  const currentRaw: Record<AppTrack, string> = {
    snapshots: defaultFilterForTrack(defaultFilters, 'snapshots'),
    'pre-releases': defaultFilterForTrack(defaultFilters, 'pre-releases'),
    releases: defaultFilterForTrack(defaultFilters, 'releases'),
  };
  const explicitlySet = new Set<AppTrack>();

  for (const track of ALL_TRACKS) {
    const argName = TRACK_FILTER_ARGS[track];
    const raw = existingArgs[argName];
    if (raw !== undefined) {
      if (typeof raw !== 'string') {
        return {
          conflict: `Expected "${argName}" in ${BUILD_DISPATCH_FEATURE}.args to be a string`,
          overrides: {},
        };
      }
      currentRaw[track] = raw;
      explicitlySet.add(track);
    }
  }

  const workingItems: Record<AppTrack, string[]> = {
    snapshots: parseFilterItems(currentRaw.snapshots),
    'pre-releases': parseFilterItems(currentRaw['pre-releases']),
    releases: parseFilterItems(currentRaw.releases),
  };

  for (const target of inputs.targets) {
    for (const otherTrack of ALL_TRACKS) {
      if (otherTrack === target.track) continue;
      const otherItems = workingItems[otherTrack];
      const otherArg = TRACK_FILTER_ARGS[otherTrack];
      if (isWildcard(otherItems)) {
        return {
          conflict: `Target env "${target.env}" for track "${target.track}" conflicts with ${otherArg}="${currentRaw[otherTrack]}" (contains '*')`,
          overrides: {},
        };
      }
      if (otherItems.includes(target.env)) {
        return {
          conflict: `Target env "${target.env}" for track "${target.track}" is already in ${otherArg} ("${currentRaw[otherTrack]}")`,
          overrides: {},
        };
      }
    }

    const ownItems = workingItems[target.track];
    if (!isWildcard(ownItems) && !ownItems.includes(target.env)) {
      ownItems.push(target.env);
    }
  }

  const overrides: Record<string, string> = {};
  for (const track of ALL_TRACKS) {
    const argName = TRACK_FILTER_ARGS[track];
    const originalItems = parseFilterItems(currentRaw[track]);
    if (isWildcard(originalItems)) continue;

    const nextValue = workingItems[track].join(',');
    const defaultValue = parseFilterItems(
      defaultFilterForTrack(defaultFilters, track),
    ).join(',');

    if (explicitlySet.has(track)) {
      if (nextValue !== originalItems.join(',')) {
        overrides[argName] = nextValue;
      }
    } else if (nextValue !== defaultValue) {
      overrides[argName] = nextValue;
    }
  }

  return { overrides };
}

function findFeatureMaps(featuresSeq: YAMLSeq, name: string): YAMLMap[] {
  const matches: YAMLMap[] = [];
  for (const item of featuresSeq.items) {
    if (item instanceof YAMLMap && item.get('name') === name) {
      matches.push(item);
    }
  }
  return matches;
}

export function renderServiceClaimFeatures(
  options: RenderServiceClaimOptions,
): RenderedFile {
  const {
    org,
    inputs,
    existingContent,
    authStrategy,
    featureMajors,
    featureSchemas,
    defaultFilters,
  } = options;
  const { name: serviceRepoName } = parseRepoSlug(inputs.service.repo, org);
  const path =
    options.path ?? deterministicPath('ComponentClaim', serviceRepoName);

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

  // Validate existing features structure using shared helper.
  try {
    getFeatureReferences(parsed);
  } catch (err) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Invalid features in ${path}: ${err instanceof Error ? err.message : String(err)}`,
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

  const added: string[] = [];
  const notes: string[] = [];

  // 1. build_and_dispatch_docker_images
  const buildMatches = findFeatureMaps(featuresSeq, BUILD_DISPATCH_FEATURE);
  if (buildMatches.length > 1) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Feature "${BUILD_DISPATCH_FEATURE}" is listed ${buildMatches.length} times in ${path}`,
      },
    };
  }
  const existingBuild = buildMatches[0];
  const targetBuildMajor = featureMajors.build_and_dispatch_docker_images;
  const targetBuildRef = `${BUILD_DISPATCH_FEATURE}-v${targetBuildMajor}`;

  if (!existingBuild) {
    const filterResult = computeFilterOverrides(inputs, {}, defaultFilters);
    if (filterResult.conflict) {
      return {
        path,
        outcome: { kind: 'conflict', reason: filterResult.conflict },
      };
    }
    const args: Record<string, unknown> = {
      auth_strategy: authStrategy,
      ...filterResult.overrides,
    };
    const validation = validateFeatureArgs(
      featureSchemas.build_and_dispatch_docker_images,
      args,
    );
    if (!validation.valid) {
      return {
        path,
        outcome: {
          kind: 'conflict',
          reason: `Invalid args for ${BUILD_DISPATCH_FEATURE}: ${validation.errors.join('; ')}`,
        },
      };
    }
    featuresSeq.add(
      doc.createNode({
        name: BUILD_DISPATCH_FEATURE,
        ref: targetBuildRef,
        args,
      }),
    );
    added.push(`feature:${BUILD_DISPATCH_FEATURE}`);
  } else {
    const buildObj = existingBuild.toJS(doc) as Record<string, unknown>;
    const existingMajor = extractFeatureMajor(buildObj, BUILD_DISPATCH_FEATURE);

    if (existingMajor === targetBuildMajor) {
      const rawArgsNode = existingBuild.get('args', true);
      if (existingBuild.has('args') && !(rawArgsNode instanceof YAMLMap)) {
        return {
          path,
          outcome: {
            kind: 'conflict',
            reason: `Expected "args" to be a YAML mapping for ${BUILD_DISPATCH_FEATURE} in ${path}`,
          },
        };
      }
      const existingArgs: Record<string, unknown> = isRecord(buildObj.args)
        ? buildObj.args
        : {};

      if (
        existingArgs.auth_strategy !== undefined &&
        existingArgs.auth_strategy !== authStrategy
      ) {
        return {
          path,
          outcome: {
            kind: 'conflict',
            reason: `${BUILD_DISPATCH_FEATURE} auth_strategy is "${String(existingArgs.auth_strategy)}", expected "${authStrategy}"`,
          },
        };
      }

      const filterResult = computeFilterOverrides(
        inputs,
        existingArgs,
        defaultFilters,
      );
      if (filterResult.conflict) {
        return {
          path,
          outcome: { kind: 'conflict', reason: filterResult.conflict },
        };
      }

      const overrideEntries = Object.entries(filterResult.overrides);
      if (overrideEntries.length > 0) {
        const mergedArgs = structuredClone(existingArgs);
        mergeObjects(mergedArgs, filterResult.overrides);
        const validation = validateFeatureArgs(
          featureSchemas.build_and_dispatch_docker_images,
          mergedArgs,
        );
        if (!validation.valid) {
          return {
            path,
            outcome: {
              kind: 'conflict',
              reason: `Merged args for ${BUILD_DISPATCH_FEATURE} failed schema validation: ${validation.errors.join('; ')}`,
            },
          };
        }

        let argsMap: YAMLMap;
        if (rawArgsNode instanceof YAMLMap) {
          argsMap = rawArgsNode;
        } else {
          argsMap = doc.createNode({});
          existingBuild.set('args', argsMap);
        }
        for (const [key, value] of overrideEntries) {
          argsMap.set(key, value);
          added.push(`arg:${BUILD_DISPATCH_FEATURE}.${key}`);
        }
      }
    } else {
      const existingVersionDesc =
        typeof buildObj.ref === 'string'
          ? buildObj.ref
          : typeof buildObj.version === 'string'
            ? buildObj.version
            : 'unknown version';
      notes.push(
        `Warning: ${BUILD_DISPATCH_FEATURE} is pinned to ${existingVersionDesc} (expected major v${targetBuildMajor}); left unchanged.`,
      );

      const existingArgs = isRecord(buildObj.args) ? buildObj.args : {};
      const missingByArg = new Map<string, string[]>();
      for (const target of inputs.targets) {
        const argName = TRACK_FILTER_ARGS[target.track];
        const rawValue = existingArgs[argName];
        const raw =
          typeof rawValue === 'string'
            ? rawValue
            : defaultFilterForTrack(defaultFilters, target.track);
        const items = parseFilterItems(raw);
        if (!filterCoversEnv(items, target.env)) {
          const list = missingByArg.get(argName) ?? [];
          if (!list.includes(target.env)) list.push(target.env);
          missingByArg.set(argName, list);
        }
      }
      if (missingByArg.size > 0) {
        const edits = [...missingByArg.entries()]
          .map(([argName, envs]) => `${argName} (add ${envs.join(', ')})`)
          .join('; ');
        notes.push(
          `Warning: target env(s) are outside current ${BUILD_DISPATCH_FEATURE} filters and will not receive auto-dispatches. Manual step: update ${edits} in ${path}.`,
        );
      }
    }
  }

  // 2. release_please
  const releaseMatches = findFeatureMaps(featuresSeq, RELEASE_PLEASE_FEATURE);
  if (releaseMatches.length > 1) {
    return {
      path,
      outcome: {
        kind: 'conflict',
        reason: `Feature "${RELEASE_PLEASE_FEATURE}" is listed ${releaseMatches.length} times in ${path}`,
      },
    };
  }
  const existingRelease = releaseMatches[0];
  const targetReleaseMajor = featureMajors.release_please;
  const targetReleaseRef = `${RELEASE_PLEASE_FEATURE}-v${targetReleaseMajor}`;

  if (!existingRelease) {
    const args: Record<string, unknown> = {
      release_type: inputs.service.release_type,
    };
    const validation = validateFeatureArgs(featureSchemas.release_please, args);
    if (!validation.valid) {
      return {
        path,
        outcome: {
          kind: 'conflict',
          reason: `Invalid args for ${RELEASE_PLEASE_FEATURE}: ${validation.errors.join('; ')}`,
        },
      };
    }
    featuresSeq.add(
      doc.createNode({
        name: RELEASE_PLEASE_FEATURE,
        ref: targetReleaseRef,
        args,
      }),
    );
    added.push(`feature:${RELEASE_PLEASE_FEATURE}`);
  } else {
    const releaseObj = existingRelease.toJS(doc) as Record<string, unknown>;
    const existingMajor = extractFeatureMajor(
      releaseObj,
      RELEASE_PLEASE_FEATURE,
    );
    if (existingMajor !== targetReleaseMajor) {
      const existingVersionDesc =
        typeof releaseObj.ref === 'string'
          ? releaseObj.ref
          : typeof releaseObj.version === 'string'
            ? releaseObj.version
            : 'unknown version';
      notes.push(
        `Warning: ${RELEASE_PLEASE_FEATURE} is pinned to ${existingVersionDesc} (expected major v${targetReleaseMajor}); left unchanged.`,
      );
    }
  }

  if (added.length === 0) {
    return {
      path,
      content: existingContent,
      outcome: { kind: 'noop' },
      ...(notes.length > 0 ? { notes } : {}),
    };
  }

  return {
    path,
    content: preserveEol(doc.toString(), existingContent),
    outcome: { kind: 'merge', added },
    ...(notes.length > 0 ? { notes } : {}),
  };
}
