import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-browser-tests-'));
const runtime = await startServer({ port: 4788, autoDemo: true, directory: path.join(directory, 'sessions'), listPorts: async () => [] });
let closing = false;
const close = async () => { if (closing) return; closing = true; await runtime.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); process.exit(0); };
process.on('SIGINT', close); process.on('SIGTERM', close);
