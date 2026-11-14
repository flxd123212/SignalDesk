#!/usr/bin/env node
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const cliHelp = `SignalDesk CLI (MCP / HTTP permission scopes)
Usage: node server/external/cli.mjs <command> [arguments] [options]

  tools                       List authorized tools
  status                      Bound device snapshot
  files                       List project source files
  read <path>                 Read source and expected hash
  advice <message>            Submit a recommendation
  propose <path> --from FILE --hash HASH --reason TEXT
  write <path> --from FILE --hash HASH --reason TEXT
  send <payload> [--format text|hex|mixed] [--ending none|lf|crlf|cr]
  build <command-line>        Run an authorized toolchain command
  build-status                Inspect the last toolchain job
  call <tool> --json OBJECT    Invoke another authorized tool

Connection: SIGNALDESK_URL, SIGNALDESK_TOKEN environment variables.
Localhost only; no shell execution; disconnected tokens cannot call tools.
Writes, sends and builds require their corresponding enabled permission.
`;

export async function runCli(args, env = process.env, fetcher = fetch) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { help: { type: 'boolean', short: 'h' }, from: { type: 'string' }, hash: { type: 'string' }, reason: { type: 'string' }, format: { type: 'string', default: 'text' }, ending: { type: 'string', default: 'none' }, checksum: { type: 'string', default: 'none' }, json: { type: 'string' } } });
  const [command, argument, ...extra] = positionals;
  if (values.help || !command || command === 'help') return cliHelp;
  if (extra.length) throw new Error('Quote arguments containing spaces; see --help.');
  const base = new URL(env.SIGNALDESK_URL || 'http://127.0.0.1:4780');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) throw new Error('CLI only connects to a local SignalDesk HTTP service.');
  if (!env.SIGNALDESK_TOKEN) throw new Error('Set SIGNALDESK_TOKEN from External Agent connections.');
  const request = async (route, body) => {
    const response = await fetcher(new URL('/api/external/' + route, base), { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: { Authorization: `Bearer ${env.SIGNALDESK_TOKEN}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result;
  };
  if (command === 'tools') return request('tools');
  const reason = values.reason || 'Explicit CLI request';
  let tool, parameters;
  switch (command) {
    case 'status': tool = 'get_device_snapshot'; parameters = {}; break;
    case 'files': tool = 'list_firmware_files'; parameters = {}; break;
    case 'read': tool = 'read_firmware_file'; parameters = { path: argument }; break;
    case 'advice': tool = 'submit_advice'; parameters = { message: argument }; break;
    case 'write':
    case 'propose': {
      if (!argument || !values.from || !/^[a-f\d]{64}$/i.test(values.hash || '')) throw new Error('Specify project path, --from FILE and --hash from a prior read.');
      if ((await fs.stat(values.from)).size > 96 * 1024) throw new Error('Source file exceeds 96 KiB.');
      const bytes = await fs.readFile(values.from), content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      tool = command === 'write' ? 'write_project_file' : 'propose_file_change'; parameters = { path: argument, content, expectedHash: values.hash, reason }; break;
    }
    case 'send': tool = 'send_serial'; parameters = { text: argument, format: values.format, ending: values.ending, checksum: values.checksum, reason }; break;
    case 'build': tool = 'run_toolchain'; parameters = { commandLine: argument, reason }; break;
    case 'build-status': tool = 'get_toolchain_status'; parameters = {}; break;
    case 'call': tool = argument; parameters = JSON.parse(values.json || '{}'); break;
    default: throw new Error(`Unknown command: ${command}. Use --help.`);
  }
  if (['read', 'advice', 'send', 'build', 'call'].includes(command) && !argument) throw new Error('A command argument is required.');
  return (await request('call', { tool, arguments: parameters })).result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await runCli(process.argv.slice(2)); console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
