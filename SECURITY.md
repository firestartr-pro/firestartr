# Security Policy

## Supported versions

Only the latest release receives security fixes. Upgrade to the latest release
before reporting an issue, and check that it is still reproducible there.

| Version              | Supported |
| -------------------- | --------- |
| Latest `3.x` release | Yes       |
| Older `3.x` releases | No        |
| `< 3.0`              | No        |

Fixes are published as a new patch or minor release. We do not backport them
to older releases.

## Reporting a vulnerability

**Do not report security vulnerabilities through public GitHub issues,
discussions or pull requests.**

Report them privately through GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/firestartr-pro/firestartr/security) of this repository.
2. Click **Report a vulnerability**.
3. Fill in the advisory form.

Include as much of the following as you can:

- Affected component (for example, operator, CLI, provisioner or renderer) and version.
- Type of issue and its impact.
- Steps to reproduce, or a proof of concept.
- Any required configuration or preconditions.

Please do not include real credentials, tokens or personal data in your
report. Use placeholders or test values instead.

## What to expect

After you submit a report, we will:

1. Acknowledge that we received it.
2. Confirm whether it is a vulnerability and assess its severity.
3. Keep you informed of the progress while we work on a fix.
4. Release the fix and publish a GitHub Security Advisory, requesting a CVE
   when applicable.

We will credit you in the advisory unless you prefer to remain anonymous.
Please keep the details private until the advisory is published.

## Trust boundary

Firestartr turns declarative inputs into actions executed with the operator's
identity and credentials. Keep the following in mind when you deploy it and
when you assess whether a behavior is a vulnerability:

- Authors of custom resources, claims and features can influence what the
  operator renders, provisions and executes, including the Terraform/OpenTofu
  runs it performs.
- Those runs execute with the permissions granted to the operator (for
  example, its GitHub App and cloud credentials).
- Grant write access to claim, feature and custom resource sources only to
  principals you would trust with those operator permissions.

## Scope

In scope:

- Inputs that escape the trust boundary above, for example reading or writing
  outside the intended paths, or obtaining the operator's credentials.
- Credentials or secrets exposed in logs, outputs or generated artifacts.
- Vulnerabilities in the published container images and packages built from
  this repository.

Out of scope:

- Vulnerabilities in third-party dependencies that do not affect Firestartr.
  Report them to the upstream project.
- Issues that need privileges beyond the trust boundary, such as cluster admin
  access or already-compromised operator credentials.
- Insecure configurations that the documentation already advises against.
- Denial of service through resource exhaustion, social engineering and
  physical attacks.

## Good-faith research

We will not pursue action against researchers who act in good faith and
follow this policy. That means: test only against your own installations,
do not access or modify data that is not yours, do not disrupt services, and
give us reasonable time to release a fix before any public disclosure.
