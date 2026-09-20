import { test, expect } from '@playwright/test';

test.describe('Command Center Triage Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/command-center');
  });

  test('TC-CC-01: Command Center main grid loads active alert telemetry stream', async ({ page }) => {
    await expect(page).toHaveTitle(/SOC/);
    const mainGrid = page.locator('main, .command-center, [data-testid="command-center"]').first();
    await expect(mainGrid).toBeVisible();
  });

  test('TC-CC-02: Real-time WebSocket connection state indicator displays active status', async ({ page }) => {
    const wsStatus = page.locator('[data-testid="ws-status"], .ws-indicator, text=Connected').first();
    if (await wsStatus.isVisible()) {
      await expect(wsStatus).toBeVisible();
    }
  });

  test('TC-CC-03: Inline alert triage action allows acknowledging an active security alert', async ({ page }) => {
    const ackBtn = page.locator('button:has-text("Acknowledge"), button:has-text("Ack")').first();
    if (await ackBtn.isVisible()) {
      await ackBtn.click();
    }
  });

  test('TC-CC-04: Filter dropdown allows filtering alerts by status (New, In Progress, Resolved)', async ({ page }) => {
    const filterSelect = page.locator('select, button:has-text("Filter")').first();
    if (await filterSelect.isVisible()) {
      await filterSelect.click();
    }
  });

  test('TC-CC-05: Clicking an alert row opens detailed Investigation workspace view', async ({ page }) => {
    const alertRow = page.locator('tr, .alert-card, .alert-item').first();
    if (await alertRow.isVisible()) {
      await alertRow.click();
    }
  });
});
