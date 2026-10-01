# Terraform Workspace Synchronization

The sync configuration controls how and when Terraform workspaces are
synchronized within `TFWorkspaceClaim` definitions.

## Overview

The `providers.terraform.sync` block enables automatic reconciliation of a
workspace at a configured interval or schedule. The exact behavior of a sync run
depends on the sync `policy`; see [What actually runs](#what-actually-runs).

## Configuration

```yaml
kind: TFWorkspaceClaim
lifecycle: production
name: example-workspace
type: database
owner: 'group:firestartr-team'
system: 'system:firestartr-system'
version: '1.0'
providers:
  terraform:
    policy: full-control
    tfStateKey: a1850b50-677d-4a81-92a4-1318503b5568
    name: example-workspace
    source: Inline
    sync:
      enabled: true
      period: "5m"
      policy: "apply"
    module: |
      # Your Terraform module content
      output "example" {
        value = "Hello World"
      }
    values: {}
    context:
      providers:
        - name: provider-aws-workspaces
      backend:
        name: firestartr-terraform-state
```

## Sync Configuration Options

| Setting | Type | Description | Required | Format |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | Enable/disable synchronization. | Yes | `true` or `false` |
| `period` | string | Sync interval using duration format. | No | `^[0-9]+[smhd]$` (e.g., `5m`, `1h`, `30s`) |
| `schedule` | string | Cron schedule expression. | No | Cron format with optional seconds |
| `schedule_timezone` | string | Timezone for the cron schedule. | No | IANA timezone (e.g., `UTC`, `America/New_York`) |
| `policy` | string | Sync policy determining allowed operations. | No | Free string; recognized values are `observe`, `apply`, `create-only`, `full-control`, plus the aliases `observe-only` and `create-update-only` |

> **Cadence — optional.** You may set `period`, `schedule`, or
> **neither**. With `enabled: true` and no cadence, the controller silently uses
> a **1 minute** period. Set an explicit cadence unless a one-minute sync is
> intended. When both are set, they are mutually exclusive.

> **Timezone default — `Europe/Madrid`.** If `schedule_timezone` is
> omitted for a cron `schedule`, both the renderer and the operator default to
> `Europe/Madrid`, not UTC. Always set it explicitly when the schedule must be
> timezone-stable.

> **Sync policy validation — unknown values fail.** The schema does not
> enumerate `policy`. When a sync policy is set, the renderer
> runs a recognized-policy check against the general policy (which is always
> present, defaulting to `observe`); an unknown value fails that check with
> `Policy {syncPolicy} or {generalPolicy} not found`. Only
> **recognized-but-unsupported** values (`full-control`, `create-only`, and the
> aliases `create-update-only`/`observe-only`) are accepted and fall through to
> plan-only behavior at execution.

### Scheduling Options

Use either `period` or `schedule` (never both):

#### 1. Period-based Synchronization

```yaml
providers:
  terraform:
    sync:
      enabled: true
      period: "5m"  # Sync every 5 minutes
```

**Period format**: `^[0-9]+[smhd]$`
- `s` = seconds (e.g., `30s`)
- `m` = minutes (e.g., `5m`)
- `h` = hours (e.g., `2h`)
- `d` = days (e.g., `1d`)

#### 2. Schedule-based Synchronization

```yaml
providers:
  terraform:
    sync:
      enabled: true
      schedule: "*/5 * * * *"  # Every 5 minutes
      schedule_timezone: "UTC"
```

**Schedule format**: uses [cron-parser](https://www.npmjs.com/package/cron-parser)
with an optional seconds field.

- Standard 5-field format: `minute hour day month dayofweek`
- Optional 6-field format: `second minute hour day month dayofweek`

> **Note:** `schedule_timezone` is not schema-coupled to `schedule` — the claim
> schema accepts it on its own — but it is only emitted when a cron schedule is
> present: the renderer writes the `firestartr.dev/sync-schedule-timezone`
> annotation inside the `schedule` branch, and the operator reads it only
> alongside a cron schedule. Declaring it without `schedule` has no effect; set
> it together with `schedule` (otherwise the annotation defaults to
> `Europe/Madrid` when a schedule exists).

#### Cron Format Reference

```
*    *    *    *    *    *
┬    ┬    ┬    ┬    ┬    ┬
│    │    │    │    │    │
│    │    │    │    │    └─ day of week (0-7, 1L-7L) (0 or 7 is Sun)
│    │    │    │    └────── month (1-12, JAN-DEC)
│    │    │    └─────────── day of month (1-31, L)
│    │    └──────────────── hour (0-23)
│    └───────────────────── minute (0-59)
└────────────────────────── second (0-59, optional)
```

| Field | Values | Description |
| --- | --- | --- |
| Second (optional) | 0-59 | Second field (6-field format) |
| Minute | 0-59 | Minute field |
| Hour | 0-23 | Hour field |
| Day of Month | 1-31, L | Day of the month, or L for last day |
| Month | 1-12, JAN-DEC | Month field, numeric or abbreviated name |
| Day of Week | 0-7, SUN-SAT, 1L-7L | Day of week (0 or 7 is Sunday) |

**Special characters:**

| Character | Description | Example |
| --- | --- | --- |
| `*` | Any value | `* * * * *` (every minute) |
| `?` | Any value (alias for `*`) | `? * * * *` (every minute) |
| `,` | Value list separator | `1,2,3 * * * *` (1st, 2nd, and 3rd minute) |
| `-` | Range of values | `1-5 * * * *` (every minute from 1 through 5) |
| `/` | Step values | `*/5 * * * *` (every 5th minute) |
| `L` | Last day of month/week | `0 0 L * *` (midnight on last day of month) |
| `#` | Nth day of month | `0 0 * * 1#1` (first Monday of month) |

#### Common Cron Patterns

**Frequency-based:**
```bash
"*/5 * * * *"      # Every 5 minutes
"0 */4 * * *"      # Every 4 hours at the top of the hour
"0 0 */2 * *"      # Every 2 days at midnight
"0 0 0 * *"        # Daily at midnight
```

**Business hours:**
```bash
"0 9-17 * * 1-5"    # Every hour from 9 AM to 5 PM, weekdays only
"0 9,12,15 * * 1-5" # At 9 AM, noon, and 3 PM on weekdays
"0 8 * * 1-5"       # Every weekday at 8 AM
```

**Maintenance windows:**
```bash
"0 2 * * 0"        # Every Sunday at 2 AM
"0 3 1 * *"        # First day of every month at 3 AM
"0 1 15 * *"       # 15th of every month at 1 AM
"0 0 1 1,7 *"      # January 1st and July 1st at midnight
```

**Advanced patterns with seconds:**
```bash
"0 */5 * * * *"    # Every 5 minutes at the start of the minute
"30 */10 * * * *"  # Every 10 minutes at 30 seconds past
"0,30 * * * * *"   # Every 30 seconds
```

#### Quick Reference - Common Use Cases

| Use Case | Cron Expression | Description |
| --- | --- | --- |
| Every minute | `"* * * * *"` | High-frequency monitoring |
| Every 5 minutes | `"*/5 * * * *"` | Development environments |
| Every hour | `"0 * * * *"` | Regular monitoring |
| Business hours only | `"0 9-17 * * 1-5"` | Weekday office hours |
| Daily maintenance | `"0 2 * * *"` | Daily at 2 AM |
| Weekly maintenance | `"0 2 * * 0"` | Sunday at 2 AM |
| Monthly maintenance | `"0 2 1 * *"` | First of month at 2 AM |

## Usage Examples

### Basic Period-based Sync

```yaml
kind: TFWorkspaceClaim
name: basic-sync-example
providers:
  terraform:
    sync:
      enabled: true
      period: "10m"
    # ... other terraform configuration
```

### Advanced Schedule-based Sync

```yaml
kind: TFWorkspaceClaim
name: business-hours-sync
providers:
  terraform:
    sync:
      enabled: true
      schedule: "0 9-17 * * 1-5"  # Every hour on weekdays
      schedule_timezone: "America/New_York"
      policy: "observe"          # Plan/drift detection only
    # ... other terraform configuration
```

### Applying Drift Automatically

```yaml
kind: TFWorkspaceClaim
name: drift-reconciliation
providers:
  terraform:
    policy: apply            # general policy must be >= sync policy
    sync:
      enabled: true
      period: "15m"
      policy: "apply"        # only the exact value "apply" mutates on sync
    # ... other terraform configuration
```

## What actually runs

Sync events execute one of two code paths:

| `sync.policy` | Effective behavior |
| --- | --- |
| `apply` | Runs OpenTofu apply, then reads outputs. |
| `observe` | Runs a JSON plan; records `PROVISIONED`/`OUT_OF_SYNC` and plan details. |
| absent | Plan only. |
| anything else (including `full-control`, `create-only`, `create-update-only`, `observe-only`) | Plan only. |

> **Sync behavior — only `apply` mutates during sync.** Although the policy table lists
> `full-control` and `create-only` as policies, the sync executor switches on the
> literal value `apply` for mutation and the literal value `observe` for a plan;
> every other value falls through to plan-only. If you need scheduled changes,
> set `sync.policy: apply` (and ensure the general policy is at least as
> permissive). `full-control` and `create-only` as sync policies do not create,
> update, or delete anything.

> **Deletion behavior — `apply` does not prevent deletes.** A sync with `policy: apply`
> runs an unrestricted auto-approved apply. If the module drift removes a
> resource, the sync can delete it. See
> [Workspace Policies](./workspace-policies.md).

### Synchronization process

1. **Trigger**: A period interval or cron schedule fires a sync event.
2. **State check**: For plan-only policies the controller runs an OpenTofu plan
   against current state; an `apply` sync runs `tofu apply` directly.
3. **Execution**: `apply` applies; every other value records drift only.
4. **Status**: The `SYNCHRONIZED` condition records last and next sync times.

### Timezone Handling

When using `schedule`, specify a timezone with `schedule_timezone`. If it is
omitted, **`Europe/Madrid` is used**, not UTC.

## Best Practices

### Scheduling Recommendations

1. **Production environments**: Use longer intervals and explicit timezones.
2. **Development environments**: Shorter intervals for rapid iteration (e.g., `2m` to `5m`).
3. **Staging environments**: `10m`-scale intervals.

### Schedule vs Period Selection

- **Use `period`** for simple, regular intervals.
- **Use `schedule`** for complex timing (business hours, specific days).
- **Always set `schedule_timezone` explicitly** with a cron schedule.

### Configuration Guidelines

```yaml
# Production example - conservative drift detection
providers:
  terraform:
    sync:
      enabled: true
      schedule: "0 */2 * * *"  # Every 2 hours
      schedule_timezone: "UTC"
      policy: "observe"

# Development example - frequent sync
providers:
  terraform:
    sync:
      enabled: true
      period: "5m"
```

## Troubleshooting

**Sync not triggering**
- Verify `enabled` is `true`.
- Check that `period` and `schedule` are not both set.
- Validate the cron expression.
- Ensure a timezone is set if you rely on local time.

**Schedule format errors**
- Use [cron-parser](https://www.npmjs.com/package/cron-parser) compatible format.
- Remember the seconds field is optional.
- Test cron expressions before deploying.

**Common cron expression mistakes**
- **Invalid range**: `"0 9-5 * * *"` ❌ (hour range goes backwards) → `"0 9-17 * * *"` ✅
- **Wrong day format**: `"0 9 * * Monday"` ❌ → `"0 9 * * 1"` or `"0 9 * * MON"` ✅
- **Month confusion**: `"0 9 * 13 *"` ❌ (month 13 doesn't exist) → `"0 9 * 12 *"` ✅
- **Mixed formats**: `"30 0 9 * * 1-5"` ❌ → `"0 9 * * 1-5"` ✅ or `"0 30 9 * * 1-5"` ✅
- **Timezone issues**: Schedule in the wrong timezone → always specify `schedule_timezone`.

**Period format errors**
- Ensure the format matches `^[0-9]+[smhd]$`. Valid: `30s`, `5m`, `2h`, `1d`.

## Schema Validation

The sync configuration follows this JSON schema:

```json
{
  "type": "object",
  "properties": {
    "enabled": { "type": "boolean" },
    "period": { "type": "string", "pattern": "^[0-9]+[smhd]$" },
    "schedule": { "type": "string" },
    "schedule_timezone": { "type": "string" },
    "policy": { "type": "string" }
  },
  "additionalProperties": false,
  "required": ["enabled"],
  "oneOf": [
    { "required": ["period"] },
    { "required": ["schedule"] },
    {
      "not": {
        "anyOf": [
          { "required": ["period"] },
          { "required": ["schedule"] }
        ]
      }
    }
  ]
}
```

### Validation Rules

1. `enabled` is always required.
2. `period` and `schedule` are mutually exclusive.
3. The third `oneOf` branch explicitly allows **neither** cadence; the controller
   then defaults to a 1 minute period.
4. `period` must match `^[0-9]+[smhd]$`.
5. `schedule` uses cron-parser format with an optional seconds field.
6. `policy` is an unconstrained string in the schema, but when it is set an
   unknown value fails the recognized-policy check at render time (see the sync
   policy validation note above); only recognized values reach execution.
7. `schedule_timezone` is not coupled to `schedule` by the schema.

## Migration Guide

### Adding Sync to an Existing TFWorkspaceClaim

```yaml
# Before
providers:
  terraform:
    name: existing-workspace
    # ... other config

# After
providers:
  terraform:
    name: existing-workspace
    sync:
      enabled: true
      period: "10m"
    # ... other config
```

### Changing Sync Configuration

Update the sync section and redeploy the claim. Changes take effect on the next
sync cycle.
