//
// Accepts:
//   resolveScalar: function that accepts 1 parameter (scalar) and resolves it
//
export function walk(value: any, resolveScalar: Function) {
  if (Array.isArray(value)) {
    return walkList(value, resolveScalar);
  } else if (typeof value === 'object' && value !== null) {
    return walkObject(value, resolveScalar);
  } else {
    return resolveScalar(value);
  }
}

function walkObject(obj: any, resolveScalar: Function) {
  const result: any = {};

  for (const key in obj) {
    const value = obj[key];

    result[walk(key, resolveScalar)] = walk(value, resolveScalar);
  }

  return result;
}

function walkList(list: any[], resolveScalar: Function): any {
  return list.map((value) => walk(value, resolveScalar));
}
