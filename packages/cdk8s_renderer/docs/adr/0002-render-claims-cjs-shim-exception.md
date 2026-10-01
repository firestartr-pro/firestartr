# render-claims tool ships a CJS shim as a documented ESM exception

The `render-claims` tool entry point is `tools/render-claims.cjs`, a small CommonJS
shim, even though the repository mandates ES modules. This is a deliberate,
documented exception: direct `tsx` ESM execution fails to resolve the package's
`fast-json-patch` dependency, so the `.cjs` shim preloads `tsx/cjs` and
`fast-json-patch` before handing off to the TypeScript implementation
(`tools/render-claims.ts`). Do not "fix" this back to pure ESM without first
resolving the underlying `fast-json-patch` resolution failure.
