#!/usr/bin/env node
// Constitution exception: this bootstrap must stay CJS because tsx ESM mode
// loads fast-json-patch incorrectly in this package (missing ./src/core).
// Keep actual tool logic in render-claims.ts; remove this when tsx/package
// interop no longer needs CJS preloading.

// Register tsx as a CJS loader — this lets us require() .ts files
// and keeps CJS module semantics intact.
require('tsx/cjs');

// Preload fast-json-patch via CJS before tsx processes the .ts imports.
// Ensures `compare` is available on the namespace despite tsx CJS→ESM interop quirks.
require('fast-json-patch');

// Load the actual TypeScript tool
require('./render-claims.ts');
