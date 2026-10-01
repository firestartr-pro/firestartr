import * as fs from 'fs';
import * as path from 'path';
import common from 'catalog_common';
import _ from 'lodash';
import { extractAllRefs } from '../refsSorter/refsExtractor';
import { crawl } from '../crawler';
import { InitializerPatches } from '../initializers/base';
import { UUIDInitializer } from '../initializers/uuid';
import { InitializerClaimRef } from '../initializers/claimRef';
import { InitializerDefault } from '../defaults/initializer';
import { GlobalSection } from '../globals/base';
import { OverriderPatches } from '../overriders/base';
import { Normalizer } from '../normalizers/base';
import { NameNormalizer } from '../normalizers/name';
import { spawn } from 'node:child_process';
import { ClaimValidation } from '../claims';
import claims from '../claims/base';
import {
  initVirtualClaims,
  isVirtualClaim,
  getVirtualClaim,
} from '../claims/virtual';
import { loadClaimDefaults } from './loader';
import * as loader from './loader';
import { stitchClaim } from '../claims/stitching/stitching';

import log from '../logger';

// We need to ensure the grep command is a gnu version
let IS_GNU_GREP = false;
let GREP_ON_CHECK = false;

// this loop is for avoid race conditions
// once a check is running no more checks
async function waitForCheck() {
  const f_wait = () => new Promise((timeOut) => setTimeout(timeOut, 10));

  do {
    await f_wait();
  } while (GREP_ON_CHECK);
}

function checkGrep(): Promise<void> {
  return new Promise((ok, ko) => {
    // idempotency: already checked
    if (IS_GNU_GREP) return ok();

    // a check is already running no new checks
    if (GREP_ON_CHECK) return waitForCheck();

    log.info('Checking the grep command');

    GREP_ON_CHECK = true;

    const handler = spawn(
      'grep',

      ['--version'],
    );

    handler.on('close', (code) => {
      GREP_ON_CHECK = false;

      if (code === 0) {
        log.debug('Grep is a gnu grep');

        IS_GNU_GREP = true;

        ok();
      } else {
        ko('Lazy evaluation needs a gnu-grep command');
      }
    });
  });
}

export async function loadClaim(
  claimRef: string,
  org: string,
  defaults: any = loadClaimDefaults(),
  patchClaim: (claim: any, defaults: any) => any = loader.patchClaim,
  loadInitializers: (
    claim: any,
    claimPath?: string,
  ) => Promise<InitializerPatches[]>,
  loadGlobals: (claim: any) => Promise<GlobalSection[]>,
  loadOverrides: (claim: any) => OverriderPatches[],
  loadNormalizers: (claim: any, path: string) => Promise<Normalizer[]>,
  cwd?: string,
  existingRefs: any = {},
  postValidations: Map<string, Function[]> = new Map(),
) {
  await checkGrep();

  let result = existingRefs;

  log.info(`Load reference ${claimRef}`);

  initVirtualClaims(org);

  log.info(
    `Load reference (parts) ${claimRef.split(/-/)[0]} ${claimRef.replace(/^[^-]+-/, '')}`,
  );

  // cargas datos con grep
  try {
    const claimData = await lazyGetClaim(
      claimRef.split(/-/)[0],
      claimRef.replace(/^[^-]+-/, ''),
      org,
      cwd,
    );

    const rawClaim = common.io.fromYaml(claimData);

    let claim: any = patchClaim(rawClaim, defaults);

    // Claim stitching: feature claim-patches with gates before AJV
    try {
      claim = await stitchClaim(claim, undefined, rawClaim);
    } catch (e) {
      throw new Error(
        `Error when stitching claim ${claimRef}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    let variants: any[] = [];
    if (
      claim.kind === 'TFWorkspaceClaim' &&
      claim.providers?.terraform?.variants
    ) {
      variants = claim.providers.terraform.variants;
      delete claim.providers.terraform.variants;
    }

    log.silly(
      `Patched claim is:
		 ---
			${common.io.toYaml(claim)}`,
    );

    try {
      ClaimValidation.validateClaim(
        claim,
        (claims as any)[`${claim.kind}Schema`],
      );
      await ClaimValidation.optionalValidation(claim);
    } catch (error) {
      let errorMsg = '';

      if (Array.isArray(error)) {
        for (const data of error) {
          errorMsg = `${errorMsg}
  - ${data.instancePath}: ${data.message}`;
        }
      } else {
        errorMsg = error instanceof Error ? error.message : String(error);
      }

      throw new Error(`Error when validating claim ${claimRef}: ${errorMsg}`);
    }

    result[claimRef] = {};
    result[claimRef]['claim'] = claim;
    result[claimRef]['claimPath'] = VisitedClaims[claimRef];

    if (VisitedClaims[claimRef] === 'virtual') {
      result = await setVirtualClaimAdditionalData(result, claim, claimRef);
    } else {
      result = await setNonVirtualClaimAdditionalData(
        result,
        claim,
        claimRef,
        loadInitializers,
        loadGlobals,
        loadOverrides,
        loadNormalizers,
      );
    }

    const claimKind = claim.kind;
    const references = extractAllRefs(common.io.toYaml(claim));

    for (const ref of references) {
      if (!result[ref]) {
        const [resolvedReferences] = await loadClaim(
          ref,
          org,
          defaults,
          patchClaim,
          loadInitializers,
          loadGlobals,
          loadOverrides,
          loadNormalizers,
          cwd,
          result,
          postValidations,
        );
        result = _.merge(result, resolvedReferences);
      }
    }

    if (variants.length > 0) {
      const parentClaimPath = VisitedClaims[claimRef];

      for (const variant of variants) {
        if (!variant.name || !variant.overrides) {
          throw new Error(
            `Variant in claim ${claimRef} is missing required field 'name' or 'overrides'`,
          );
        }

        const prohibitedOverrideFields = ['source', 'module', 'name'];
        for (const field of prohibitedOverrideFields) {
          if (field in variant.overrides) {
            throw new Error(
              `Variant '${variant.name}' in claim ${claimRef} cannot override '${field}'`,
            );
          }
        }

        const composedName =
          claim.providers.terraform.name + '-' + variant.name;

        const variantClaim = _.cloneDeep(claim);
        variantClaim._parentClaimName = claim.name;
        variantClaim.name = composedName;

        variantClaim.providers.terraform = _.merge(
          {},
          claim.providers.terraform,
          variant.overrides,
        );

        variantClaim.providers.terraform.name = composedName;

        if (!variantClaim.annotations) {
          variantClaim.annotations = {};
        }
        variantClaim.annotations['firestartr.dev/variant-of'] =
          claim.providers.terraform.name;

        const variantRef = `TFWorkspaceClaim-${composedName}`;

        if (result[variantRef]) {
          throw new Error(
            `Variant name '${variant.name}' (composed: '${composedName}') from claim '${claimRef}' conflicts with existing claim '${variantRef}'`,
          );
        }

        log.info(`Creating synthetic variant claim ${variantRef}`);

        result[variantRef] = {};
        result[variantRef]['claim'] = variantClaim;
        result[variantRef]['claimPath'] = parentClaimPath;

        result = await setNonVirtualClaimAdditionalData(
          result,
          variantClaim,
          variantRef,
          loadInitializers,
          loadGlobals,
          loadOverrides,
          loadNormalizers,
        );

        const variantReferences = extractAllRefs(
          common.io.toYaml(variantClaim),
        );
        for (const ref of variantReferences) {
          if (!result[ref]) {
            const [resolvedReferences] = await loadClaim(
              ref,
              org,
              defaults,
              patchClaim,
              loadInitializers,
              loadGlobals,
              loadOverrides,
              loadNormalizers,
              cwd,
              result,
              postValidations,
            );
            result = _.merge(result, resolvedReferences);
          }
        }
      }
    }
  } catch (err) {
    throw `Lazy Loading: ${err}`;
  }

  return [result, postValidations];
}

let LoadedClaims = {};
let VisitedClaims = {};
let DuplicatedClaims = {};

export function resetLazyLoader() {
  LoadedClaims = {};
  VisitedClaims = {};
  DuplicatedClaims = {};
}

async function lazyGetClaim(
  kind: string,
  name: string,
  org: string,
  cwd?: string,
): Promise<any> {
  const indice = `${kind}-${name}`;

  log.info(`Lazy loading ${kind}-${name} with index ${indice}`);

  if (indice in LoadedClaims) return LoadedClaims[indice];

  if (isVirtualClaim(kind, name)) {
    await loadVirtualClaim(kind, name, org);
  } else {
    await getClaimsByName(name, cwd);
  }

  if (indice in LoadedClaims) {
    return LoadedClaims[indice];
  } else {
    throw new Error(`Error: ${kind}-${name} not found`);
  }
}

async function getClaimsByName(name: string, cwd = '.'): Promise<void> {
  return new Promise((ok, ko) => {
    const handler = spawn(
      'grep',

      ['-r', '-l', '--include=*', '-E', `name: "?${name}"?`, '.'],

      {
        cwd: cwd,
      },
    );

    log.info(
      `Running ${['grep', '-r', '-l', '--include', '-E', 'name: "' + name + '"?', '.'].join(' ')}`,
    );

    const entradas = [];

    const chunks = [];

    handler.stdout.on('data', (data) => {
      chunks.push(data.toString('utf-8'));
    });

    handler.on('close', () => {
      const dataFinal = chunks.join('');

      const fileNameList = dataFinal.split(/\n/).filter((line) => line !== '');

      for (const fileName of fileNameList) {
        // only yaml files
        if (!fileName.match(/\.yml$|\.yaml$/)) {
          continue;
        }

        // only entries not already visited
        if (Object.values(VisitedClaims).includes(fileName)) {
          continue;
        }

        entradas.push(path.join(cwd, fileName));
      }

      return Promise.all(
        entradas.map((entrada) => {
          return loadRawClaim(entrada);
        }),
      )
        .then(() => {
          ok();
        })
        .catch((err) => {
          ko(err);
        });
    });
  });
}

async function loadRawClaim(entry: string): Promise<void> {
  return new Promise((ok, ko) => {
    fs.readFile(entry, 'utf-8', (error, data) => {
      if (error) return ko(`Reading ${entry}: ${error}`);

      const claim: any = common.io.fromYaml(data);

      if (!('kind' in claim && 'name' in claim)) {
        log.warn(`Invalid claim file ${entry}`);
      } else {
        const claimKey = `${claim.kind}-${claim.name}`;

        if (
          Object.keys(DuplicatedClaims).includes(claimKey) &&
          DuplicatedClaims[claimKey] !== entry
        ) {
          return ko(
            `Duplicated claim ${claimKey} found files: ${DuplicatedClaims[claimKey]} and ${entry}`,
          );
        }

        LoadedClaims[claimKey] = data;
        VisitedClaims[claimKey] = entry;
        DuplicatedClaims[claimKey] = entry;

        ok();
      }
    });
  });
}

async function setVirtualClaimAdditionalData(
  renderedData: any,
  claim: any,
  claimRef: string,
) {
  const virtualClaim = getVirtualClaim(claim.kind, claim.name);

  renderedData[claimRef]['initializers'] = [
    new UUIDInitializer(claim),
    new InitializerClaimRef(),
    new InitializerDefault(virtualClaim.getDefaultConfig()),
  ];
  renderedData[claimRef]['globals'] = [];
  renderedData[claimRef]['overrides'] = [];
  renderedData[claimRef]['normalizers'] = [new NameNormalizer()];

  return renderedData;
}

async function setNonVirtualClaimAdditionalData(
  renderedData: any,
  claim: any,
  claimRef: string,
  loadInitializers: (
    claim: any,
    claimPath?: string,
  ) => Promise<InitializerPatches[]>,
  loadGlobals: (claim: any) => Promise<GlobalSection[]>,
  loadOverrides: (claim: any) => OverriderPatches[],
  loadNormalizers: (claim: any, path: string) => Promise<Normalizer[]>,
) {
  renderedData[claimRef]['initializers'] = await loadInitializers(
    claim,
    renderedData[claimRef]['claimPath'],
  );
  renderedData[claimRef]['globals'] = await loadGlobals(claim);
  renderedData[claimRef]['overrides'] = loadOverrides(claim);
  renderedData[claimRef]['normalizers'] = await loadNormalizers(
    claim,
    renderedData[claimRef]['claimPath'],
  );

  return renderedData;
}

async function loadVirtualClaim(kind: string, name: string, org: string) {
  const virtualClaim = getVirtualClaim(kind, name);
  const expandedClaim = await virtualClaim.expand({ org });

  log.info(`Loading virtual claim ${kind} ${name} ${org}`);

  LoadedClaims[`${kind}-${name}`] = common.io.toYaml(expandedClaim);
  VisitedClaims[`${kind}-${name}`] = 'virtual';
}
