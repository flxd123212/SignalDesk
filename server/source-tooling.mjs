import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { artifact, program } from './engineering.mjs';

function projectPath(root, absolute) {
  const relative = path.relative(root, absolute);
  return relative && !path.isAbsolute(relative) && !relative.split(path.sep).includes('..')
    ? relative.split(path.sep).join('/')
    : null;
}

export async function clangQuery(workspace, input) {
  const methods = {
    diagnostics: '',
    definition: 'textDocument/definition',
    references: 'textDocument/references',
  };
  if (!Object.hasOwn(methods, input.mode)) throw new Error('未知源码查询');
  const file = await workspace.resolve(input.path),
    root = await fs.realpath(workspace.root);
  const { content } = await workspace.read(input.path);
  const db = input.database
    ? await artifact(root, input.database, /(?:^|[\\/])compile_commands\.json$/i)
    : null;
  const args = [
    `--background-index=${input.mode === 'references' ? 1 : 0}`,
    '--clang-tidy=0',
    '--log=error',
    ...(db ? ['--compile-commands-dir=' + path.dirname(db)] : []),
  ];
  const child = spawn(await program('clangd'), args, { cwd: root, windowsHide: true });
  const uri = pathToFileURL(file).href,
    rootUri = pathToFileURL(root).href;
  const document = { uri },
    position = {
      line: Math.max(0, Number(input.line || 1) - 1),
      character: Math.max(0, Number(input.column || 1) - 1),
    };
  const send = (msg) => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...msg });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  let bytes = Buffer.alloc(0),
    stderr = '';
  return new Promise((resolve, reject) => {
    let finished = false,
      ready = false,
      requested = false,
      indexTimer;
    const indexing = new Set();
    const finish = (error, rows) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(indexTimer);
      const settle = () => (error ? reject(error) : resolve(rows));
      if (child.exitCode !== null || child.signalCode || !child.pid) {
        settle();
        return;
      }
      child.once('close', settle);
      child.kill();
    };
    const timer = setTimeout(() => finish(new Error('clangd 等待响应超时，请检查编译数据库')), 45000);
    const lookup = () => {
      clearTimeout(indexTimer);
      if (!ready || requested || indexing.size) return;
      indexTimer = setTimeout(
        () => {
          requested = true;
          send({
            id: 2,
            method: methods[input.mode],
            params: { textDocument: document, position, context: { includeDeclaration: true } },
          });
        },
        input.mode === 'references' ? 600 : 0,
      );
    };
    child.on('error', (e) => finish(e));
    child.stdin.on('error', (e) => finish(e));
    child.stderr.on('data', (s) => {
      stderr = (stderr + s).slice(-1000);
    });
    child.on('close', () => finish(new Error(stderr || 'clangd 已退出')));
    child.stdout.on('data', (buf) => {
      bytes = Buffer.concat([bytes, buf]);
      try {
        while (bytes.includes('\r\n\r\n')) {
          const end = bytes.indexOf('\r\n\r\n'),
            length = Number(/Content-Length:\s*(\d+)/i.exec(bytes.subarray(0, end).toString())?.[1]);
          if (!Number.isSafeInteger(length) || length > 16e6) throw new Error('clangd 响应无效');
          if (bytes.length < end + 4 + length) break;
          const msg = JSON.parse(bytes.subarray(end + 4, end + 4 + length));
          bytes = bytes.subarray(end + 4 + length);
          if (msg.error) throw new Error(msg.error.message);
          if (msg.id === 1 && !msg.method) {
            send({ method: 'initialized', params: {} });
            send({
              method: 'textDocument/didOpen',
              params: {
                textDocument: {
                  uri,
                  version: 1,
                  languageId: /\.c$/i.test(file) ? 'c' : 'cpp',
                  text: content,
                },
              },
            });
          }
          if (msg.method === 'textDocument/publishDiagnostics' && msg.params.uri === uri) {
            if (input.mode === 'diagnostics')
              return finish(
                null,
                msg.params.diagnostics.map((d) => ({
                  path: input.path,
                  line: d.range.start.line + 1,
                  column: d.range.start.character + 1,
                  text: d.message,
                })),
              );
            ready = true;
            lookup();
          }
          if (msg.id === 2 && !msg.method) {
            const locations = [].concat(msg.result || []).slice(0, 500);
            return finish(
              null,
              locations.flatMap((loc) => {
                const relative = projectPath(root, fileURLToPath(loc.uri));
                return relative
                  ? [
                      {
                        path: relative,
                        line: loc.range.start.line + 1,
                        column: loc.range.start.character + 1,
                        text: relative,
                      },
                    ]
                  : [];
              }),
            );
          }
          if (msg.method === '$/progress') {
            if (msg.params.value.kind === 'begin') indexing.add(msg.params.token);
            if (msg.params.value.kind === 'end') indexing.delete(msg.params.token);
            lookup();
          }
          if (msg.method && msg.id !== undefined) send({ id: msg.id, result: null });
        }
      } catch (e) {
        finish(e);
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        processId: process.pid,
        rootUri,
        capabilities: { window: { workDoneProgress: true }, textDocument: { publishDiagnostics: {} } },
      },
    });
  });
}

const gdbPrograms = {
  arm: ['arm-none-eabi-gdb', 'gdb-multiarch'],
  riscv: ['riscv-none-elf-gdb', 'riscv32-unknown-elf-gdb', 'riscv64-unknown-elf-gdb', 'gdb-multiarch'],
};
export class ProbeSession {
  seq = 0;
  pending = new Map();
  log = [];
  state = 'disconnected';
  scope = '';
  busy = false;
  snapshot() {
    return { state: this.state, log: this.log.slice(), location: this.location, scope: this.scope };
  }
  async attach(scope, root, opts) {
    if (this.busy || this.child) throw new Error('请先断开当前探针');
    if (
      !Object.hasOwn(gdbPrograms, opts.arch) ||
      !Number.isInteger(opts.port) ||
      opts.port < 1 ||
      opts.port > 65535
    )
      throw new Error('调试架构或端口无效');
    this.busy = true;
    this.scope = scope;
    this.log = [];
    this.location = null;
    try {
      const elf = await artifact(root, opts.elf, /\.(elf|axf|out)$/i);
      let bin;
      for (const name of gdbPrograms[opts.arch]) {
        try {
          bin = await program(name);
          break;
        } catch {}
      }
      if (!bin) throw new Error(`未找到 ${gdbPrograms[opts.arch].join(' / ')}`);
      const child = (this.child = spawn(
        bin,
        ['-nx', '-nh', '-iex', 'set auto-load off', '--interpreter=mi2', '--quiet', elf],
        { cwd: root, windowsHide: true },
      ));
      this.state = 'connecting';
      const line = (s) => {
        if (child !== this.child) return;
        const m = /^(\d+)\^(\w+)(.*)/.exec(s);
        if (m) {
          const cb = this.pending.get(m[1]);
          cb?.(m[2] === 'error' ? new Error(m[3]) : null, m[3]);
        }
        if (s.startsWith('*running')) this.state = 'running';
        if (s.startsWith('*stopped')) {
          this.state = 'stopped';
          this.location = null;
          const name = /fullname=("(?:\\.|[^"\\])*")/.exec(s),
            n = /\bline="(\d+)"/.exec(s);
          if (name && n)
            try {
              this.location = { path: projectPath(root, JSON.parse(name[1])), line: Number(n[1]) };
            } catch {}
        }
        if (s && !/^\(gdb\)|^=library/.test(s)) {
          this.log.push(s.slice(0, 8000));
          if (this.log.length > 80) this.log.shift();
        }
      };
      createInterface({ input: child.stdout }).on('line', line);
      createInterface({ input: child.stderr }).on('line', line);
      const ended = (e) => {
        if (this.child !== child) return;
        this.child = null;
        this.state = 'disconnected';
        for (const cb of this.pending.values()) cb(e);
      };
      child.on('error', ended);
      child.on('close', () => ended(new Error('GDB 已断开')));
      child.stdin.on('error', ended);
      await this.command('-gdb-set mi-async on');
      await this.command(`-target-select remote 127.0.0.1:${opts.port}`);
      if (this.state === 'connecting') this.state = 'stopped';
      return this.snapshot();
    } catch (e) {
      this.close();
      throw e;
    } finally {
      this.busy = false;
    }
  }
  command(text) {
    if (!this.child) return Promise.reject(new Error('探针未连接'));
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('GDB 命令超时'));
      }, 8000);
      this.pending.set(id, (err, value) => {
        clearTimeout(timer);
        this.pending.delete(id);
        err ? reject(err) : resolve(value);
      });
      this.child.stdin.write(id + text + '\n');
    });
  }
  async act(scope, workspace, opts) {
    if (this.scope !== scope || !this.child) throw new Error('请连接当前工程的调试探针');
    const cmds = {
      pause: '-exec-interrupt --all',
      continue: '-exec-continue',
      step: '-exec-next',
      into: '-exec-step',
      locals: '-stack-list-variables --simple-values',
      stack: '-stack-list-frames 0 20',
      registers: '-data-list-register-values x',
    };
    if (opts.action === 'disconnect') {
      this.close();
      return this.snapshot();
    }
    if (opts.action === 'break') {
      const file = await workspace.resolve(opts.path);
      if (!Number.isSafeInteger(opts.line) || opts.line < 1) throw new Error('断点行号无效');
      await this.command(
        `-break-insert --source ${JSON.stringify(file.split(path.sep).join('/'))} --line ${opts.line}`,
      );
    } else if (opts.action === 'clear') await this.command('-break-delete');
    else if (Object.hasOwn(cmds, opts.action)) await this.command(cmds[opts.action]);
    else throw new Error('未知调试操作');
    return this.snapshot();
  }
  close() {
    const child = this.child;
    this.child = null;
    this.state = 'disconnected';
    this.location = null;
    for (const cb of this.pending.values()) cb(new Error('调试已关闭'));
    child?.kill();
  }
}
