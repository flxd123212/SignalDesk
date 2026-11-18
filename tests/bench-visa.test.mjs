import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { adapter } from '../server/bench.mjs';
import { program } from '../server/engineering.mjs';

test('PyVISA TCP socket reads identity, voltage and rejects overrange', async (t) => {
  try {
    execFileSync(await program('python'), ['-I', '-c', 'import pyvisa, pyvisa_py'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    t.skip('optional PyVISA backend unavailable');
    return;
  }
  let value = '1.502';
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      socket.write((chunk.toString().trim() === '*IDN?' ? 'SignalDesk,loopback,test,1' : value) + '\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const opts = { backend: '@py', resource: `TCPIP0::127.0.0.1::${server.address().port}::SOCKET` },
    rows = [];
  await adapter('visa.identify', opts, (r) => rows.push(r));
  assert.match(rows[0][1], /loopback/);
  await adapter('visa.measure', opts, (r) => rows.push(r));
  assert.equal(rows[1][1], 1.502);
  value = '9.99e37';
  await assert.rejects(
    adapter('visa.measure', opts, () => {}),
    /过量程/,
  );
});
