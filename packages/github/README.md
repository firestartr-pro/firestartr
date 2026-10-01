# @firestartr/firestartr-github

This package is a collection of tools to work with github.

## auth

Creates an autenticated Ocktokit instance, this is the base to all the other functions, which use the instance to work with github.

It can provide two types of instance:

- octokit: A default ocktokit instance.
- ocktokitPaginated: A paginated octokit instance.

## organization

Functions to obtain data of a github organization.

Can see examples at [./\_\_tests\_\_/organization.test.ts](./__tests__/organization.test.ts)

### getRepositoryList

Recovers all the repositories from an organization.

#### Usage

- Parameters:
  - org: A string with the organization's name
  - perPageEntries: (optional, default 100) Number of entries on each pagination page.
- Results: List of repository objects

```typescript
import github from 'github';

const repositories = github.org.getRepositoryList('organization-name');
console.dir(repositories);
```

### getTeamList

Recovers all the teams from an organization.

#### Usage

- Parameters:
  - org: A string with the organization's name
  - perPageEntries: (optional, default 100) Number of entries on each pagination page.
- Results: List of team objects

```typescript
import github from 'github';

const teams = github.org.getTeamList('organization-name');
console.dir(teams);
```

### getUserList

Recovers all the users from an organization.

#### Usage

- Parameters:
  - org: A string with the organization's name
  - perPageEntries: (optional, default 100) Number of entries on each pagination page.
- Results: List of user objects

```typescript
import github from 'github';

const users = github.org.getUserList('organization-name');
console.dir(users);
```

### validateMember

Validates if a user is member of the organization and, if member, returns membership data. Throws an error if not member.

#### Usage

- Parameters:
  - username: Name of the user
  - org: A string with the organization's name
- Results: Memership data.
- Throws: In case the user is not a member

```typescript
import github from 'github';

try {
  const membershipData = github.org.validateMember('example-user', 'organization-name');
  console.dir(membershipData)
} catch ( e: any ) {
    console.error('example-user is not a member of organization-name: ', e);
}
```

## repository

Functions to obtain data of a github repository

Can see examples at [./\_\_tests\_\_/repository.test.ts](./__tests__/repository.test.ts)

### listReleases

List releases on the repository

#### Usage

- Parameters:
  - repo: Name of the repo
  - owner: Owner of the repo
- Results: List of release objects

```typescript
import github from 'github';

const releases = await github.repo.listReleases('my-repo', 'organization-name');
console.dir(releases);
```

### downloadReleaseTarball

Downloads the `tar.gz` file of a concrete release.

#### Usage

- Parameters
  - repo: Name of the repo
  - releaseName: Name of the release
  - version: Version of the release
  - fileName: Destination file
  - owner: Owner of the repo
- Results: Path where file is extracted

```typescript
import github from 'github';

const path = await githug.repo.downloadReleaseTarball('my-repo', 'my-release', '1.2.0', '/tmp/my-release.tar.gz', 'organization-name');
console.log('File extracted in:', path);
```

### getContent

Get the contents of a file from a github repository

#### Usage

- Parameters
  - path: Path of the file
  - repo: Name of the repo
  - owner: Owner of the repo
- Results: File contents

```typescript
import github from 'github';
import * as fs from 'fs';

const contents = await githug.repo.getContent('README.md', 'my-repo', 'organization-name');
fs.writeFileSync('/tmp/README.md', contents):
```

### setContent

Writes contents to a file into a github repository

#### Usage

- Parameters
  - path: Path of the file
  - fileContent: Contents of the file
  - repo: Name of the repo
  - owner: Owner of the repo
  - branch: Name of the branch (default: main)
  - message: Commit message (default '', which will be transformed in `Update ${path}`)
- Results: ---

```typescript
import github from 'github';
import * as fs from 'fs';

const fileContents = fs.readFileSync('/file/to/upload', 'utf8');

await githug.repo.setContent('file', fileContents, 'my-repo', 'organization-name', 'main', 'Upload file');
```

### uploadFile

Uploads a file to a github repository. The function reads the file and calls `setContent`.

#### Usage

- Parameters
  - destinationPath: Path of the file
  - fileContent: Contents of the file
  - repo: Name of the repo
  - owner: Owner of the repo
  - branch: Name of the branch (default: main)
  - message: Commit message (default '', which will be transformed in `Update ${destinationPath}`)
- Results: ---

```typescript
import github from 'github';

await githug.repo.setContent('file', '/file/to/upload', 'my-repo', 'organization-name', 'main', 'Upload file');
```

### deleteFile

Deletes a file from a github repo

#### Usage

- Parameters
  - path: Path of the file
  - repo: Name of the repo
  - owner: Owner of the repo
  - branch: Name of the branch (default: main)
  - message: Commit message (default '', which will be transformed in `Delete ${path}`)
- Results: ---

```typescript
import github from 'github';

await githug.repo.setContent('file/to/delete' 'my-repo', 'organization-name', 'main', 'Remove unnecesary file');
```

### getRepoInfo

Get informations from a repository

#### Usage

- Parameters
  - owner: Owner of the repo
  - repo: Name of the repo
- Results: object with repo data.

```typescript
import github from 'github';

const data = await githug.repo.getRepoInfo('my-organization', 'example-repo');
console.dir(data);
```

### getBranchProtection

Get informations from the protection of a branch

#### Usage

- Parameters
  - owner: Owner of the repo
  - repo: Name of the repo
  - branch: (Optional, defaults to main) Name of the branch.
- Results: object with protection data.

```typescript
import github from 'github';

const protection = await githug.repo.getBranchProtection('my-organization', 'example-repo', main);
console.dir(protection);
```

### getTeams

Get teams from a repository

#### Usage

- Parameters
  - owner: Owner of the repo
  - repo: Name of the repo
- Results: array of team objects.

```typescript
import github from 'github';

const teams = await githug.repo.getTeams('my-organization', 'example-repo');
console.dir(teams);
```

## team

Funtions to obtain team's data

Can see examples at [./\_\_tests\_\_/team.test.ts](./__tests__/team.test.ts)

### getTeamMembers

Get all the members on a team

#### Usage

- Parameters
  - team: Team name
  - org: Organization name
- Results: List of member objects.

```typescript
import github from 'github';

const teams = await githug.team.getTeamMembers('example-team', 'example-org');
console.dir(teams);
```

### getTeamInfo

Get team data

#### Usage

- Parameters
  - team: Team name
  - org: Organization name
- Results: Team data object.

```typescript
import github from 'github';

const data = await githug.team.getTeamInfo('example-team', 'example-org');
console.dir(data);
```


### getTeamRoleUser

Get the role of a user on a team

#### Usage

- Parameters
  - org: Organization name
  - team: Team name
  - username: Name of the user
- Results: Membership data object.

```typescript
import github from 'github';

const membership = await githug.team.getTeamInfo('example-team', 'example-org', 'example-user');
console.dir(membership);
```

### create

Creates a new team at github.

#### Usage

- Parameters
  - org: Organization name
  - team: Team name
  - privacy: (optional, default `closed`) `secret` or `closed`
- Results: ---

```typescript
import github from 'github';

await githug.team.create('example-team', 'example-org');
```

### addOrUpdateMember

Adds or updates a member of a team.

#### Usage

- Parameters
  - org: Organization name
  - team: Team name
  - username: Name of the user to add or update
  - role: (optional, default `member`) `member` or `maintainer`
- Results: ---

```typescript
import github from 'github';

await githug.team.addOrUpdateMember('example-team', 'example-org', 'example-user');
```

### removeMember

Removes a user from a team.

#### Usage

- Parameters
  - org: Organization name
  - team: Team name
  - username: Name of the user to remove
- Results: ---

```typescript
import github from 'github';

await githug.team.removeMember('example-team', 'example-org', 'example-user');
```

## user

Funtions to obtain user's data

Can see examples at [./\_\_tests\_\_/user.test.ts](./__tests__/user.test.ts)

### removeMember

Gets data from the user

#### Usage

- Parameters
  - name: Name of the user
- Results: User data object

```typescript
import github from 'github';

const data = await githug.user.getUserInfo('example-user');
console.dir(data);
```
