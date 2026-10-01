import Ajv from 'ajv/dist/2020';
import featureSchema from '../github/feature.schema';

let validate: ReturnType<Ajv['compile']> | undefined;
let ajv: Ajv | undefined;

function getValidate() {
  if (!validate) {
    ajv = new Ajv();
    ajv.addSchema(featureSchema.definitions.GithubComponentFeatureClaim);
    validate = ajv.compile({
      type: 'array',
      items: { $ref: 'firestartr.dev://github/GithubComponentFeatureClaim' },
    });
  }
  return validate;
}

// Validates the `providers.github.features` descriptor array against the same
// GithubComponentFeatureClaim schema used by claim-kind AJV validation. This
// runs BEFORE any feature preparer (auth/network) is invoked, so malformed or
// unauthorized `repo`/`ref`/`version` values are rejected without triggering
// GitHub downloads. Full AJV validation of the stitched claim is still applied
// after stitching.
export function validateFeatureDescriptors(claim: unknown): void {
  const typedClaim = claim as {
    providers?: { github?: { features?: unknown } };
  };
  const features = typedClaim.providers?.github?.features;
  if (!Array.isArray(features)) return;

  const v = getValidate();
  if (v(features)) return;

  const details = (v.errors ?? [])
    .map((e) => {
      const formatted = `${e.instancePath || '/'} ${e.message}`;
      return `  - ${formatted}`;
    })
    .join('\n');

  throw new Error(
    `Invalid feature descriptor(s):\n${details}\nFix the claim before stitching or rendering.`,
  );
}
