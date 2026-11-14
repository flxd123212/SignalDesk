import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const base = new URL(process.env.SIGNALDESK_URL || 'http://127.0.0.1:4780');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') throw new Error('SignalDesk MCP only connects to a local HTTP service.');
const token = process.env.SIGNALDESK_TOKEN;
if (!token) throw new Error('Set SIGNALDESK_TOKEN to a scoped token from SignalDesk External Agent connections.');
const call = async (route, body) => {
  const response = await fetch(new URL('/api/external/' + route, base), { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data;
};
const server = new Server({ name: 'signaldesk', version: '0.2.0' }, { capabilities: { tools: { listChanged: true } } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await call('tools') }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try { const data = await call('call', { tool: request.params.name, arguments: request.params.arguments || {} }); return { content: [{ type: 'text', text: JSON.stringify(data.result, null, 2) }] }; }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
await server.connect(new StdioServerTransport());
let signature = '';
const refresh = setInterval(async () => {
  try { const next = JSON.stringify(await call('tools')); if (signature && next !== signature) await server.notification({ method: 'notifications/tools/list_changed' }); signature = next; }
  catch { /* A revoked connection remains unavailable until the client reconnects. */ }
}, 3000);
server.onclose = () => clearInterval(refresh);
