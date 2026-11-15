import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { electronExecutable } from './platform.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = electronExecutable(root);
if (!existsSync(executable)) throw new Error('Electron runtime is missing. Run npm install, then node node_modules/electron/install.js.');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [root], { cwd: root, env: environment, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
