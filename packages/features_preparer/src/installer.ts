import {
  renderFeature,
  getFeatureClaimPatches as getFeatureClaimPatchesFromRenderer,
} from './renderer';
import common from 'catalog_common';
import gh from 'github';
import tar from 'tar';
import * as fs from 'fs';
import AdmZip from 'adm-zip';
import { writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'stream/web';

import { downloadZipBall } from './zip';

import log from './logger';

export async function getFeatureConfigFromRef(
  featureName: string,
  featureRef: string,
  featureOwner: any, // -> cr
  featureArgs: any = {},
  repo = 'features',
  owner = 'prefapp',
) {
  // reference is the featureRef directly
  const reference = `${featureRef}`;

  return processFeature(
    featureName,
    reference,
    featureOwner,
    featureArgs,
    repo,
    owner,
  );
}

export async function getFeatureConfig(
  featureName: string,
  version: string,
  featureOwner: any, // -> cr
  featureArgs: any = {},
  repo = 'features',
  owner = 'prefapp',
) {
  const reference = `${featureName}-v${version}`;

  return processFeature(
    featureName,
    reference,
    featureOwner,
    featureArgs,
    repo,
    owner,
  );
}

async function processFeature(
  featureName: string,
  reference: string,
  featureOwner: any, // -> cr
  featureArgs: any = {},
  repo = 'features',
  owner = 'prefapp',
) {
  await downloadFeatureZip(repo, featureName, reference, owner);

  featureArgs = { ...(featureArgs ?? {}) };

  const commitInfo = await resolveFeatureCommit(owner, repo, reference);

  featureArgs['traceability'] = {
    version: reference,
    owner,
    repo,
    name: featureName,
    ref: reference,
    url: `https://github.com/${owner}/${repo}/tree/${reference}/packages/${featureName}`,
    sha: commitInfo.sha,
    tags: commitInfo.tags,
  };

  return renderFeature(
    featureName,
    reference,
    owner,
    repo,
    featureOwner,
    '/tmp',
    featureArgs,
  );
}

export async function getFeatureClaimPatches(
  featureName: string,
  version: string,
  featureOwner: any,
  featureArgs: any = {},
  repo = 'features',
  owner = 'prefapp',
) {
  const reference = `${featureName}-v${version}`;
  return processFeatureClaimPatches(
    featureName,
    reference,
    featureOwner,
    featureArgs,
    repo,
    owner,
  );
}

export async function getFeatureClaimPatchesFromRef(
  featureName: string,
  featureRef: string,
  featureOwner: any,
  featureArgs: any = {},
  repo = 'features',
  owner = 'prefapp',
) {
  const reference = `${featureRef}`;
  return processFeatureClaimPatches(
    featureName,
    reference,
    featureOwner,
    featureArgs,
    repo,
    owner,
  );
}

async function processFeatureClaimPatches(
  featureName: string,
  reference: string,
  featureOwner: any,
  featureArgs: any = {},
  repo = 'features',
  owner = 'prefapp',
) {
  await downloadFeatureZip(repo, featureName, reference, owner);

  featureArgs = { ...(featureArgs ?? {}) };

  featureArgs['traceability'] = {
    version: reference,
    owner,
    repo,
    name: featureName,
    ref: reference,
    url: `https://github.com/${owner}/${repo}/tree/${reference}/packages/${featureName}`,
  };
  return getFeatureClaimPatchesFromRenderer(
    featureName,
    reference,
    owner,
    repo,
    featureOwner,
    featureArgs,
  );
}

export async function resolveFeatureCommit(
  owner: string,
  repo: string,
  reference: string,
): Promise<{ sha: string; tags: string[] }> {
  try {
    const octokit = await gh.getOctokitForOrg(owner, true);

    // Get the resolved commit SHA
    const { data: commit } = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: reference,
    });
    const sha = commit.sha;

    // Get all tags pointing to this commit. Lightweight refs point straight at
    // the commit; annotated refs point at a tag object and need one extra
    // request each, deduplicated and bounded to CONCURRENCY_LIMIT at a time.
    const CONCURRENCY_LIMIT = 10;
    const tags: string[] = [];
    try {
      const refs = (await octokit.paginate(
        'GET /repos/{owner}/{repo}/git/matching-refs/{ref}',
        { owner, repo, ref: 'tags/', per_page: 100 },
      )) as Array<{ ref: string; object: { sha: string; type: string } }>;

      // Group refs by the object they point at, so every ref sharing a tag
      // object shares a single dereference below.
      const namesByObjectSha = new Map<string, string[]>();
      for (const ref of refs) {
        const tagName = ref.ref.replace(/^refs\/tags\//, '');
        if (ref.object.type === 'commit') {
          if (ref.object.sha === sha) {
            tags.push(tagName);
          }
          continue;
        }
        namesByObjectSha.set(ref.object.sha, [
          ...(namesByObjectSha.get(ref.object.sha) ?? []),
          tagName,
        ]);
      }

      const tagObjectShas = [...namesByObjectSha.keys()];
      for (let i = 0; i < tagObjectShas.length; i += CONCURRENCY_LIMIT) {
        const batch = tagObjectShas.slice(i, i + CONCURRENCY_LIMIT);
        const matches = await Promise.all(
          batch.map(async (tagSha) => {
            try {
              const { data: tagObj } = await octokit.request(
                'GET /repos/{owner}/{repo}/git/tags/{tag_sha}',
                { owner, repo, tag_sha: tagSha },
              );
              return tagObj.object.sha === sha
                ? (namesByObjectSha.get(tagSha) ?? [])
                : [];
            } catch (dereferenceError) {
              log.warn(
                `[features_preparer] Failed to dereference annotated tag object ${tagSha} in ${owner}/${repo}: ${
                  dereferenceError instanceof Error
                    ? dereferenceError.message
                    : String(dereferenceError)
                }`,
              );
              return [];
            }
          }),
        );
        tags.push(...matches.flat());
      }
    } catch (tagError) {
      log.warn(
        `[features_preparer] Failed to list tags for ${owner}/${repo}@${reference}: ${
          tagError instanceof Error ? tagError.message : String(tagError)
        }`,
      );
    }

    return { sha, tags };
  } catch (error) {
    log.warn(
      `[features_preparer] Failed to resolve commit for ${owner}/${repo}@${reference}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { sha: '', tags: [] };
  }
}

export async function prepareFeature(
  featureName: string,
  version: string,
  repo = 'features',
  owner = 'prefapp',
) {
  await downloadFeatureZip(repo, featureName, version, owner);
}

export async function downloadFeatureZip(
  repo: string,
  featureName: string,
  reference: string,
  owner = 'prefapp',
) {
  try {
    const zipballExtractPath = common.features.tarballs.getFeaturesExtractPath(
      featureName,
      reference,
      owner,
      repo,
      { createIfNotExists: false },
    );

    log.debug(`Zipball extract path: ${zipballExtractPath}`);
    if (fs.existsSync(zipballExtractPath)) {
      log.debug(
        `Zipball extract path ${zipballExtractPath} already exists, reusing it.`,
      );
      return zipballExtractPath;
    }

    log.info(
      `Feature ${[featureName, reference, owner, repo].join('-')} has not been downloaded yet, downloading`,
    );

    const octokit = await gh.getOctokitForOrg(owner);

    const response = await octokit.request(
      'GET /repos/{owner}/{repo}/zipball/{reference}',
      {
        request: {
          parseSuccessResponseBody: false,
        },
        owner,
        repo,
        reference,
      },
    );

    const randomZipTmpPath = `/tmp/${common.generic.randomString(20)}.zip`;
    log.info(
      `Downloading feature ${featureName} version ${reference} to ${randomZipTmpPath}`,
    );
    if (fs.existsSync(randomZipTmpPath)) {
      log.debug(
        `Temporary zip file ${randomZipTmpPath} already exists, removing it.`,
      );
      fs.unlinkSync(randomZipTmpPath);
    }

    const randomExtractPath = `/tmp/${common.generic.randomString(20)}`;
    log.debug(
      `Extracting feature ${featureName} version ${reference} to ${randomExtractPath}`,
    );

    fs.rmSync(randomExtractPath, { recursive: true, force: true });

    await downloadZipBall(response.url, randomZipTmpPath);

    const zip = new AdmZip(randomZipTmpPath);

    const mainEntry = zip.getEntries()[0].entryName;

    log.debug(`Main entry in zip: ${mainEntry}`);
    log.debug(`Extracting zip to ${randomExtractPath}`);
    zip.extractAllTo(randomExtractPath, true);

    log.debug(`Renaming main entry ${mainEntry} to ${zipballExtractPath}`);
    try {
      fs.renameSync(`${randomExtractPath}/${mainEntry}`, zipballExtractPath);
    } catch (err: any) {
      if (
        (err?.code === 'ENOTEMPTY' || err?.code === 'EEXIST') &&
        fs.existsSync(zipballExtractPath)
      ) {
        log.debug(
          `Concurrent download populated ${zipballExtractPath}, reusing.`,
        );
      } else {
        throw err;
      }
    }

    fs.rmSync(randomExtractPath, { recursive: true, force: true });
    log.debug(`Removing temporary zip file ${randomZipTmpPath}`);
    fs.unlinkSync(randomZipTmpPath);

    return zipballExtractPath;
  } catch (error) {
    log.error(`Error on prepare feature with tag ${reference}: ${error}`);
    throw new Error(
      `Error for feature with tag ${reference}: ${error}. GitHub response: ${error}`,
    );
  }
}
