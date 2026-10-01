/*
 * Interface that represents the return type of our
 * __patches() function. Created so when the function
 * is implemented, returning an incorrect object
 * is not possible
 *
 */

export interface ICustomResourcePatch {
  ctx?: Function;

  validate: Function;

  apply: Function;

  identify: Function;

  context?: any;

  applicable?: Function;

  isPostPatch?: boolean;
}

export function helperCTX(patch: ICustomResourcePatch) {
  if (patch.ctx) {
    return patch.ctx();
  } else {
    throw `Context has not been provided ${patch.identify()}`;
  }
}
