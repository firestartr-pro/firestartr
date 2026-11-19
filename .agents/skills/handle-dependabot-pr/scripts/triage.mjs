#!/usr/bin/env node
// Triage one or all open Dependabot PRs: version jump, risk level, path,
// Socket gate. Writes labels and one summary comment unless --dry-run.
//
// Usage:
//   node triage.mjs <pr> [--dry-run]
//   node triage.mjs --all [--dry-run]

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = "<!-- handle-dependabot-pr:summary -->";
const MANAGED_LABEL = /^(jump|level|path|socket)\//;
const RANK = { dev: 0, runtime: 1, unclassified: 1.5, critical: 2 };

export function parseLevels(text) {
  const levels = { dev: [], runtime: [], critical: [] };
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const key = line.match(/^([a-z]+):\s*$/);
    if (key) {
      if (!(key[1] in levels)) throw new Error(`levels.yaml: unknown level "${key[1]}"`);
      current = key[1];
      continue;
    }
    const item = line.match(/^\s+-\s+"([^"]+)"\s*$/);
    if (!item || !current) throw new Error(`levels.yaml: cannot parse line: ${raw}`);
    levels[current].push(item[1]);
  }
  return levels;
}

export function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function classify(name, levels) {
  let best = null;
  for (const level of Object.keys(RANK)) {
    if (level === "unclassified") continue;
    if (levels[level].some((p) => globToRegExp(p).test(name))) {
      if (best === null || RANK[level] > RANK[best]) best = level;
    }
  }
  return best;
}

export function parseVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

// Semver jump, with the team rules: a minor bump in 0.x and any bump in 0.0.x
// count as major. Unparseable versions count as major, the safe default.
export function versionJump(from, to) {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b) return "major";
  if (a.major !== b.major) return "major";
  if (a.major === 0 && (a.minor !== b.minor || a.minor === 0)) return "major";
  if (a.minor !== b.minor) return "minor";
  return "patch";
}

export function pathFor(jump) {
  return jump === "major" ? "B" : "A";
}

export function parseBumpTitle(title) {
  const m = /bump (\S+) from (\S+) to (\S+)/i.exec(title ?? "");
  return m ? { name: m[1], from: m[2], to: m[3] } : null;
}

function packageName(lockKey) {
  const idx = lockKey.lastIndexOf("node_modules/");
  return idx === -1 ? null : lockKey.slice(idx + "node_modules/".length);
}

// Walks package-lock.json (lockfileVersion 2 or 3) to find the level of a
// package. Direct dependencies use levels.yaml. Anything else takes the
// highest level among the packages that pull it in.
export function levelOf(name, lock, levels) {
  const packages = lock.packages ?? {};
  const manifests = Object.entries(packages)
    .filter(([key]) => !key.includes("node_modules/"))
    .map(([, entry]) => entry);
  const direct = new Set(
    manifests.flatMap((m) => [
      ...Object.keys(m.dependencies ?? {}),
      ...Object.keys(m.devDependencies ?? {}),
      ...Object.keys(m.optionalDependencies ?? {}),
      ...Object.keys(m.peerDependencies ?? {}),
    ]),
  );

  const pullers = new Map();
  for (const [key, entry] of Object.entries(packages)) {
    if (key === "") continue;
    const parent = packageName(key);
    if (!parent) continue;
    for (const child of [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...Object.keys(entry.peerDependencies ?? {}),
    ]) {
      if (!pullers.has(child)) pullers.set(child, new Set());
      if (child !== parent) pullers.get(child).add(parent);
    }
  }

  const memo = new Map();
  const visiting = new Set();

  // null means "no classified path yet" (a cycle cut). Only the top-level call
  // turns that into unclassified, so a cycle can't outrank a real level.
  function resolve(pkg) {
    if (direct.has(pkg)) return classify(pkg, levels) ?? "unclassified";
    if (memo.has(pkg)) return memo.get(pkg);
    if (visiting.has(pkg)) return null;
    const parents = pullers.get(pkg);
    if (!parents || parents.size === 0) return "unclassified";
    visiting.add(pkg);
    let best = null;
    for (const parent of parents) {
      const level = resolve(parent);
      if (level === null) continue;
      if (best === null || RANK[level] > RANK[best]) best = level;
    }
    visiting.delete(pkg);
    if (best !== null) memo.set(pkg, best);
    return best;
  }

  return resolve(name) ?? "unclassified";
}

// Only summaries written by authorized collaborators are trusted. Anyone else
// can post the marker and a fake state, so their comments are ignored.
export function pickSummary(comments, trusted) {
  return comments.find((c) => c.body?.includes(MARKER) && trusted.has(c.user?.login)) ?? null;
}

// Socket gate. One command answers "is this release malware?": `socket package
// score` on the package and version from the PR title, with the operator's own
// token. No organization, no dashboard policy, no scan upload.
export function jsonPayload(stdout) {
  for (const payload of [stdout, stdout?.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1)]) {
    try {
      return JSON.parse(payload);
    } catch {}
  }
  return null;
}

// `supplyChainRisk` + `critical` is how Socket flags known malware. Every other
// alert — CVEs, install scripts, network access, licences, maintenance — is
// information: a bump is usually the fix, and stopping on it stalls the flow.
export function isBlocker(alert) {
  return alert?.category === "supplyChainRisk" && alert?.severity === "critical";
}

// The score puts the package's own alerts under `self` and the whole dependency
// tree under `transitively`. Both are kept, deduplicated, and returned: only
// `isBlocker` decides the verdict, the rest is context for the reader. Only an
// explicit success from a successful exit passes: a missing token, a CLI error,
// `ok: false` or a version that is not on the registry is unknown.
export function parseSocketScore({ exitCode, stdout }) {
  const payload = jsonPayload(stdout);
  if (exitCode !== 0 || payload?.ok !== true || !payload.data) return { verdict: "unknown", alerts: [] };
  const alerts = dedupeAlerts([
    ...(payload.data?.self?.alerts ?? []),
    ...(payload.data?.transitively?.alerts ?? []),
  ]);
  return { verdict: alerts.some(isBlocker) ? "block" : "ok", alerts };
}

// One finding shows up once per package and again in the tree. The comment
// lists it once, but two different packages stay separate.
export function dedupeAlerts(alerts) {
  const seen = new Set();
  return alerts.filter((alert) => {
    const key = [
      alert.name ?? alert.type ?? "?",
      alert.severity ?? "",
      alert.example ?? alert.package ?? "",
      alert.version ?? "",
    ].join(" ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeAlert(alert) {
  const severity = alert.severity ? ` · ${alert.severity}` : "";
  const where = alert.example ? ` · ${alert.example}` : "";
  return `${alert.name ?? alert.type ?? "alert"}${severity}${where}`;
}

export function squashSubject(name, from, to, level) {
  return `chore: bump ${name} from ${from} to ${to}`;
}

export function requiredChecks(level, path, jump) {
  // Path B: a 🟡 major is handled as 🔴. Copilot review is requested at every level.
  if (path === "B") {
    const effective = jump === "major" && level !== "dev" ? "critical" : level;
    return ["Copilot review", ...requiredChecks(effective, "A", jump).filter((c) => c !== "Copilot review")];
  }
  if (level === "dev") return ["CI"];
  if (level === "critical") return ["Copilot review", "CI", "e2e all suites except massive (github, terraform, k8s-rate-limits, crd-upgrade, retry-lifecycle, core)", "operator and CLI snapshots on pre"];
  return ["Copilot review", "CI", "e2e all suites except massive (github, terraform, k8s-rate-limits, crd-upgrade, retry-lifecycle, core)"];
}

export function buildTriage({ name, from, to, lock, levels, socketResult, replacement = null }) {
  const jump = versionJump(from, to);
  const path = replacement ? "B" : pathFor(jump);
  const level = levelOf(name, lock, levels);
  const socket = socketResult.verdict;
  return {
    name,
    from,
    to,
    jump,
    path,
    level,
    socket,
    labels: [`jump/${jump}`, `level/${level}`, `path/${path}`, `socket/${socket}`],
    checks: requiredChecks(level, path, jump),
    squash: squashSubject(name, from, to, level),
    socketAlerts: dedupeAlerts(socketResult.alerts),
  };
}

export function parseState(body) {
  const head = /^head: (\S+)$/m.exec(body ?? "")?.[1] ?? null;
  const step = /^step: (.*)$/m.exec(body ?? "")?.[1] ?? null;
  const runs = /^runs: (.*)$/m.exec(body ?? "")?.[1] ?? "";
  const replacement = /^replacement: #(\d+)$/m.exec(body ?? "")?.[1];
  return head && step ? { head, step, runs, replacement: replacement ? Number(replacement) : null } : null;
}

// Keep the recorded step and run IDs while the head being checked and the
// replacement PR are unchanged, so resuming never repeats work. The head is the
// replacement PR's when one is set, otherwise the Dependabot PR's. A Socket
// block or unknown result always stops the flow, and every old
// `stopped: socket*` step restarts at triaged so #182-style PRs recover.
export function nextState(t, previous, head, replacement = previous?.replacement ?? null) {
  if (t.socket === "block") return { head, step: "stopped: socket block", runs: "", replacement };
  if (t.socket === "unknown") return { head, step: "stopped: socket unknown", runs: "", replacement };
  const resumable =
    previous &&
    previous.head === head &&
    previous.replacement === replacement &&
    !previous.step.startsWith("stopped: socket");
  return resumable ? { ...previous, replacement } : { head, step: "triaged", runs: "", replacement };
}

export function renderComment(t, state) {
  const lines = [
    MARKER,
    "## Dependabot triage",
    "",
    `**${t.name}** ${t.from} → ${t.to}`,
    "",
    `- Jump: \`${t.jump}\` · Level: \`${t.level}\` · Path: \`${t.path}\` · Socket: \`${t.socket}\``,
    `- Checks still required: ${t.checks.join(", ")}`,
    `- Squash subject: \`${t.squash}\``,
  ];
  if (t.socket === "block") {
    lines.push(
      "",
      "**Stopped: Socket block.** Socket flags this release as a critical",
      "supply-chain risk. Do not merge.",
    );
    for (const alert of t.socketAlerts.filter(isBlocker).slice(0, 20)) lines.push(`- ${describeAlert(alert)}`);
  }
  if (t.socket === "ok" && t.socketAlerts.length > 0) {
    lines.push("", "**Informational findings.** Not blocking, listed for context.");
    for (const alert of t.socketAlerts.slice(0, 20)) lines.push(`- ${describeAlert(alert)}`);
  }
  if (t.socket === "unknown") {
    lines.push(
      "",
      "**Stopped: Socket unknown.** No score for this release: the CLI failed, there",
      `is no token, or \`${t.name}@${t.to}\` is not on the registry. Run`,
      `\`socket package score npm ${t.name}@${t.to} --json\` by hand, then retriage.`,
    );
  }
  lines.push("", `head: ${state.head}`);
  if (state.replacement) lines.push(`replacement: #${state.replacement}`);
  lines.push(`step: ${state.step}`);
  if (state.runs) lines.push(`runs: ${state.runs}`);
  return lines.join("\n");
}

async function gh(args) {
  const { stdout } = await execFileAsync("gh", args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

// Scores one package version, not a tree: the package and its target version
// come from the PR title, so there is no worktree and no full scan. Anything
// that prevents the call (missing CLI, no token, an unknown version) is
// unknown, so triage stops instead of passing silently.
async function socketScore(name, version) {
  try {
    const { stdout } = await execFileAsync(
      "socket",
      ["package", "score", "npm", `${name}@${version}`, "--json"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return parseSocketScore({ exitCode: 0, stdout });
  } catch (err) {
    // A missing token or an unknown version exits non-zero and still prints JSON.
    if (typeof err.stdout === "string" && err.stdout.trim()) {
      return parseSocketScore({ exitCode: err.code ?? 1, stdout: err.stdout });
    }
    return { verdict: "unknown", alerts: [] };
  }
}

async function repoSlug() {
  return (await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])).trim();
}

async function fileAt(slug, ref, path) {
  const out = await gh(["api", `repos/${slug}/contents/${path}?ref=${ref}`, "--jq", ".content"]);
  return Buffer.from(out.trim(), "base64").toString("utf8");
}

async function findSummary(slug, number) {
  const pages = JSON.parse(await gh(["api", `repos/${slug}/issues/${number}/comments`, "--paginate", "--slurp"]));
  const comments = pages.flat().filter((c) => c.body?.includes(MARKER));
  const authors = [...new Set(comments.map((c) => c.user?.login).filter(Boolean))];
  const trusted = new Set();
  for (const login of authors) {
    if (await isWriter(slug, login)) trusted.add(login);
  }
  return pickSummary(comments, trusted);
}

async function isWriter(slug, login) {
  try {
    const permission = (
      await gh(["api", `repos/${slug}/collaborators/${login}/permission`, "--jq", ".permission"])
    ).trim();
    return ["admin", "maintain", "write"].includes(permission);
  } catch {
    return false;
  }
}

async function triagePr(number, { dryRun, slug, levels, replacementOverride }) {
  const pr = JSON.parse(
    await gh(["pr", "view", String(number), "--json", "number,title,headRefName,headRefOid,state"]),
  );
  if (pr.state !== "OPEN") throw new Error(`#${number} is not open`);
  const bump = parseBumpTitle(pr.title);
  if (!bump) throw new Error(`#${number}: cannot read package and versions from title "${pr.title}"`);

  const lock = JSON.parse(await fileAt(slug, pr.headRefName, "package-lock.json"));

  const existing = await findSummary(slug, number);
  const previous = existing ? parseState(existing.body) : null;
  const replacement = replacementOverride ?? previous?.replacement ?? null;
  // Path B is judged on the replacement PR's tree, which is the one that lands.
  const source = replacement
    ? JSON.parse(await gh(["pr", "view", String(replacement), "--json", "headRefOid"]))
    : pr;
  const head = source.headRefOid;
  const socketResult = await socketScore(bump.name, bump.to);

  const t = buildTriage({ ...bump, lock, levels, socketResult, replacement });
  const state = nextState(t, previous, head, replacement);
  const body = renderComment(t, state);

  if (!dryRun) {
    const labelsJson = JSON.parse(
      await gh(["pr", "view", String(number), "--json", "labels", "-q", "{labels:[.labels[].name]}"]),
    );
    const remove = labelsJson.labels.filter((l) => MANAGED_LABEL.test(l) && !t.labels.includes(l));
    const args = ["pr", "edit", String(number), "--add-label", t.labels.join(",")];
    if (remove.length) args.push("--remove-label", remove.join(","));
    await gh(args);
    await upsertComment(slug, number, body, existing);
  }
  return { number, ...t, step: state.step, body };
}

async function upsertComment(slug, number, body, existing) {
  if (existing) {
    await gh(["api", "-X", "PATCH", `repos/${slug}/issues/comments/${existing.id}`, "-f", `body=${body}`]);
  } else {
    await gh(["api", "-X", "POST", `repos/${slug}/issues/${number}/comments`, "-f", `body=${body}`]);
  }
}

function printTable(rows) {
  const order = { critical: 0, unclassified: 1, runtime: 2, dev: 3 };
  rows.sort((a, b) => order[a.level] - order[b.level] || a.number - b.number);
  console.log("| PR | Package | From → To | Jump | Level | Path | Socket | Step |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| #${r.number} | ${r.name} | ${r.from} → ${r.to} | ${r.jump} | ${r.level} | ${r.path} | ${r.socket} | ${r.step} |`,
    );
  }
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const args = argv.filter((a) => a !== "--dry-run");
  const levels = parseLevels(readFileSync(join(HERE, "..", "levels.yaml"), "utf8"));
  const slug = await repoSlug();

  const repIdx = args.indexOf("--replacement");
  const replacementOverride = repIdx === -1 ? null : Number(args[repIdx + 1]);
  if (repIdx !== -1) args.splice(repIdx, 2);
  if (replacementOverride !== null && !Number.isInteger(replacementOverride)) {
    throw new Error("--replacement needs a PR number");
  }

  let numbers;
  if (args[0] === "--all") {
    if (replacementOverride !== null) throw new Error("--replacement only works with a single PR");
    const list = JSON.parse(
      await gh(["pr", "list", "--author", "app/dependabot", "--state", "open", "--limit", "200", "--json", "number"]),
    );
    numbers = list.map((p) => p.number);
  } else if (args.length === 1 && /^\d+$/.test(args[0])) {
    numbers = [Number(args[0])];
  } else {
    throw new Error("usage: triage.mjs <pr> [--replacement <pr>] [--dry-run] | triage.mjs --all [--dry-run]");
  }

  const rows = [];
  for (const n of numbers) {
    rows.push(await triagePr(n, { dryRun, slug, levels, replacementOverride }));
  }
  printTable(rows);
  if (numbers.length === 1 || dryRun) {
    for (const r of rows) console.log(`\n${r.body}`);
  }
  if (dryRun) console.error("\n--dry-run: no labels or comments written.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
