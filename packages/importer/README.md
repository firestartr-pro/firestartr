# Firestartr Backstage Importer

This app is an importer for the Backstage application of Firestartr: this code will crawl the github page of an organization, reading all the repositories, creating its corresponding *catalog-info.yaml*, uploading the file to the github catalog repository and importing the terraform state of every repository to a remote S3 bucket.

## Requirements

### Infraestructrure and premissions

- **AWS S3 bucket:** Store the backstage's state.
- **DynamoDB table:** Manage terraform locks
- **Acces to the organization repositories:**
  - **Read** access to **all** the repositories.
  - **Write** access to the **Backstage's catalog** repository.

All AWS resources can be created with the [terraform_bootstrap](../../terraform_bootstrap/README.md) included in the repository.

### Environment vars

It needs the followings env variables in order to function (some of them non mandatory)

| Name                           | Type    | Description                                                                                    | Mandatory | Default value         |
| :----------------------------- | :------ | :--------------------------------------------------------------------------------------------- | :-------: | :-------------------- |
| **ORG**                        | string  | Name of the organization to be crawled                                                         | yes       | ---                   |
| **TOKEN**                      | string  | Token with the permissions to upload files to a repo and read repositories.                    | yes       | ---                   |
| **AWS_ACCESS_KEY_ID**          | string  | Specifies an AWS access key associated with an IAM user or role.                               | yes       | ---                   |
| **AWS_SECRET_ACCESS_KEY**      | string  | Specifies the secret key associated with the access key.                                       | yes       | ---                   |
| **AWS_DEFAULT_REGION**         | string  | Specifies the AWS Region to send the request to.                                               | yes       | ---                   |
| **S3_BUCKET**                  | string  | Name of the S3 Bucket where the state will be stored.                                          | yes       | ---                   |
| **S3_LOCK**                    | string  | Name of the DynamoDB table for the terraform locks.                                            | yes       | ---                   |
| **S3_REGION**                  | string  | Region of the S3 bucket.                                                                       | yes       | ---                   |
| **REPO_CATALOG**               | string  | Name of the repository where the Backstage Catalog is stored.                                  | yes       | ---                   |
| **PROVIDER_TYPE**              | String  | Can be `local` (no use S3, for development) or `aws` to use S3 and dynamodb.                   | yes       | ---                   |
| **TERRAFORM_WORK**             | String  | Terraform's work dir (example: /tmp).                                                          | yes       | ---                   |
| **TERRAFORM_BIN**              | String  | Path to the Terraform's binary                                                                 | yes       | ---                   |
| **TERRAFORM_DEBUG**            | Boolean | Set to 1 to keep temporal terraform files, 0 to delete them (default).                         | no        | 0                     |
| **DISABLE_IMPORT**             | Boolean | Set to 1 to skeep terraform init and import, 0 to execute them (default).                      | no        | 0                     |
| **CSV_FILE**                   | string  | Path to store de CSV file with the import results. Defaults to: imported.csv.                  | no        | /tmp                  |
| **SKIP_ARCHIVED_REPOS**        | string  | Set to 1 to exclude archived state repositories on the impor process.                          | no        | 0                     |
| **NOBODY_GROUP**               | string  | Name for the emptyy/nobody group, a group without members (will be created if not exists).     | no        | nobody                |
| **FULL_ORG_GROUP**             | string  | Name for the group which includes all the oranization members (will be created if not exists). | no        | \<org-name\>-team     |
| **DEFAULT_OWNER**              | string  | Group whjich will be set as owner of all the imported componets (nobody group if not defined). | no        | Will use nobody group |
| **FIRESTARTR_DEFAULT_SYSTEM** | string  | Default system where all the imported components (repos) will be added.                        | no        | \<org-name\>-system   |

## Usage

This application can be runned via npm (`npm run import-catalog`), or the installed binary (`irestarter-importer`) and the following parameters:

- Configuration options:
  - **`--catalog`** or **`-c`**: Set the path to the catalog. Example `-c /path/to/catalog`.
- Import options:
  - **`--all`** or **`-a`**: Imports the state of all the objects (users, groups and repos) from the organization.
  - **`--file`** or **`-f`**: Imports the object represented into de file. Example `-f /path/to/catalog/catalog/users/user-example.yaml`.
  - **`--type`** or **`-t`**: Import only the objects of the indicated type. Valid types:
    - `component` or `repo`: for repositories.
    - `group`: for groups.
    - `user`: for users.
  - **`--name`** or **`-n`**: Set the name of the resource to import, type must be set with `-t` or `--type`.
  - **`--force`**: Forces the import despite the yaml catalog file exists.
  - **`--failed`**: Crawls the full catalaog searching files with `ERROR` state and retries the import.

### Imported resources

| Resource name               | Terraform name           | Details                                                            |
| :-------------------------- | :----------------------- | :----------------------------------------------------------------- |
| Organization's user         | github_membership        | Represents the relation's between users and organization.          |
| Organization's team         | github_team              | Represents the diferent teams/groups in the organization.          |
| User pertenency to group    | github_team_membership   | Represents the membership of users in groups/teams.                |
| Organization's repository   | github_repository        | Represents a software/IaC,State... repository of the organization. |
| Default branch's protection | github_branch_protection | Represnets de protections which the default repository branch has. |

### Import order (when userd with `--all`)

In order to avoid problems when importing every resource of an organization, the importer allways uses the same order to ensure all dependencies are available:

1. Import users
2. Import users and teams memberships
3. Import reposities:
    1. Import the repository
    2. If present, import the default branch's protections

### Outputs

After the importer has finished its job, two CSV files are generated:

#### import.csv

Summary of all artefacts covered and their import status, with the following fields:

| Field   | Meaning                                   |
| :------ | :---------------------------------------- |
| Kind    | Resource type (user, group or component). |
| Name    | Name of the imported resource.            |
| Status  | Import status (result).                   |
| Details | If status is an error, the error data     |

**Example:**

```csv
Kind,Name,Status,Details
group,platform-team,PENDING_REVIEW,---
group,potato,PENDING_REVIEW,---
group,test-team,PENDING_REVIEW,---
group,test2-team,PENDING_REVIEW,---
user,user-a,PENDING_REVIEW,---
user,user-h,PENDING_REVIEW,---
user,user-b,PENDING_REVIEW,---
user,user-k,PENDING_REVIEW,---
user,prefapp-test,PENDING_REVIEW,---
user,user-l,PENDING_REVIEW,---
component,hello-typescript,PENDING_REVIEW,---
component,hello-python-3,PENDING_REVIEW,---
component,catalog,PENDING_REVIEW,---
component,catalog-test-26,PENDING_REVIEW,---
component,test-template,PENDING_REVIEW,---
```

#### repos.csv

Full list of imported components (repositories) which information must be completed, with the following fields:

| Field          | Meaning                                   | Observations                                                                                                              |
| :------------- | :---------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| Name           | Name of the repository.                   | ---                                                                                                                       |
| Owner          | Owner team (group).                       | ---                                                                                                                       |
| Platform Owner | Platform team (group).                    | ---                                                                                                                       |
| Maintainer(s)  | Maintainers teams (groups).               | When more than one team is maintainer, they should be enclosed in double quotation marks `"` and separated by commas `,`. |

**Example:**

```csv
Name,Owner,Platform Owner,Maintainer(s)
hello-typescript,,,
hello-python-3,,,
catalog,,,
catalog-test-26,,,
test-template,,,
```

### Example commands

| npm                                                    | binary                                            | Result                                                         |
| :----------------------------------------------------- | :------------------------------------------------ | :------------------------------------------------------------- |
| `npm run import-catalog -- --all`                      | `firestartr-importer --all`                      | Import all resources at the organization's github.             |
| `npm run import-catalog -- -f /path/to/file.yaml`      | `firestartr-importer -f /path/to/file.yaml`      | Import the resource which is represented by file.yaml.         |
| `npm run import-catalog -- -t repo`                    | `firestartr-importer -t repo`                    | Import all the repositories.                                   |
| `npm run import-catalog -- -t user -u example --force` | `firestartr-importer -t user -u example --force` | Import the user "example" (don't matters if yaml file exists). |
| `npm run import-catalog -- --failed`                   | `firestartr-importer --failed`                   | Retry all the failed imports.                                  |

## Development

Use the following command, once the repository has been downloaded:

- **`make init`:** installs everything
- **`make unit-test`:** run the tests suite
- **`make lint`:** run the linter
- **`make lint-fix`:** run automatic fix for linter errors. **:warning: Warning:** Test the application after running it (may break code).
- **`make build`:** to build the binary

### Debug

The importer's output is done using the [canonical debuger](https://www.npmjs.com/package/debug) with the following *"leaves"*:

| Leaves                                         | Meaning                                |
| :--------------------------------------------- | :------------------------------------- |
| **`firestartr-importer:cli`**                 | Program's command line information     |
| **`firestartr-importer:ocktokit`**            | Ocktokit call's (Girhub API)           |
| **`firestartr-importer:tf-group-generator`**  | Terraform generator for groups         |
| **`firestartr-importer:tf-repo-generator`**   | Terraform generator for users          |
| **`firestartr-importer:tf-user-generator`**   | Terraform generator for repositories   |
| **`firestartr-importer:tf-base-generator`**   | Base terraform generator (common)      |
| **`firestartr-importer:terraform-importer`**  | Terraform states import                |
| **`firestartr-importer:terraform-loop`**      | Loop for terraform imports             |
| **`firestartr-importer:terraform-runner`**    | Runner function for terraform commands |
| **`firestartr-importer:importer-base`**       | Base importer for github objects       |
| **`firestartr-importer:importer-groups`**     | Groups importert for github            |
| **`firestartr-importer:importer-repos`**      | Repos importert for github             |
| **`firestartr-importer:importer-users`**      | Users importert for github             |

The output is controlled with then env variable `DEBUG` and output leaves and regexs, separated by `,`:

Some examples:

| Value                                                                                 | Example                                                                                              | Output                                |
| :------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------- | :------------------------------------ |
| `*`                                                                                   | `export DEBUG="*"`                                                                                   | All outputs.                          |
| `firestartr-importer:*`                                                              | `export DEBUG="firestartr-importer:*"`                                                              | All firestartr-importer outputs.     |
| `firestartr-importer:cli`                                                            | `export DEBUG=firestartr-importer:cli`                                                              | Only cli output.                      |
| `firestartr-importer:tf-*`                                                           | `export DEBUG="firestartr-importer:tf-*"`                                                           | All `tf-` outputs.                    |
| `firestartr-importer:cli,firestartr-importer:terraform-*,firestartr-importer:tf-*` | `export DEBUG="firestartr-importer:cli,firestartr-importer:terraform-*,firestartr-importer:tf-*"` | All cli, terraform and `tf-` outputs. |
