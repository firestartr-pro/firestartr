# importer

Imports existing GitHub resources into Firestartr by gathering their state and
producing claims/CRs. This glossary covers the decanter model; other areas are
authored lazily via `/domain-modeling` as the package is touched.

## Language

**Decanter**:
The importer subsystem that gathers GitHub data and transforms it into Firestartr
CRs/claims.
_Avoid_: importer, transformer

**Gather phase**:
The async `__gather*` methods that fetch external GitHub data onto the Decanter.
_Avoid_: fetch, collect

**Decant phase**:
The `__decant*` methods that turn gathered data into claim/CR patch operations.
_Avoid_: transform, map

**Empty repo**:
A GitHub repository with zero branches (no commits); it cannot be meaningfully
imported.
_Avoid_: new repo, blank repo

**Import guard**:
A validation gate that throws a hard error before producing a CR for an
un-importable repo.
_Avoid_: check, validation
