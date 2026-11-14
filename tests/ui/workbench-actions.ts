import type { Page } from '@playwright/test';

const views: Record<string, string> = { '精简模式': '精简模式', '完整模式': '完整模式', '收起连接设置': '连接设置', '展开连接设置': '连接设置', '展开 Agent 分栏': 'Agent 分栏', '打开底部工具面板': '底部输出面板', '展开项目导航': '项目侧栏' };
export async function clickWorkbench(page: Page, name: string) {
  const direct = page.getByRole('button', { name, exact: true });
  if (await direct.isVisible()) { await direct.click(); return; }
  const menu = page.getByRole('button', { name: views[name] ? '视图' : '工具', exact: true });
  await (await menu.isVisible() ? menu : page.getByRole('button', { name: '工作区菜单', exact: true })).click();
  await page.getByRole('menuitem', { name: views[name] || name, exact: true }).last().click();
}
