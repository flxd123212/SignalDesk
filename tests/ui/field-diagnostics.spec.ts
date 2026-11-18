import { test, expect } from '@playwright/test';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.mjs';
import { clickWorkbench } from './workbench-actions';

test('operator tunes a TCP device, runs a repeated bench recipe, then inspects the disconnect', async ({
  page,
}) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-field-ui-'));
  let peer: net.Socket | undefined,
    setting = 0;
  const peripheral = net.createServer((s) => {
    peer = s;
    let buffer = '';
    s.on('data', (bytes) => {
      buffer += bytes;
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith('SET ')) setting = Number(line.slice(4));
        if (line === 'GET') s.write(JSON.stringify({ temp: setting }) + '\n');
        if (line === 'PING') s.write('ACK\n');
      }
    });
  });
  await new Promise<void>((resolve) => peripheral.listen(0, '127.0.0.1', resolve));
  const runtime = await startServer({
    port: 0,
    directory: path.join(dir, 'sessions'),
    listPorts: async () => [],
  });
  try {
    const state = runtime.engine.state(),
      deviceId = state.activeDevice,
      port = (peripheral.address() as net.AddressInfo).port;
    const cfg = { ...state.config, path: `tcp://127.0.0.1:${port}`, protocol: 'firewater' };
    await runtime.engine.connect(cfg);
    const response = await page.request.post(runtime.address + '/api/alarms/config', {
      data: {
        deviceId,
        rules: [
          {
            id: 'lost',
            name: '掉线',
            kind: 'connection',
            enabled: true,
            channel: 0,
            holdMs: 0,
            cooldownMs: 500,
            timeoutMs: 1000,
          },
        ],
      },
    });
    expect(response.ok()).toBeTruthy();
    await page.goto(runtime.address);
    await clickWorkbench(page, '工程实验工具…');
    const lab = page.getByRole('dialog', { name: '工程实验工具' });
    await lab.getByLabel('实验工具', { exact: true }).selectOption('tuning');
    await lab.getByLabel('写命令', { exact: true }).fill('SET {value}');
    await lab.getByLabel('读回命令（可选）').fill('GET');
    await lab.getByLabel('回报字段路径').fill('temp');
    await lab.getByLabel('设定值').fill('45');
    await lab.getByRole('button', { name: '写入并读回' }).click();
    await expect(lab).toContainText('读回一致');
    expect(setting).toBe(45);
    await lab.getByLabel('实验工具', { exact: true }).selectOption('bench');
    await lab.getByText('自定义台架步骤', { exact: true }).click();
    await lab.getByLabel('台架测试序列').fill(
      JSON.stringify([
        { type: 'send', text: 'PING' },
        { type: 'expect', text: 'ACK' },
      ]),
    );
    await lab.getByText('长时间稳定性测试', { exact: true }).click();
    await lab.getByRole('spinbutton', { name: '循环次数', exact: true }).fill('2');
    await lab.getByRole('button', { name: '循环执行台架步骤' }).click();
    await expect(lab).toContainText('成功 2 / 失败 0');
    await lab.getByRole('button', { name: '关闭实验工具' }).click();
    peer!.write('4.2\n');
    await expect.poll(() => runtime.engine.active.latest[0]).toBe(4.2);
    peer!.destroy();
    await expect.poll(() => runtime.engine.active.connected).toBeFalsy();
    await runtime.engine.connect(cfg);
    await page.getByRole('button', { name: '查看报警', exact: true }).click();
    await page.getByRole('button', { name: '查看现场', exact: true }).first().click();
    const incident = page.getByRole('dialog', { name: '故障现场' });
    await expect(incident).toContainText('PING');
    await expect(incident).toContainText('4.2');
    await expect(incident).not.toContainText('重新连接 未记录');
  } finally {
    await page.close();
    await runtime.close();
    peer?.destroy();
    await new Promise<void>((resolve) => peripheral.close(() => resolve()));
    await fs.rm(dir, { force: true, recursive: true, maxRetries: 5 });
  }
});
