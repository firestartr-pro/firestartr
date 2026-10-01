# Tool-agnostic agent configuration

Agent configuration lives in exactly two places: the root `AGENTS.md` and
`.agents/skills/`. There are no per-tool folders (`.claude/`, `.opencode/`,
`.github/copilot-instructions.md`, `opencode.json`) and no agent tool is named
in the repository. Commands used to be defined three times, once per tool, and
the copies drifted apart; a single tool-neutral source removes that drift, at
the cost of per-tool slash commands. Developers wire `.agents/skills/` and the
shared `prefapp/skills` workflow skills into their tools through their own
global configuration.

`AGENTS.md` and skills only state what an agent cannot infer from the code or
from `CONSTITUTION.md`. Deterministic work stays in scripts (for example
`packages/operator/tools/dev-operator.sh`); skills and `AGENTS.md` call those
scripts, never replace them.
