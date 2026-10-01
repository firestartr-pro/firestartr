import log from '../logger';

const REG_IS_CLAIM_SECRET_REF = new RegExp(/^secret-ref-\d+$/);

function resolveString(value: string, refs: any) {
  const regex = new RegExp(/(\$\{\{\s*references\.[\w\-.]+\s*\}\})/);

  if (hasRefs(value, regex) > 0) {
    let output = '';

    const needsInterpolation = hasRefs(value, regex) !== 1;

    for (const part of value
      .split(regex)
      .filter((part: string) => part !== '')) {
      if (regex.test(part)) {
        const resolvedValue = resolveRef(part, refs, needsInterpolation);

        if (needsInterpolation) {
          output += resolvedValue;
        } else {
          output = resolvedValue;
        }
      } else {
        output += part;
      }
    }

    return output;
  } else {
    return value;
  }
}

export function resolveScalar(value: any, refs: any) {
  if (typeof value === 'string') {
    return resolveString(value, refs);
  } else {
    return value;
  }
}

function hasRefs(value: string, regex: RegExp) {
  if (!regex.test(value)) {
    return 0;
  }

  return value
    .trim()
    .split(regex)
    .filter((part: string) => part !== '').length;
}

export function getRefNameFromKey(key: string): string {
  const refFormatRegex = /[\w\-.]+/;

  const re = new RegExp(
    `\\$\\{\\{\\s*references\\.(${refFormatRegex.source})\\s*\\}\\}`,
    'i',
  );

  const match = key.match(re);

  if (match === null) throw new Error('INVALID REFERENCE KEY FORMAT');

  // name is in the first matching group
  return match[1];
}

export function resolveClaimSecret(value: string, refs: any) {
  if (typeof value === 'string' && REG_IS_CLAIM_SECRET_REF.test(value)) {
    if (!Object.prototype.hasOwnProperty.call(refs, value)) {
      log.error(`SecretsClaim ref ${value} is not present on references`);
      throw new Error(`SecretsClaim ref ${value} is not present on references`);
    }
    return refs[value];
  } else {
    return value;
  }
}

export function resolveRef(
  key: string,
  references: any,
  wantsInterpolation = false,
): any {
  const refName = getRefNameFromKey(key);

  // check if key exists
  if (!Object.prototype.hasOwnProperty.call(references, refName)) {
    throw new Error('KEY NOT FOUND');
  }

  const value = references[refName];

  if (typeof value !== 'string' && wantsInterpolation) {
    throw new Error('VALUE NOT INTERPOLABLE');
  }

  return value;
}
