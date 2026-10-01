# importer — Package Rules

**Don't modify this package unless explicitly asked.** The `Decanter` base,
`CollectionMixins`/`ICollection`, filters, config and the
`gather() → decant() → render() → postRender()` orchestration in
`src/decanter/index.ts` are frozen: new kinds work within them.

- All GitHub access goes through the `github` package. If a method is missing
  there, log a warning and stop; never call Octokit, `fetch` or `axios`
  directly. Add the method to `github` first.
- All import logic lives in decanters. Every kind has a pure decanter (one
  resource → one claim) paired with exactly one collection decanter (lists
  and filters resources, returns pure decanters). Every family directory has
  a `base.ts` abstract decanter.
- Gather, then decant, never mixed: API calls only in `__gather*` methods
  (results go to `this.data`), claim writes only in `__decant*` methods via
  `this.__patchClaim()`. Each `__decant*` writes one claim section with no
  computation or branching; complex logic belongs in gather or helpers.
- Each `__gather*` logs what it fetched and for which resource; each
  `__decant*` logs which claim section it wrote.
- Decanters never touch the file system directly (use `__patchClaim`,
  `__patchCr`, `common.io`).
- Tests build pure decanters with mock `data` instead of calling GitHub.
