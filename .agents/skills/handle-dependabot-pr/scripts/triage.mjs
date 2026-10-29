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

// Only the operator's own summary is trusted. Anyone else can post the marker
// and a fake state, so other authors' comments are ignored.
export function pickSummary(comments, viewer) {
  return comments.find((c) => c.body?.includes(MARKER) && c.user?.login === viewer) ?? null;
}

// Socket gate. Any alert found anywhere in the score output stops the flow.
export function socketAlerts(node, found = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => socketAlerts(child, found));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "alerts" && Array.isArray(value) && value.length > 0) {
        found.push(...value);
      } else {
        socketAlerts(value, found);
      }
    }
  }
  return found;
}

export function squashSubject(level, name, from, to) {
  const prefix = level === "dev" ? "chore" : "fix";
  return `${prefix}(deps): bump ${name} from ${from} to ${to}`;
}

export function requiredChecks(level, path, jump) {
  // Path B: a 🟡 major is handled as 🔴. Copilot review is requested at every level.
  if (path === "B") {
    const effective = jump === "major" && level !== "dev" ? "critical" : level;
    return ["Copilot review", ...requiredChecks(effective, "A", jump).filter((c) => c !== "Copilot review")];
  }
  if (level === "dev") return ["CI"];
  if (level === "critical") return ["Copilot review", "CI", "e2e with all suites", "operator and CLI snapshots on pre"];
  return ["Copilot review", "CI", "e2e with default suites"];
}

export function buildTriage({ name, from, to, lock, levels, socketResult, replacement = null }) {
  const jump = versionJump(from, to);
  const path = replacement ? "B" : pathFor(jump);
  const level = levelOf(name, lock, levels);
  const socket = socketResult.alerts.length > 0 ? "alert" : "ok";
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
    squash: squashSubject(level, name, from, to),
    socketAlerts: socketResult.alerts,
  };
}

export function parseState(body) {
  const head = /^head: (\S+)$/m.exec(body ?? "")?.[1] ?? null;
  const step = /^step: (.*)$/m.exec(body ?? "")?.[1] ?? null;
  const runs = /^runs: (.*)$/m.exec(body ?? "")?.[1] ?? "";
  const replacement = /^replacement: #(\d+)$/m.exec(body ?? "")?.[1];
  return head && step ? { head, step, runs, replacement: replacement ? Number(replacement) : null } : null;
}

// Keep the recorded step and run IDs while the head being checked is unchanged,
// so resuming never repeats work. The head is the replacement PR's when one is
// set, otherwise the Dependabot PR's. A Socket alert always stops the flow.
export function nextState(t, previous, head, replacement = previous?.replacement ?? null) {
  if (t.socket === "alert") return { head, step: "stopped: socket alert", runs: "", replacement };
  const resumable = previous && previous.head === head && !previous.step.startsWith("stopped: socket");
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
  if (t.socket === "alert") {
    lines.push("", "**Stopped: Socket alert.** Review the findings before going further.");
    for (const alert of t.socketAlerts.slice(0, 20)) {
      lines.push(`- ${typeof alert === "string" ? alert : JSON.stringify(alert)}`);
    }
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

async function socketScore(name, version) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "socket",
      ["package", "score", "npm", `${name}@${version}`, "--json"],
      { maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch (err) {
    throw new Error(`socket failed for ${name}@${version}: ${err.stderr || err.message}`);
  }
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error(`socket returned non-JSON output for ${name}@${version}`);
  }
  return { alerts: socketAlerts(json), raw: json };
}

async function repoSlug() {
  return (await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])).trim();
}

async function fileAt(slug, ref, path) {
  const out = await gh(["api", `repos/${slug}/contents/${path}?ref=${ref}`, "--jq", ".content"]);
  return Buffer.from(out.trim(), "base64").toString("utf8");
}

async function findSummary(slug, number, viewer) {
  const pages = JSON.parse(await gh(["api", `repos/${slug}/issues/${number}/comments`, "--paginate", "--slurp"]));
  return pickSummary(pages.flat(), viewer);
}

async function triagePr(number, { dryRun, slug, levels, replacementOverride, viewer }) {
  const pr = JSON.parse(
    await gh(["pr", "view", String(number), "--json", "number,title,headRefName,headRefOid,state"]),
  );
  if (pr.state !== "OPEN") throw new Error(`#${number} is not open`);
  const bump = parseBumpTitle(pr.title);
  if (!bump) throw new Error(`#${number}: cannot read package and versions from title "${pr.title}"`);

  const lock = JSON.parse(await fileAt(slug, pr.headRefName, "package-lock.json"));
  const socketResult = await socketScore(bump.name, bump.to);

  const existing = await findSummary(slug, number, viewer);
  const previous = existing ? parseState(existing.body) : null;
  const replacement = replacementOverride ?? previous?.replacement ?? null;
  const t = buildTriage({ ...bump, lock, levels, socketResult, replacement });
  const head = replacement
    ? (await gh(["pr", "view", String(replacement), "--json", "headRefOid", "-q", ".headRefOid"])).trim()
    : pr.headRefOid;
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
  const viewer = (await gh(["api", "user", "--jq", ".login"])).trim();

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
    rows.push(await triagePr(n, { dryRun, slug, levels, replacementOverride, viewer }));
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
