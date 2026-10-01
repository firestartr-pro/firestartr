# watch-checks command and --wait-for-checks provision integration

The CLI currently polls the provision workflow run but has no visibility into the
downstream wet PR check runs that reflect actual reconciliation status. A provision
workflow can report "success" while the wet PR's plan or apply check runs have failed.

We add a standalone `watch-checks` command and an opt-in `--wait-for-checks` flag
on `create`/`edit --commit`. The command discovers the wet PR by matching
claim-ref annotations (branch name first, content fallback), polls all check runs
on the PR until completion, and reports per-CR status with output summaries.

State repos are discovered by convention (`<org>/state-github`, `<org>/state-infra`)
with a `--state-repos` override. The most recent open wet PR is selected when
multiple match. Timeout defaults to 30 minutes with 10s polling. Exit codes are
distinct: 0=pass, 1=fail, 2=timeout, 3=wet-PR-not-found.
