import net from 'node:net';
import dgram from 'node:dgram';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

function loopback(host) {
  const value = String(host || 'localhost').toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '::1' || /^127\.\d+\.\d+\.\d+$/.test(value);
}
function block() {
  fs.appendFileSync('/workspace/scratch/qqagent-handoff-20261019/offline-blocks.jsonl', JSON.stringify({ pid: process.pid, blocked: true }) + '\n');
  throw Object.assign(new Error('OFFLINE_VALIDATION_EXTERNAL_NETWORK_BLOCKED'), { code: 'OFFLINE_NETWORK_BLOCKED' });
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0] : args;
  const options = first[0];
  if (options && typeof options === 'object') {
    if (!options.path && !loopback(options.host || options.hostname)) block();
  } else if (typeof options === 'number' && typeof first[1] === 'string' && !loopback(first[1])) block();
  return connect.apply(this, args);
};
const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (...args) {
  const address = args.findLast(value => typeof value === 'string');
  if (!address || !loopback(address)) block();
  return send.apply(this, args);
};
const spawn = childProcess.spawn;
childProcess.spawn = function (command, args = [], options) {
  if (/^(?:.*\/)?chromium(?:-browser)?$/.test(String(command))) {
    args = ['--proxy-server=http://127.0.0.1:9', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', ...args];
  }
  return spawn.call(this, command, args, options);
};
syncBuiltinESMExports();
