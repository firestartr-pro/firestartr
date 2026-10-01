## Terraform Provider Policies & Operation Security

The `policy` setting in the `providers.terraform` block is the primary gate for
controller-initiated operations on a workspace. Each policy defines the set of
operations the controller may perform.

### Policy Hierarchy

Firestartr uses a hierarchical system to determine policy compatibility. Policies
range from read-only observation to full lifecycle management.

| Policy Name | Aliases | Allowed Operations |
| :--- | :--- | :--- |
| `full-control` | N/A | `UPDATED`, `CREATED`, `RENAMED`, `SYNC`, `MARKED_TO_DELETION`, `RETRY`, `NOTHING` |
| `apply` | `create-update-only` | `UPDATED`, `CREATED`, `RENAMED`, `SYNC`, `RETRY`, `NOTHING` |
| `observe` | `observe-only` | `SYNC` |
| `create-only` | N/A | `CREATED`, `RETRY`, `SYNC` |

An absent general policy defaults to `observe`.

### Detailed Operation Mapping for Terraform

Each policy enables a set of internal controller actions during a Terraform run:

* **`SYNC`**: Allowed by all policies. This enables the controller to fetch the
  current state and perform an OpenTofu plan to identify drift.
* **`CREATED`**: Permits the initial apply. Enabled in `full-control`, `apply`,
  and `create-only`.
* **`UPDATED` / `RENAMED`**: Allows modification of existing infrastructure
  through apply. Restricted in `observe` and `create-only`.
* **`MARKED_TO_DELETION`**: The most sensitive operation. Grants permission to
  perform a `destroy` or remove resources from state. **Only** permitted under
  `full-control`.
* **`RETRY`**: Allows the controller to automatically re-attempt a failed run.
  Available in `full-control`, `apply`, and `create-only`.
* **`NOTHING`**: Allows the controller to run and perform no operation. Only
  `full-control` and `apply` list it; `observe` and `create-only` do not.

> **Deletion behavior — `apply` does not stop deletes.** The `apply` policy blocks the
> controller's explicit `MARKED_TO_DELETION` operation, so Firestartr itself will
> not run a `destroy`. It does **not** inspect the OpenTofu plan for removals. An
> allowed create/update/sync runs `tofu apply -auto-approve` unrestricted, so a
> configuration change that removes a resource from the module can still delete
> infrastructure. Treat `apply` as "no explicit destroy", not "deletion-proof".

---

### General Policy vs. Sync Policy

For sync details see [Workspace Synchronization](./workspace-sync.md).

In a `TFWorkspaceClaim`, policies appear in two places:

1. **General Provider Policy (`providers.terraform.policy`)**:
   * **Definition**: The master gate. It defines the maximum level of authority
     the Firestartr controller has over this workspace.
   * **Scope**: Every operation, including manual triggers, initial provisioning,
     and automated tasks.

2. **Sync Policy (`providers.terraform.sync.policy`)**:
   * **Definition**: The execution permission for scheduled tasks.
   * **Scope**: Background synchronization events only.
   * **Effect**: During a sync, only the exact value `apply` mutates; the exact
     value `observe` (and any other compatible value) performs a plan only. See
     [Workspace Sync](./workspace-sync.md).

---

## Policy Compatibility Logic

When using scheduled synchronization, Firestartr validates that the
`sync.policy` is compatible with the general `providers.terraform.policy`.

### Validation Rule

Compatibility compares the numeric **weight** of each policy, not the exact set of
allowed operations. The general policy's weight must be greater than or equal to
the sync policy's weight.

| Policy | Weight |
| :--- | :--- |
| `full-control` | 10 |
| `apply` / `create-update-only` | 9 |
| `observe` / `observe-only` | 8 |
| `create-only` | 8 |

Because `observe` and `create-only` share weight 8, they are considered
mutually compatible — even though their allowed operation sets differ. The
compatibility check does not enforce strict permission-set containment.

#### Compatibility Scenarios:

* **Valid**: General `full-control` with sync `apply`.
* **Valid**: General `apply` with sync `observe`.
* **Valid**: General `observe` with sync `create-only` (same weight).
* **Invalid**: General `observe` with sync `apply`, which throws
  `incompatible policies 'observe' and 'apply' for TFWorkspaceClaim/<claim>`.

---

## Observe in Practice

The `observe` policy is described above as allowing only `SYNC`. In the
workspace processor, an absent, `observe`, or `observe-only` general policy is
special-cased **before** the operation gate: created, updated, renamed, retried,
and deletion-marked events are routed to a read-only plan (or `plan-destroy` for
deletion) rather than rejected. This never mutates infrastructure, but the
controller does more with `observe` than "sync only".

---

## Technical Summary of Aliases

To maintain flexibility and backward compatibility in `TFWorkspaceClaim`
definitions, the following aliases are resolved internally:

1. **`create-update-only`**: Maps to **`apply`**. Prevents explicit destroys;
   see the deletion behavior above for deletes inside apply.
2. **`observe-only`**: Maps to **`observe`**. Read-only monitoring.

> **Sync policy validation — values are free strings, but unknown values fail.** The
> claim schema accepts any string for `sync.policy`. When a sync policy is set,
> the renderer runs a recognized-policy check against the general policy (always
> present, defaulting to `observe`); an unknown value fails with
> `Policy {syncPolicy} or {generalPolicy} not found`. See
> [Workspace Sync](./workspace-sync.md).
