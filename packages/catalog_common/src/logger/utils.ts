// https://siderite.dev/blog/jsonstringify-with-circular-references.html/#at2011170946
export function fixCircularReferences(o: any) {
  const weirdTypes = [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    BigInt64Array,
    BigUint64Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    SharedArrayBuffer,
    DataView,
  ];

  const defs = new Map<object, string>();

  return (k: string | symbol | number, v: any) => {
    if (k && v === o) {
      return `[${String(k)} is the same as original object]`;
    }

    if (v === undefined || v === null) {
      return v;
    }

    // Check for the Timeout constructor. This will also catch TimersList indirectly
    // since TimersList is part of the circular structure *of* a Timeout object.
    if (v && v.constructor && v.constructor.name === 'Timeout') {
      return '[Node.js internal timer object]';
    }

    // An alternative check could be `v instanceof Timeout` but the constructor name
    // check is more reliable for these internal types.

    const weirdType = weirdTypes.find((t) => v instanceof t);
    if (weirdType) {
      return weirdType.toString();
    }

    if (typeof v === 'function') {
      return v.toString();
    }

    if (v && typeof v === 'object') {
      const def = defs.get(v);
      if (def) {
        return `[${String(k)} is the same as ${def}]`;
      }
      defs.set(v, String(k));
    }
    return v;
  };
}
