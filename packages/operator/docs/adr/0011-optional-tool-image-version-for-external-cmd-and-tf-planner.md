# Optional tool image version for `external_cmd` and `tf_planner`

`external_cmd` and `tf_planner` are separate operator code paths, but they both
depend on a tool image that is usually expected to match the controller image
deployed in the cluster. That coupling is too rigid for rare validation cases,
especially when the team needs to verify a forthcoming tool upgrade such as a
Tofu version bump without rolling the controller deployment first.

## Decision

Introduce a single optional image-version input on the main operator command and
let both `external_cmd` and `tf_planner` consume it.

The default remains the controller-aligned image version. When the option is set,
the operator may use a different tool image version for those code paths during a
run, without requiring the controller itself to be redeployed.

## Consequences

- Tool-image selection becomes explicit instead of being hard-wired to the
  controller deployment.
- `external_cmd` and `tf_planner` can be exercised against a newer or older tool
  image in rare validation scenarios.
- The controller image and tool image can diverge temporarily, but only through
  an intentional run-time override.
- The default path stays unchanged for normal operation.
