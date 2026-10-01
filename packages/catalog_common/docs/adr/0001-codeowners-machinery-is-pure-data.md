# CODEOWNERS machinery is pure data, I/O stays with consumers

The shared CODEOWNERS logic in `catalog_common/src/codeowners/` is pure data —
parse/format/validate/manipulate only, no GitHub or filesystem I/O, no classes.
It unifies logic previously duplicated across importer, gh_provisioner, and
cdk8s_renderer. We deliberately excluded `get`/`set` (those are I/O concerns
owned by consuming packages) and rejected an external npm dependency because the
GitHub CODEOWNERS format is simple enough to handle in-house. Reference
substitution reuses the existing SimpleTokenizer rather than a bespoke parser.
