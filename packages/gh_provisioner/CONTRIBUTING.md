# Contributing Guide – Adding a New Managed GitHub Resource

This guide walks you through adding support for a new dummy resource called "GitHub Welcome Message"

(just prints a welcome banner as Terraform output – purely for illustration).

## Step 1 – Create a dummy tfm module
Create a new directory in your tfm monorepo (or a separate repo):
```bash
tfm/modules/gh-welcome-message/
├── main.tf
├── variables.tf
└── outputs.tf
```

### variables.tf
```hcl
variable "config" {
  type = object({
    team_name    = string
    welcome_text = string
    font_size    = optional(number, 24)
  })
  description = "Configuration for the welcome message"
}

variable "enabled" {
  type    = bool
  default = true
}
```

### main.tf (dummy – no real GitHub interaction)
```hcl

locals {
  final_message = "Welcome to ${var.config.team_name} team!\n${var.config.welcome_text}"
}

resource "null_resource" "dummy" {
  count = var.enabled ? 1 : 0

  triggers = {
    message = local.final_message
  }

  provisioner "local-exec" {
    command = "echo '${local.final_message}'"
  }
}
```

### outputs.tf
```hcl
output "displayed_message" {
  value       = local.final_message
  description = "The message that would be shown"
}

output "font_size_used" {
  value = var.config.font_size
}
```

Commit & push this module to your tfm repository (or a submodule).
Assume the repo URL is:
```
https://github.com/your-org/tfm
```

and the module lives at ./modules/gh-welcome-message

## Step 2 – "Publish" the module

In real life this means:

Tag a release (e.g. v0.1.0) or use a branch
Or just use the main branch for development

For this guide we will reference it as:

```hcl
source  = "git::https://github.com/your-org/tfm.git//modules/gh-welcome-message?ref=main"
```

## Step 3 – Define a dummy CR / CRD

CRD example (very simplified)
```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: githubwelcomemessages.github.prefapp.dev
spec:
  group: github.prefapp.dev
  names:
    kind: GitHubWelcomeMessage
    listKind: GitHubWelcomeMessageList
    plural: githubwelcomemessages
    singular: githubwelcomemessage
  scope: Namespaced
  versions:
  - name: v1
    served: true
    storage: true
    schema:
      openAPIV3Schema:
        type: object
        properties:
          spec:
            type: object
            required: [teamName, welcomeText]
            properties:
              teamName:
                type: string
              welcomeText:
                type: string
              fontSize:
                type: integer
                default: 24
```
### Example CR instance
```yaml
apiVersion: github.prefapp.dev/v1
kind: GitHubWelcomeMessage
metadata:
  name: platform-onboarding
  namespace: github-resources
spec:
  teamName:    "Platform"
  welcomeText: "Let's build amazing things together!"
  fontSize:    32
```

## Step 4 – Create the Entity class
File: src/entities/githubwelcomemessage.ts

```ts
import { Entity } from '../base';

export class GitHubWelcomeMessageEntity extends Entity {

  constructor(cr: CR) {
    super(cr, {

        config: {

        }

    });
  }

  async loadResources(): Promise<void> {
    // In real cases: check if message already exists, etc.
    this.patchData({
      {
        op: 'add',
        path: `/config`,
        value: {
            team_name:    this.cr.spec.teamName,
            welcome_text: this.cr.spec.welcomeText,
            font_size:    this.cr.spec.fontSize ?? 24,
        },
      },

    })
  }

  // optional
  async postProvision(tfOp: string): Promise<void> {};

}
```

### Step 5 – Connect everything

#### A. Register the entity in the factory

File: src/entities/index.ts

```ts
// ... existing imports ...

import { GitHubWelcomeMessageEntity } from './githubwelcomemessage';

function getEntityClass(kind: string): EntityConstructor {
  switch (kind) {
   // ... existing ones ...
    case 'GitHubWelcomeMessage':
        return GitHubWelcomeMessageEntity as EntityConstructor;

    default:
      throw new Error(`kind ${kind} has no entity associated`);
  }
}

// ... rest of file ()
```

#### B. Map kind → Terraform module

File: src/terraform.ts

```ts
const MODULES = {
    // ... existing mappings ...
    GitHubWelcomeMessage: {
        module: 'git::https://github.com/your-org/tfm.git//modules/gh-welcome-message',
        ref: 'main'
    },

}

// ... rest of file ()

```





