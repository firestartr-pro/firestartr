# Use per-section SHA-256 hashes as secret change detectors

Encrypted secrets have a fundamental tension with Terraform's desired-state
model: libsodium's `crypto_box_seal` produces a different ciphertext every
time, even when the plaintext is identical. This means Terraform *always* sees
a diff on `encrypted_value` / `value_encrypted`.

The earlier solution was to add `lifecycle { ignore_changes = [key_id,
value_encrypted] }` in the tfm module, with a matching (dead-code)
`ignoreChanges` in the gh-provisioner entity. This suppressed spurious diffs
but introduced **secret staleness**: a genuinely changed plaintext value was
never detected either, because Terraform ignored the only field that carried
the update.

The decision is to supplement (not replace) the `ignore_changes` approach with
a stable fingerprint:

1. **tfm module** (`fix/1282-*` branch, commit `38011d1`): adds three
   optional config maps — `actions_sha256`, `codespaces_sha256`,
   `dependabot_sha256` — each mapping a secret name to the SHA-256 hex digest
   of its plaintext value. For each secret, a `terraform_data` resource
   captures the hash as its `input`, and the secret resource's lifecycle uses
   `replace_triggered_by` pointing at that `terraform_data` resource.
   `ignore_changes` on `key_id` and `value_encrypted` / `encrypted_value` is
   **kept** so that spurious ciphertext diffs are still suppressed. The hash
   is the only change signal — when it matches, the plan is clean; when it
   differs, Terraform replaces the secret.

2. **gh-provisioner**: for each secret, compute `sha256(plaintext)` and emit it
   in the config under `<section>_sha256/<secretName>` (e.g.
   `config.actions_sha256.MY_SECRET`). The plaintext itself is never exposed —
   only its hash enters the Terraform state. The entity initializes all three
   section maps empty in its constructor and always emits them, so a section
   with no secrets produces an empty map rather than an absent key. The dead
   `lifecycle.ignoreChanges` object the entity previously passed to its secret
   patchers (never consumed) is removed.

The `sha256` maps are optional at the module level. When absent, the module
preserves the original behaviour (no automatic updates). When provided, the
hash becomes the authoritative change signal.

This eliminates both problems at once:
- Real secret value changes are detected and applied.
- No spurious updates when only the ciphertext differs.
- The plaintext is never stored in Terraform state.

Module interface (from `variables.tf`):

```
config = {
  repository  = "owner/repo"
  actions     = { SECRET_NAME = "<libsodium-encrypted-value>" }
  codespaces  = { SECRET_NAME = "<libsodium-encrypted-value>" }
  dependabot  = { SECRET_NAME = "<libsodium-encrypted-value>" }
  actions_sha256    = { SECRET_NAME = "<64-char-hex-sha256>" }     # optional
  codespaces_sha256 = { SECRET_NAME = "<64-char-hex-sha256>" }     # optional
  dependabot_sha256 = { SECRET_NAME = "<64-char-hex-sha256>" }     # optional
}
```

The tfm module fix is on branch
[`fix/1282-github-repo-secrets-section-secrets-are-not-being-updated`](https://github.com/prefapp/tfm/tree/fix/1282-github-repo-secrets-section-secrets-are-not-being-updated)
(commit `38011d1`). The gh-provisioner change adds the hash computation and
extends the config shape to include the `*_sha256` maps.
