'use strict';
// Preloaded by drive.sh through NODE_OPTIONS=--require. Records every outbound
// socket connect the process attempts, so "offline" is something a drive
// observes instead of assumes.
//   FSF_CANARY=strict (default)  block the connect; the CLI sees ECONNREFUSED
//   FSF_CANARY=log               record the connect and let it through
//   FSF_CANARY_LOG=<file>        JSONL log, one line per attempt (stderr if unset)
// Unix-socket (path) connects are local IPC and are ignored.
const net = require('node:net');
const fs = require('node:fs');

const strict = process.env.FSF_CANARY !== 'log';
const logFile = process.env.FSF_CANARY_LOG;
const original = net.Socket.prototype.connect;

function target(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first !== null && typeof first === 'object') return first;
  return { port: first, host: args[1] };
}

function record(entry) {
  const line = JSON.stringify(entry) + '\n';
  if (logFile) fs.appendFileSync(logFile, line);
  else process.stderr.write('net-canary: ' + line);
}

net.Socket.prototype.connect = function connect(...args) {
  const t = target(args);
  if (t.path) return original.apply(this, args);

  const host = t.host || 'localhost';
  record({
    at: new Date().toISOString(),
    host,
    port: t.port,
    blocked: strict,
    pid: process.pid,
  });
  if (!strict) return original.apply(this, args);

  const error = Object.assign(
    new Error(`net-canary: outbound connect blocked: ${host}:${t.port}`),
    { code: 'ECONNREFUSED' },
  );
  process.nextTick(() => this.destroy(error));
  return this;
};
