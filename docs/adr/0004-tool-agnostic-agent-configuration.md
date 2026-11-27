# Tool-agnostic agent configuration

Agent configuration has exactly two sources: the root `AGENTS.md` and
`.agents/skills/`. Commands used to be defined three times, once per tool, and
the copies drifted apart; a single tool-neutral source removes that drift.

A tool that only reads its own path gets a symlink to the single source, never
a copy: `AGENTS.md` and `CLAUDE.md` are one file through a symlink, and
`.claude/skills` links to `.agents/skills`. A symlink cannot drift, so every
skill added under `.agents/skills/` reaches every tool with no extra step.
Per-tool folders hold nothing but these symlinks; tool-specific commands,
agents or settings stay out of the repository. Developers wire the shared
`prefapp/skills` workflow skills into their tools through their own global
configuration.

`AGENTS.md` and skills only state what an agent cannot infer from the code or
from `CONSTITUTION.md`. Deterministic work stays in scripts (for example
`packages/operator/tools/dev-operator.sh`); skills and `AGENTS.md` call those
scripts, never replace them.
