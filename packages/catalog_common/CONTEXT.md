# catalog_common

Shared, dependency-free machinery reused across packages. This glossary covers
the CODEOWNERS terms; other areas are authored lazily via `/domain-modeling` as
the package is touched.

## Language

### CODEOWNERS

**Entry**:
One parsed line of a CODEOWNERS file: a Rule, a comment, or a blank.
_Avoid_: line, item

**Rule**:
An Entry mapping a Pattern to one or more Owners.
_Avoid_: mapping, assignment

**Owner**:
A GitHub identity that can own paths: `@username` or `@org/team-slug`.
_Avoid_: team, reviewer

**Pattern**:
The `.gitignore`-style glob a Rule matches paths against.
_Avoid_: path, glob

**Reference**:
A `{{ token }}` placeholder inside CODEOWNERS content, substituted via the
SimpleTokenizer.
_Avoid_: variable, placeholder
