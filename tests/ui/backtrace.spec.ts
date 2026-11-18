import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { startServer } from '../../server/index.mjs';
import { discoverGcc } from '../../server/gcc.mjs';

test('unknown chip is unselected and an offline fault report opens the correct source line', async ({ page }) => {
  const compiler = (await discoverGcc()).find(c => c.family === 'RISC-V' || c.family === 'ARM');
  test.skip(!compiler, 'requires an embedded cross compiler');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sd-trace-ui-'));
  const root = path.join(tmp, 'CrossCompileCheck');
  await fs.cp('firmware-examples/CrossCompileCheck', root, { recursive: true });
  const runtime = await startServer({ port: 0, autoDemo: false, directory: path.join(tmp, 'data', 'sessions'), listPorts: async () => [] });
  try {
    const call = async (route: string, body: object) => {
      const res = await page.request.post(runtime.address + '/api' + route, { data: body });
      expect(res.ok(), await res.text()).toBeTruthy(); return res.json();
    };
    await page.goto(runtime.address + '/?view=chips');
    const family = page.getByLabel('烧录芯片系列');
    await expect(family.locator('option').nth(1)).toBeAttached();
    await expect(family).toHaveValue('');
    const run = promisify(execFile);
    const options = {cwd: root, windowsHide: true, env: { ...process.env, PATH: path.dirname(compiler.path) + path.delimiter + process.env.PATH }};
    await run(compiler.path, ['-gdwarf-2','-ffreestanding','-nostdlib','-Wl,-e,probe','-T','probe.ld','src/probe.c','-o','fault.elf'], options);
    const { stdout } = await run(compiler.path.replace(/gcc(\.exe)?$/i,'nm$1'), ['-n','fault.elf'], options);
    const address = /^([\da-f]+) T probe\s*$/im.exec(stdout)![1];
    const plan = await call('/projects/prepare', { root });
    await call('/projects/apply', { id: plan.id, targetId: plan.targets[0].id, reuseAI: false });
    await page.goto(runtime.address + '/?view=terminal');
    await expect(page.locator('#signaldesk-startup')).toBeHidden();
    await page.getByRole('button', {name:'崩溃回溯 (F9)'}).click();
    const dialog = page.getByRole('dialog', {name:'崩溃回溯'});
    await expect(dialog.getByLabel('调试固件')).toHaveValue('fault.elf');
    const paste = dialog.getByLabel('异常日志');
    await paste.fill(`PC: 0x${address}\nELF file SHA256: 0000000000`);
    await dialog.getByRole('button', {name:'解析地址'}).click();
    await expect(dialog.getByRole('alert')).toContainText('指纹与所选文件不一致');
    await paste.fill(`PC: 0x${address}`);
    await dialog.getByRole('button', {name:'解析地址'}).click();
    await expect(dialog.getByRole('region', {name:'调用栈'})).toContainText('probe');
    await dialog.getByRole('button', {name:/src\/probe.c:\d+/}).click();
    await expect(page).toHaveURL(/view=editor/);
    await expect(page.locator('.cm-activeLine')).toHaveText(/\{|void probe/);
    await page.keyboard.press('F9'); await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  } finally {
    await page.close(); await runtime.close(); await fs.rm(tmp, {recursive:true, force:true, maxRetries:5, retryDelay:100});
  }
});
