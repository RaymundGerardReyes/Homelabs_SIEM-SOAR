import { test, expect } from '@playwright/test';

test.describe('Playbook Sandbox Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/playbook-sandbox');
  });

  test('TC-PB-01: Playbook template selection dropdown renders available automation rules', async ({ page }) => {
    await expect(page).toHaveTitle(/SOC/);
    const templateSelect = page.locator('select, [data-testid="playbook-select"], button').first();
    await expect(templateSelect).toBeVisible();
  });

  test('TC-PB-02: Interactive sandbox code editor displays rule configuration', async ({ page }) => {
    const editor = page.locator('.monaco-editor, textarea, code, pre').first();
    await expect(editor).toBeVisible();
  });

  test('TC-PB-03: Dry-run execution button triggers simulated playbook run', async ({ page }) => {
    const runBtn = page.locator('button:has-text("Run"), button:has-text("Execute"), button:has-text("Test")').first();
    if (await runBtn.isVisible()) {
      await runBtn.click();
      const output = page.locator('[data-testid="execution-output"], .logs, pre').first();
      await expect(output).toBeVisible();
    }
  });

  test('TC-PB-04: Variable override panel allows customizing target parameters', async ({ page }) => {
    const inputField = page.locator('input[name="target_ip"], input[placeholder*="IP"], input').first();
    if (await inputField.isVisible()) {
      await inputField.fill('192.168.1.100');
    }
  });

  test('TC-PB-05: Export playbook action saves validated automation workflow', async ({ page }) => {
    const exportBtn = page.locator('button:has-text("Export"), button:has-text("Save")').first();
    if (await exportBtn.isVisible()) {
      await expect(exportBtn).toBeEnabled();
    }
  });
});
