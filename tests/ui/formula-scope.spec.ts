import { expect, test } from '@playwright/test';

test('formula drafts survive device switches independently of the running formula', async ({ request, page }) => {
  const first = (await (await request.get('/api/state')).json()).activeDevice;
  const added: string[] = [];
  const add = async (name: string) => {
    const response = await request.post('/api/devices/add', { data: { name } });
    expect(response.ok()).toBeTruthy();
    const id = (await response.json()).activeDevice; added.push(id); return id;
  };
  try {
    const a = await add('Formula A');
    await request.post('/api/processing', { data: { deviceId: a, mode: 'script', script: 'volts = ch1 * 2' } });
    await page.goto('/?view=script');
    await expect(page.locator('#signaldesk-startup')).toBeHidden();
    const editor = page.locator('.script-body .cm-content');
    const replace = async (text: string) => {
      await editor.click(); await editor.press('Control+a'); await page.keyboard.insertText(text);
      await expect(editor).toHaveText(text);
    };
    await expect(editor).toContainText('volts = ch1 * 2');
    await replace('volts = ch1 * 3');
    const b = await add('Formula B');
    await expect(editor).toContainText('reference = ch3');
    await replace('current = ch1 * 5');
    await page.getByRole('button', { name: '应用公式' }).click();
    await expect(page.getByRole('button', { name: '已应用' })).toBeVisible();
    const result = await request.get('/api/processing/script', { params: { deviceId: b } });
    expect((await result.json()).script).toBe('current = ch1 * 5');
    await request.post('/api/devices/select', { data: { id: a } });
    await page.reload(); await expect(editor).toContainText('volts = ch1 * 3');
    const active = await request.get('/api/processing/script', { params: { deviceId: a } });
    expect((await active.json()).script).toBe('volts = ch1 * 2');
  } finally {
    await request.post('/api/devices/select', { data: { id: first } });
    for (const id of added) await request.post('/api/devices/remove', { data: { id } });
  }
});
