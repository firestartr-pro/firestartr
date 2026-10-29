import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickSummary,
  isBlockingAlert,
  renderComment,
  parseLevels,
  parseState,
  nextState,
  classify,
  versionJump,
  pathFor,
  parseBumpTitle,
  levelOf,
  socketAlerts,
  requiredChecks,
  buildTriage,
} from "./triage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const levels = parseLevels(readFileSync(join(HERE, "..", "levels.yaml"), "utf8"));

test("parseLevels reads the real levels.yaml", () => {
  assert.ok(levels.dev.includes("typescript"));
  assert.ok(levels.runtime.includes("lodash"));
  assert.ok(levels.critical.includes("@octokit/*"));
});

test("parseLevels rejects unknown level keys and malformed lines", () => {
  assert.throws(() => parseLevels("bogus:\n  - \"x\"\n"), /unknown level/);
  assert.throws(() => parseLevels("dev:\n  x\n"), /cannot parse/);
});

test("versionJump: normal semver", () => {
  assert.equal(versionJump("1.2.3", "1.2.4"), "patch");
  assert.equal(versionJump("1.2.3", "1.3.0"), "minor");
  assert.equal(versionJump("1.2.3", "2.0.0"), "major");
});

test("versionJump: a minor bump in 0.x counts as major", () => {
  assert.equal(versionJump("0.4.2", "0.5.0"), "major");
  assert.equal(versionJump("0.4.2", "0.4.9"), "patch");
});

test("versionJump: any bump in 0.0.x counts as major", () => {
  assert.equal(versionJump("0.0.3", "0.0.4"), "major");
  assert.equal(versionJump("0.0.3", "0.1.0"), "major");
});

test("versionJump: unparseable versions fall back to major", () => {
  assert.equal(versionJump("latest", "1.0.0"), "major");
});

test("pathFor: only majors go to Path B", () => {
  assert.equal(pathFor("major"), "B");
  assert.equal(pathFor("minor"), "A");
  assert.equal(pathFor("patch"), "A");
});

test("parseBumpTitle accepts the lowercase title Dependabot produces", () => {
  assert.deepEqual(parseBumpTitle("fix(deps): bump qs from 6.16.0 to 6.17.0"), { name: "qs", from: "6.16.0", to: "6.17.0" });
});

test("parseBumpTitle reads the Dependabot title", () => {
  assert.deepEqual(parseBumpTitle("chore(deps): Bump lodash from 4.17.21 to 4.18.1"), {
    name: "lodash",
    from: "4.17.21",
    to: "4.18.1",
  });
  assert.equal(parseBumpTitle("Update everything"), null);
});

test("classify matches globs and takes the highest level", () => {
  const custom = { dev: ["@x/*"], runtime: ["@x/core"], critical: ["@x/core"] };
  assert.equal(classify("@x/other", custom), "dev");
  assert.equal(classify("@x/core", custom), "critical");
  assert.equal(classify("@x/core", { dev: [], runtime: [], critical: [] }), null);
});

test("classify matches exact names and wildcards", () => {
  assert.equal(classify("typescript", levels), "dev");
  assert.equal(classify("@kubernetes/client-node", levels), "critical");
  assert.equal(classify("definitely-unknown-pkg", levels), null);
});

function lock(packages) {
  return { lockfileVersion: 3, packages };
}

test("levelOf uses levels.yaml for direct dependencies", () => {
  const l = lock({
    "": { dependencies: { lodash: "^4" }, devDependencies: { typescript: "^5" } },
    "node_modules/lodash": {},
    "node_modules/typescript": {},
  });
  assert.equal(levelOf("lodash", l, levels), "runtime");
  assert.equal(levelOf("typescript", l, levels), "dev");
});

test("levelOf treats workspace manifests as direct dependencies", () => {
  const l = lock({
    "": {},
    "packages/operator": { dependencies: { "@kubernetes/client-node": "^1" } },
    "node_modules/@kubernetes/client-node": { dependencies: { "shared-lib": "^1" } },
    "node_modules/shared-lib": {},
  });
  assert.equal(levelOf("@kubernetes/client-node", l, levels), "critical");
  assert.equal(levelOf("shared-lib", l, levels), "critical");
});

test("levelOf treats optional and peer dependencies as direct", () => {
  const l = lock({
    "": {},
    "packages/operator": { optionalDependencies: { "@kubernetes/client-node": "^1" } },
    "packages/cli": { peerDependencies: { "cron-parser": "^4" } },
    "node_modules/@kubernetes/client-node": {},
    "node_modules/cron-parser": {},
  });
  assert.equal(levelOf("@kubernetes/client-node", l, levels), "critical");
  assert.equal(levelOf("cron-parser", l, levels), "runtime");
});

test("levelOf ignores cycles when a direct dependency gives a real level", () => {
  const l = lock({
    "": { devDependencies: { jest: "^29" } },
    "node_modules/jest": { dependencies: { a: "^1" } },
    "node_modules/a": { dependencies: { b: "^1" } },
    "node_modules/b": { dependencies: { a: "^1" } },
  });
  assert.equal(levelOf("a", l, levels), "dev");
  assert.equal(levelOf("b", l, levels), "dev");
});

test("levelOf walks up to the highest puller for indirect dependencies", () => {
  const l = lock({
    "": { dependencies: { "@kubernetes/client-node": "^1" }, devDependencies: { jest: "^29" } },
    "node_modules/@kubernetes/client-node": { dependencies: { "shared-lib": "^1" } },
    "node_modules/jest": { dependencies: { "shared-lib": "^1", "jest-only": "^1" } },
    "node_modules/shared-lib": {},
    "node_modules/jest-only": {},
  });
  assert.equal(levelOf("shared-lib", l, levels), "critical");
  assert.equal(levelOf("jest-only", l, levels), "dev");
});

test("levelOf walks through nested dependencies", () => {
  const l = lock({
    "": { devDependencies: { jest: "^29" } },
    "node_modules/jest": { dependencies: { "mid": "^1" } },
    "node_modules/mid": { dependencies: { "leaf": "^1" } },
    "node_modules/leaf": {},
  });
  assert.equal(levelOf("leaf", l, levels), "dev");
});

test("levelOf terminates on dependency cycles", () => {
  const l = lock({
    "": { dependencies: { a: "^1" } },
    "node_modules/a": { dependencies: { b: "^1" } },
    "node_modules/b": { dependencies: { a: "^1" } },
  });
  assert.equal(levelOf("b", l, levels), "unclassified");
});

test("levelOf falls back to unclassified for unknown packages", () => {
  const l = lock({
    "": { dependencies: { "mystery-pkg": "^1" } },
    "node_modules/mystery-pkg": {},
    "node_modules/orphan": {},
  });
  assert.equal(levelOf("mystery-pkg", l, levels), "unclassified");
  assert.equal(levelOf("orphan", l, levels), "unclassified");
  assert.equal(levelOf("not-in-lock", l, levels), "unclassified");
});

test("socketAlerts finds alerts at any depth and ignores empty lists", () => {
  assert.deepEqual(socketAlerts({ score: 90, alerts: [] }), []);
  assert.equal(socketAlerts({ a: { b: [{ alerts: [{ type: "malware" }] }] } }).length, 1);
});

test("requiredChecks follow the level and path rules", () => {
  assert.deepEqual(requiredChecks("dev", "A", "patch"), ["CI"]);
  assert.deepEqual(requiredChecks("runtime", "A", "minor"), ["Copilot review", "CI", "e2e with default suites"]);
  assert.deepEqual(requiredChecks("critical", "A", "minor"), [
    "Copilot review",
    "CI",
    "e2e with all suites",
    "operator and CLI snapshots on pre",
  ]);
  assert.deepEqual(requiredChecks("runtime", "B", "major"), [
    "Copilot review",
    "CI",
    "e2e with all suites",
    "operator and CLI snapshots on pre",
  ]);
  assert.deepEqual(requiredChecks("dev", "B", "major"), ["Copilot review", "CI"]);
});

test("buildTriage produces labels, squash subject and a stopping socket alert", () => {
  const l = lock({
    "": { dependencies: { lodash: "^4" } },
    "node_modules/lodash": {},
  });
  const t = buildTriage({
    name: "lodash",
    from: "4.17.21",
    to: "4.18.1",
    lock: l,
    levels,
    socketResult: { alerts: [{ name: "malware", severity: "critical", category: "malware" }] },
  });
  assert.equal(t.jump, "minor");
  assert.equal(t.path, "A");
  assert.equal(t.level, "runtime");
  assert.equal(t.socket, "alert");
  assert.deepEqual(t.labels, ["jump/minor", "level/runtime", "path/A", "socket/alert"]);
  assert.equal(t.squash, "fix(deps): bump lodash from 4.17.21 to 4.18.1");
});

test("buildTriage uses chore(deps) for dev-only packages", () => {
  const t = buildTriage({
    name: "typescript",
    from: "5.4.0",
    to: "5.4.1",
    lock: lock({ "": { devDependencies: { typescript: "^5" } }, "node_modules/typescript": {} }),
    levels,
    socketResult: { alerts: [] },
  });
  assert.equal(t.squash, "chore(deps): bump typescript from 5.4.0 to 5.4.1");
  assert.equal(t.socket, "ok");
});

test("nextState keeps step and runs while the head is unchanged", () => {
  const t = { socket: "ok" };
  const previous = { head: "abc", step: "waiting for rebase", runs: "123", replacement: null };
  assert.deepEqual(nextState(t, previous, "abc"), previous);
  assert.deepEqual(nextState(t, previous, "def"), { head: "def", step: "triaged", runs: "", replacement: null });
  assert.deepEqual(nextState(t, null, "abc"), { head: "abc", step: "triaged", runs: "", replacement: null });
});

test("nextState always stops on a Socket alert", () => {
  const previous = { head: "abc", step: "e2e started", runs: "9", replacement: null };
  assert.deepEqual(nextState({ socket: "alert" }, previous, "abc"), {
    head: "abc",
    step: "stopped: socket alert",
    runs: "",
    replacement: null,
  });
});

test("nextState resumes after a Socket stop once the alert clears", () => {
  const previous = { head: "abc", step: "stopped: socket alert", runs: "", replacement: null };
  assert.deepEqual(nextState({ socket: "ok" }, previous, "abc"), { head: "abc", step: "triaged", runs: "", replacement: null });
});

test("parseState reads the head, step and runs of a summary comment", () => {
  const body = "## x\n\nhead: abc\nstep: e2e started\nruns: 1,2";
  assert.deepEqual(parseState(body), { head: "abc", step: "e2e started", runs: "1,2", replacement: null });
  assert.equal(parseState("no state here"), null);
});

test("nextState resets the checks when the replacement PR head changes", () => {
  const previous = { head: "abc", step: "e2e started", runs: "9", replacement: 170 };
  assert.deepEqual(nextState({ socket: "ok" }, previous, "def"), {
    head: "def",
    step: "triaged",
    runs: "",
    replacement: 170,
  });
});

test("parseState reads the replacement PR number", () => {
  const body = "head: abc\nreplacement: #170\nstep: e2e started";
  assert.deepEqual(parseState(body), { head: "abc", step: "e2e started", runs: "", replacement: 170 });
});

test("a recorded replacement PR keeps Path B and its checks on retriage", () => {
  const t = buildTriage({
    name: "typescript",
    from: "5.4.0",
    to: "5.4.1",
    lock: lock({ "": { devDependencies: { typescript: "^5" } }, "node_modules/typescript": {} }),
    levels,
    socketResult: { alerts: [] },
    replacement: 170,
  });
  assert.equal(t.path, "B");
  assert.ok(t.labels.includes("path/B"));
  assert.ok(t.checks.includes("Copilot review"));
});

test("pickSummary only trusts summaries from authorized collaborators", () => {
  const comments = [
    { id: 1, user: { login: "outsider" }, body: "<!-- handle-dependabot-pr:summary -->\nstep: e2e done" },
    { id: 2, user: { login: "teammate" }, body: "<!-- handle-dependabot-pr:summary -->\nstep: triaged" },
  ];
  assert.equal(pickSummary(comments, new Set(["teammate"])).id, 2);
  assert.equal(pickSummary(comments.slice(0, 1), new Set(["teammate"])), null);
});

test("middle and low Socket findings are noted but do not stop the flow", () => {
  const alerts = [
    { name: "shellAccess", severity: "middle", category: "supplyChainRisk", example: "npm/cdk8s@2.70.114" },
    { name: "networkAccess", severity: "low", category: "supplyChainRisk", example: "npm/x@1.0.0" },
  ];
  const t = buildTriage({
    name: "typescript",
    from: "5.4.0",
    to: "5.4.1",
    lock: lock({ "": { devDependencies: { typescript: "^5" } }, "node_modules/typescript": {} }),
    levels,
    socketResult: { alerts },
  });
  assert.equal(t.socket, "ok");
  assert.equal(t.socketAlerts.length, 0);
  assert.equal(t.socketNotes.length, 2);
  assert.ok(!renderComment(t, { head: "h", step: "triaged", runs: "", replacement: null }).includes("Stopped: Socket alert"));
});

test("high or critical, malware, vulnerability and typosquat findings stop the flow", () => {
  assert.equal(isBlockingAlert({ name: "x", severity: "high", category: "supplyChainRisk" }), true);
  assert.equal(isBlockingAlert({ name: "x", severity: "critical", category: "quality" }), true);
  assert.equal(isBlockingAlert({ name: "x", severity: "low", category: "malware" }), true);
  assert.equal(isBlockingAlert({ name: "x", severity: "middle", category: "vulnerability" }), true);
  assert.equal(isBlockingAlert({ name: "typosquat", severity: "low", category: "supplyChainRisk" }), true);
  assert.equal(isBlockingAlert({ name: "shellAccess", severity: "middle", category: "supplyChainRisk" }), false);
});
