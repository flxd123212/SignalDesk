import { test, expect } from '@playwright/test';
import { clickWorkbench } from './workbench-actions';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.mjs';
import { findExecutable } from '../../server/ai/build.mjs';
import { discoverGcc } from '../../server/gcc.mjs';

test('source toolbar runs real compilation and tests, jumps to errors and exports reports', async ({ page }) => {
  test.setTimeout(150000);
  try { await findExecutable('cmake'); await findExecutable('ctest'); } catch { test.skip(true, 'CMake/CTest are not installed'); return; }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-validation-ui-')), root = path.join(directory, 'Telemetry-Core');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.20)\nproject(TelemetryCore C)\nenable_testing()\nadd_executable(telemetry_tests src/main.c)\nadd_test(NAME adc_conversion COMMAND telemetry_tests)\n');
  const source = `#include <stdio.h>
#include <math.h>

enum { ADC_MAX = 4095 };
static const double reference_voltage = 3.3;

static double adc_to_voltage(unsigned int sample) {
    if (sample > ADC_MAX) sample = ADC_MAX;
    return sample * reference_voltage / ADC_MAX;
}

static int expect_voltage(unsigned int sample, double expected) {
    const double measured = adc_to_voltage(sample);
    const double error = measured - expected;
    printf("ADC=%u, measured=%.4f, expected=%.4f\\n",
           sample, measured, expected);
    return error < -0.001 || error > 0.001;
}

int main(void) {
    int failures = 0;
    failures += expect_voltage(0, 0.0);
    failures += expect_voltage(2048, 1.65);
    failures += expect_voltage(4095, 3.3);
    return failures;
}
`;
  await fs.writeFile(path.join(root, 'src/main.c'), source);
  const runtime = await startServer({ port: 0, autoDemo: false, directory: path.join(directory, 'data', 'sessions'), listPorts: async () => [] });
  const call = async (route: string, data?: object) => { const response = await fetch(`${runtime.address}/api${route}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}); const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; };
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    const plan = await call('/projects/prepare', { root }); await call('/projects/apply', { id: plan.id, targetId: plan.targets[0].id, reuseAI: false });
    await page.goto(runtime.address);
    await clickWorkbench(page, '项目源码');
    await expect(page.locator('.cm-content')).toContainText('adc_to_voltage');
    await page.getByRole('button', { name: '选择并运行测试', exact: true }).click();
    const panel = page.getByRole('region', { name: '源码编译与测试' });
    await expect(panel.getByLabel('测试目标')).toHaveValue('');
    await expect(panel.getByRole('button', { name: '运行选定测试', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: '配置 CMake 工程', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: '配置 CMake 工程', exact: true }).click();
    await expect(panel.locator('.validation-summary')).toContainText('CMake 配置完成', { timeout: 60000 });
    await expect(panel.getByLabel('测试目标')).toHaveValue('ctest');
    await expect(panel.getByRole('button', { name: '编译工程', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '编译当前工程', exact: true }).click();
    await expect(panel.locator('.validation-summary')).toContainText('工程编译通过', { timeout: 60000 });
    await expect(panel.getByRole('button', { name: '运行选定测试', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: '运行选定测试', exact: true }).click();
    await expect(panel.locator('.validation-summary')).toContainText('1/1 个用例通过', { timeout: 20000 });
    await page.screenshot({ path: 'artifacts/ide-validation-passed.png', fullPage: true });
    await fs.writeFile(path.join(root, 'src/main.c'), source.replace('return failures;', 'return missing_result;'));
    await expect(panel.getByRole('button', { name: '编译工程', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '编译当前工程', exact: true }).click();
    await expect(panel.locator('.validation-summary')).toContainText('未通过', { timeout: 60000 });
    await panel.getByRole('button', { name: /^问题 / }).click();
    await expect(panel.locator('.validation-problems')).toContainText('missing_result');
    await panel.locator('.validation-problems > button.error:enabled').first().click();
    await expect(page.getByLabel('跳转源码行')).toHaveValue('25');
    await expect(page.locator('.cm-activeLine')).toContainText('missing_result');
    await page.screenshot({ path: 'artifacts/ide-validation-error.png', fullPage: true });
    const waiting = page.waitForEvent('download'); await panel.getByRole('button', { name: '导出验证报告', exact: true }).click();
    const report = JSON.parse(await fs.readFile((await (await waiting).path())!, 'utf8'));
    expect(report.status).toBe('failed'); expect(report.diagnostics.some((item: { path: string }) => item.path === 'src/main.c')).toBe(true); expect(report.validation.fingerprint).toBeTruthy();
    await panel.getByRole('button', { name: /^记录 / }).click(); await expect(panel.locator('.validation-history > button')).toHaveCount(4);
    await panel.locator('.validation-history > button').nth(1).click(); await expect(panel.locator('.validation-summary')).toContainText('1/1 个用例通过');
    await panel.getByRole('button', { name: '当前任务', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'artifacts/ide-validation-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1500, height: 950 });
    await panel.getByRole('button', { name: '交给 Agent 排查', exact: true }).click();
    await expect(page.getByLabel('Agent 分析请求')).toContainText('missing_result');
    expect((await call('/ai/state')).messages.length).toBe(0);
    const nextSession = await call('/ai/sessions/create', { name: 'Review historical build' });
    expect(nextSession.sessionId).not.toBe(report.sessionId);
    await page.goto(`${runtime.address}/?view=validation`);
    await panel.getByRole('button', { name: /^记录 / }).click();
    await panel.locator('.validation-history > button').first().click();
    const historical = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出验证报告', exact: true }).click();
    const exported = JSON.parse(await fs.readFile((await (await historical).path())!, 'utf8'));
    expect(exported.sessionId).toBe(report.sessionId);
    expect(exported.sessionId).toBe(exported.validation.sessionId);
    expect(errors).toEqual([]);
  } finally { await page.close(); await runtime.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('GCC project settings configure real cross compilation and show ELF target architecture', async ({ page }) => {
  test.setTimeout(90000);
  const compiler = (await discoverGcc()).find((item: { name: string }) => item.name.startsWith('riscv32-unknown-elf-gcc'));
  test.skip(!compiler, 'RISC-V compiler is not installed');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signaldesk-gcc-ui-')), root = path.join(directory, 'CrossCompileCheck');
  await fs.cp('firmware-examples/CrossCompileCheck', root, { recursive: true });
  const runtime = await startServer({ port: 0, autoDemo: false, directory: path.join(directory, 'data', 'sessions'), listPorts: async () => [] });
  const call = async (route: string, data?: object) => { const response = await fetch(`${runtime.address}/api${route}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}); const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; };
  try {
    const plan = await call('/projects/prepare', { root }), target = plan.targets.find((item: { label: string }) => item.label.includes('riscv32'));
    await call('/projects/apply', { id: plan.id, targetId: target.id, reuseAI: false });
    await page.goto(`${runtime.address}?view=editor`);
    await clickWorkbench(page, '展开项目导航');
    await expect(page.locator('.cm-content')).toContainText('adc_to_millivolts');
    await page.getByRole('button', { name: '选择并运行测试', exact: true }).click();
    const panel = page.getByRole('region', { name: '源码编译与测试' });
    await panel.getByRole('button', { name: '设置构建工具', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '工程构建设置' });
    await expect(settings.getByLabel('工程构建工具')).toHaveValue('gcc');
    await expect(settings.getByLabel('CMake 工具链文件')).toHaveValue('cmake/riscv32-unknown-elf.cmake');
    await settings.getByLabel('GCC 交叉编译器路径').fill(compiler!.path);
    await page.screenshot({ path: 'artifacts/ide-gcc-settings.png', fullPage: true });
    await settings.getByRole('button', { name: '保存构建设置', exact: true }).click();
    await expect(settings).toHaveCount(0);
    await panel.getByRole('button', { name: '配置 GCC 工程', exact: true }).click();
    await expect(panel.locator('.validation-summary')).toContainText('GCC 交叉工具链配置完成', { timeout: 45000 });
    await expect(panel.getByRole('button', { name: '编译工程', exact: true })).toBeEnabled();
    await page.keyboard.press('Control+Shift+b');
    await expect(panel.locator('.validation-summary')).toContainText('工程编译通过', { timeout: 45000 });
    await panel.getByRole('button', { name: /^产物 / }).click();
    await expect(panel.locator('.validation-artifacts')).toContainText('RISC-V · 32 bit');
    await expect(panel.locator('.validation-artifacts')).toContainText('compile_check.elf');
    await expect(panel.locator('.validation-artifacts')).not.toContainText('CMakeDetermineCompilerABI');
    await page.keyboard.press('Shift+F8');
    await expect(panel.getByRole('table', { name: '固件容量' })).toContainText('FLASH');
    await expect(panel.getByRole('table', { name: '固件容量' })).toContainText('RAM');
    await expect(panel.getByRole('button', { name: '运行选定测试', exact: true })).toBeDisabled();
    await page.screenshot({ path: 'artifacts/ide-gcc-cross-compile.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await panel.getByRole('button', { name: '设置构建工具', exact: true }).click();
    expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'artifacts/ide-gcc-settings-mobile.png', fullPage: true });
  } finally { await page.close(); await runtime.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
