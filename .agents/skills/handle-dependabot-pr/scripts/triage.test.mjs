import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildTriage,
  classify,
  dedupeAlerts,
  levelOf,
  nextState,
  parseBumpTitle,
  parseLevels,
  parseSocketScan,
  parseState,
  pathFor,
  pickSummary,
  renderComment,
  reportAlerts,
  requiredChecks,
  versionJump,
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

// Socket fixtures, shaped like `socket scan create --report --json`: the report
// arrives inside `{ ok, message?, data }`, `data.alerts` is folded to
// ecosystem → package → version, and the version node is the alert leaf.
function scanReport(alerts = {}, healthy = Object.keys(alerts).length === 0) {
  const payload = {
    ok: true,
    data: {
      includeLicensePolicy: true,
      healthy,
      orgSlug: "firestartr-pro",
      scanId: "scan-1",
      options: { fold: "version", reportLevel: "error" },
      alerts,
    },
  };
  if (!healthy) {
    payload.message = "The report contains at least one alert that violates the policies set by your organization";
  }
  return JSON.stringify(payload);
}

function leaf(type = "malware") {
  return {
    type,
    policy: "error",
    url: "https://socket.dev/npm/package/evil-pkg",
    manifest: ["package.json"],
  };
}

test("parseSocketScan passes when the org policy reports the scan healthy", () => {
  assert.deepEqual(parseSocketScan({ exitCode: 0, stdout: scanReport() }), { verdict: "ok", alerts: [] });
});

test("parseSocketScan blocks when the report is unhealthy and lists the alert", () => {
  const stdout = scanReport({ npm: { "evil-pkg": { "1.0.0": leaf() } } });
  const result = parseSocketScan({ exitCode: 1, stdout });
  assert.equal(result.verdict, "block");
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].type, "malware");
  assert.equal(result.alerts[0].package, "evil-pkg");
  assert.equal(result.alerts[0].version, "1.0.0");
});

test("parseSocketScan accepts a report without the command envelope", () => {
  const stdout = JSON.stringify({ healthy: true, alerts: {} });
  assert.equal(parseSocketScan({ exitCode: 0, stdout }).verdict, "ok");
});

test("parseSocketScan passes only on an explicit healthy report from a successful exit", () => {
  assert.equal(parseSocketScan({ exitCode: 1, stdout: scanReport() }).verdict, "unknown");
  assert.equal(parseSocketScan({ exitCode: 0, stdout: '{"ok":true}' }).verdict, "unknown");
  assert.equal(
    parseSocketScan({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { alerts: {} } }) }).verdict,
    "unknown",
  );
});

test("parseSocketScan treats a missing report or CLI error as unknown", () => {
  assert.equal(parseSocketScan({ exitCode: 1, stdout: "" }).verdict, "unknown");
  assert.equal(parseSocketScan({ exitCode: 0, stdout: "OK" }).verdict, "unknown");
});

test("parseSocketScan reads a report that also carries CLI noise around the JSON", () => {
  const stdout = `socket scan\n✔ done\n${scanReport()}\n`;
  assert.equal(parseSocketScan({ exitCode: 0, stdout }).verdict, "ok");
});

test("reportAlerts reads the folded, unfolded and flat shapes", () => {
  const folded = { alerts: { npm: { a: { "1.0.0": leaf() } } } };
  const unfolded = { alerts: { npm: { a: { "1.0.0": { "package.json": { "1:1": leaf() } } } } } };
  const flat = { alerts: [{ ...leaf(), package: "b", version: "2.0.0" }] };
  for (const report of [folded, unfolded, flat]) {
    assert.equal(reportAlerts(report).length, 1);
    assert.equal(reportAlerts(report)[0].type, "malware");
  }
  assert.deepEqual(reportAlerts(undefined), []);
});

test("dedupeAlerts lists each type once per package@version", () => {
  const alerts = [
    { type: "malware", package: "a", version: "1.0.0" },
    { type: "malware", package: "a", version: "1.0.0", file: "other.json" },
    { type: "malware", package: "a", version: "2.0.0" },
    { type: "typosquat", package: "a", version: "1.0.0" },
  ];
  assert.equal(dedupeAlerts(alerts).length, 3);
});

test("requiredChecks follow the level and path rules", () => {
  assert.deepEqual(requiredChecks("dev", "A", "patch"), ["CI"]);
  assert.deepEqual(requiredChecks("runtime", "A", "minor"), ["Copilot review", "CI", "e2e all suites except massive (github, terraform, k8s-rate-limits, crd-upgrade, retry-lifecycle, core)"]);
  assert.deepEqual(requiredChecks("critical", "A", "minor"), [
    "Copilot review",
    "CI",
    "e2e all suites except massive (github, terraform, k8s-rate-limits, crd-upgrade, retry-lifecycle, core)",
    "operator and CLI snapshots on pre",
  ]);
  assert.deepEqual(requiredChecks("runtime", "B", "major"), [
    "Copilot review",
    "CI",
    "e2e all suites except massive (github, terraform, k8s-rate-limits, crd-upgrade, retry-lifecycle, core)",
    "operator and CLI snapshots on pre",
  ]);
  assert.deepEqual(requiredChecks("dev", "B", "major"), ["Copilot review", "CI"]);
});

test("buildTriage produces labels, squash subject and a stopping socket block", () => {
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
    socketResult: {
      verdict: "block",
      alerts: [{ type: "malware", severity: "critical", package: "lodash", version: "4.18.1" }],
    },
  });
  assert.equal(t.jump, "minor");
  assert.equal(t.path, "A");
  assert.equal(t.level, "runtime");
  assert.equal(t.socket, "block");
  assert.deepEqual(t.labels, ["jump/minor", "level/runtime", "path/A", "socket/block"]);
  assert.equal(t.squash, "chore: bump lodash from 4.17.21 to 4.18.1");
});

test("buildTriage uses chore subjects for all dependency levels", () => {
  const dev = buildTriage({
    name: "typescript",
    from: "5.4.0",
    to: "5.4.1",
    lock: lock({ "": { devDependencies: { typescript: "^5" } }, "node_modules/typescript": {} }),
    levels,
    socketResult: { verdict: "ok", alerts: [] },
  });
  assert.equal(dev.squash, "chore: bump typescript from 5.4.0 to 5.4.1");
  assert.equal(dev.socket, "ok");

  const runtime = buildTriage({
    name: "lodash",
    from: "4.17.21",
    to: "4.17.22",
    lock: lock({ "": { dependencies: { lodash: "^4" } }, "node_modules/lodash": {} }),
    levels,
    socketResult: { verdict: "ok", alerts: [] },
  });
  assert.equal(runtime.squash, "chore: bump lodash from 4.17.21 to 4.17.22");

  const critical = buildTriage({
    name: "@kubernetes/client-node",
    from: "1.0.0",
    to: "1.0.1",
    lock: lock({ "": { dependencies: { "@kubernetes/client-node": "^1" } }, "node_modules/@kubernetes/client-node": {} }),
    levels,
    socketResult: { verdict: "ok", alerts: [] },
  });
  assert.equal(critical.squash, "chore: bump @kubernetes/client-node from 1.0.0 to 1.0.1");
});

test("nextState keeps step and runs while the head is unchanged", () => {
  const t = { socket: "ok" };
  const previous = { head: "abc", step: "waiting for rebase", runs: "123", replacement: null };
  assert.deepEqual(nextState(t, previous, "abc"), previous);
  assert.deepEqual(nextState(t, previous, "def"), { head: "def", step: "triaged", runs: "", replacement: null });
  assert.deepEqual(nextState(t, null, "abc"), { head: "abc", step: "triaged", runs: "", replacement: null });
});

test("nextState always stops on a Socket block", () => {
  const previous = { head: "abc", step: "e2e started", runs: "9", replacement: null };
  assert.deepEqual(nextState({ socket: "block" }, previous, "abc"), {
    head: "abc",
    step: "stopped: socket block",
    runs: "",
    replacement: null,
  });
});

test("nextState always stops on an unknown Socket result", () => {
  const previous = { head: "abc", step: "e2e started", runs: "9", replacement: null };
  assert.deepEqual(nextState({ socket: "unknown" }, previous, "abc"), {
    head: "abc",
    step: "stopped: socket unknown",
    runs: "",
    replacement: null,
  });
});

test("nextState resumes after a Socket stop once the verdict clears", () => {
  const previous = { head: "abc", step: "stopped: socket block", runs: "", replacement: null };
  assert.deepEqual(nextState({ socket: "ok" }, previous, "abc"), { head: "abc", step: "triaged", runs: "", replacement: null });
});

test("an old stopped: socket alert step resumes to triaged on retriage", () => {
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

test("nextState resets the checks when the replacement PR changes, even with the same head", () => {
  const previous = { head: "abc", step: "e2e started", runs: "9", replacement: 170 };
  assert.deepEqual(nextState({ socket: "ok" }, previous, "abc", 171), {
    head: "abc",
    step: "triaged",
    runs: "",
    replacement: 171,
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
    socketResult: { verdict: "ok", alerts: [] },
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

test("a Socket block lists each alert once, even when it appears in several files", () => {
  const t = buildTriage({
    name: "typescript",
    from: "5.4.0",
    to: "5.4.1",
    lock: lock({ "": { devDependencies: { typescript: "^5" } }, "node_modules/typescript": {} }),
    levels,
    socketResult: {
      verdict: "block",
      alerts: [
        { type: "malware", severity: "critical", package: "a", version: "1.0.0", file: "package.json" },
        { type: "malware", severity: "critical", package: "a", version: "1.0.0", file: "other.json" },
      ],
    },
  });
  assert.equal(t.socket, "block");
  assert.equal(t.socketAlerts.length, 1);
  assert.ok(t.labels.includes("socket/block"));
  const body = renderComment(t, { head: "h", step: "stopped: socket block", runs: "", replacement: null });
  assert.ok(body.includes("Stopped: Socket block"));
  assert.equal(body.match(/malware/g).length, 1);
});

test("a Socket unknown reports the notice and no alerts", () => {
  const t = buildTriage({
    name: "typescript",
    from: "5.4.0",
    to: "5.4.1",
    lock: lock({ "": { devDependencies: { typescript: "^5" } }, "node_modules/typescript": {} }),
    levels,
    socketResult: { verdict: "unknown", alerts: [] },
  });
  assert.ok(t.labels.includes("socket/unknown"));
  assert.ok(
    renderComment(t, { head: "h", step: "stopped: socket unknown", runs: "", replacement: null }).includes(
      "Stopped: Socket unknown",
    ),
  );
});

test("a warn-level finding in the org does not stop the flow", () => {
  // The org policy reports only Block alerts, so a healthy report is a pass
  // even while `recentlyPublished` warnings stay visible in the dashboard.
  const result = parseSocketScan({ exitCode: 0, stdout: scanReport({}, true) });
  const t = buildTriage({
    name: "globals",
    from: "17.13.0",
    to: "17.14.0",
    lock: lock({ "": { devDependencies: { globals: "^17" } }, "node_modules/globals": {} }),
    levels,
    socketResult: result,
  });
  assert.equal(t.socket, "ok");
  assert.deepEqual(t.socketAlerts, []);
});
