# docs_publisher

## Overview

Publishes a repository's docs into a docs repository, the one central repository where the documentation of every repo that installs this feature is gathered. A release writes a new version folder, a push to the source branch refreshes the docs that follow that branch, and a pull request receives a comment that lists what it would publish or delete. The work is done by the Publisher action, so this feature installs a workflow that calls it, a starter entries file, and this README.

## Terms

- **Source repo**: the repo this feature is installed in. It holds the docs, the workflow and the entries file.
- **Docs repo**: the central repo that receives the docs. The source repo pushes to it, and nothing is installed there.
- **Entries file**: `.github/docs_publisher.yaml` in the source repo. It is a list of entries; each entry names a folder of the docs repo and the files to copy into it.
- **Publisher action**: [`prefapp/action-docs-publisher`](https://github.com/prefapp/action-docs-publisher). A GitHub Action that reads the entries file, clones and updates the docs repo, commits, pushes, and posts the plan comment. The workflow calls it once per run.
- **Plan comment**: the comment a pull request receives. It lists the docs the merge would add, replace or delete, and writes nothing to the docs repo.
- **Docs root folder**: the folder inside the docs repo that holds everything the publisher writes, for example `site/raw`.
- **Claim args**: the `args` of the `docs_publisher` feature in the Claim, rendered into the installed workflow.

## What it installs

| File | What it is |
| --- | --- |
| `.github/workflows/docs-publisher.yml` | The workflow. It checks out the source repo, creates a token for the docs repo and calls the Publisher action. The feature keeps it up to date. |
| `.github/DOCS_PUBLISHER_README.md` | This file. |
| `.github/docs_publisher.yaml` | The entries file, with an empty list. It is yours from then on: feature upgrades never touch it. While it is empty on a new install, the publisher does nothing. Emptying it after a publish prunes the Areas this repo published. |

## Install

1. **Add the feature** to the Claim of the source repo:

   ```yaml
   features:
     - name: docs_publisher
       ref: docs_publisher-v1
       args:
         docs_repository: my-org/docs
         docs_root_folder: site/raw
   ```

2. **Give the source repo access to the docs repo.** The workflow creates a token from a GitHub App. The App must be installed on the docs repo with `Contents: Read and write` and `Metadata: Read`. Put its id in the source repo variable `DOCS_APP_ID` and its private key in the source repo secret `DOCS_APP_PRIVATE_KEY`, or name other ones with `docs_app_id_variable` and `docs_app_key_secret`. A pull request plan runs with `Contents: Read` only, so its build commands cannot write to the docs repo.

3. **Fill in the entries file.** Add one entry per folder you publish into. The entry format is described in the [Publisher action README](https://github.com/prefapp/action-docs-publisher), under further reading below.

4. **Run it once by hand** from Actions, Docs publisher, Run workflow, so the docs repo holds the versions you have already released. Read the run summary.

The source repo also needs its organization to allow `prefapp/action-docs-publisher` in its Actions policy.

## Args

| Arg | Required | Default | What it is |
| --- | --- | --- | --- |
| `docs_repository` | yes | | The docs repo to publish to, as `org/repo`. |
| `docs_root_folder` | yes | | The docs root folder inside the docs repo, such as `site/raw`, or `.` for the top of the docs repo. |
| `docs_branch` | no | `main` | The branch of the docs repo to publish to. |
| `source_branch` | no | `main` | The branch of the source repo that pushes are published from, and that the entries file is read from. |
| `docs_app_id_variable` | no | `DOCS_APP_ID` | The name of the source repo variable that holds the App id. |
| `docs_app_key_secret` | no | `DOCS_APP_PRIVATE_KEY` | The name of the source repo secret that holds the App private key. |

The docs repo branch must already exist: the publisher does not create it.

## What the workflow does

| When | What runs |
| --- | --- |
| A release is published | The release entry that matches the tag writes its version folder, then the folder's shared files are rebuilt. |
| A push to `source_branch` | The entries whose files changed are refreshed. An unrelated push commits nothing. |
| You start it by hand | A reconcile: it makes the docs repo match the entries file and the tags. |
| A pull request to `source_branch` | A plan comment, with a read-only token. It writes nothing to the docs repo. |

Every run does the same four things: it checks out the source repo, creates the App token for the docs repo, calls the Publisher action once, and lets the action read the event and pick the mode. The workflow never reads the entries file and never touches the docs repo; the action does both.

Runs of one kind queue behind each other, and GitHub keeps up to 100 waiting. A new push to a pull request cancels the plan still running for it; no other run is cancelled. A pull request from a fork or from Dependabot gets no plan, because GitHub gives it no secrets, and the run summary says so.

## Further reading

- [Publisher action README](https://github.com/prefapp/action-docs-publisher): the entries file format, the modes, the metadata files, pruning and troubleshooting.
