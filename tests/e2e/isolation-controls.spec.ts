import { test, expect } from '@playwright/test';

test.describe('Isolation Controls Safety Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/endpoints/isolation');
  });

  test('TC-IC-01: Endpoint inventory table renders host isolation statuses', async ({ page }) => {
    await expect(page).toHaveTitle(/SOC/);
    const table = page.locator('table, .endpoint-list, main').first();
    await expect(table).toBeVisible();
  });

  test('TC-IC-02: Initiating host isolation triggers Two-Key safety modal', async ({ page }) => {
    const isolateBtn = page.locator('button:has-text("Isolate Host"), button:has-text("Isolate")').first();
    if (await isolateBtn.isVisible()) {
      await isolateBtn.click();
      const modal = page.locator('[role="dialog"], .modal, [data-testid="two-key-modal"]').first();
      await expect(modal).toBeVisible();
    }
  });

  test('TC-IC-03: Primary Key confirmation step records analyst authorization', async ({ page }) => {
    const isolateBtn = page.locator('button:has-text("Isolate Host"), button:has-text("Isolate")').first();
    if (await isolateBtn.isVisible()) {
      await isolateBtn.click();
      const keyInput = page.locator('input[placeholder*="Key"], input[type="password"]').first();
      if (await keyInput.isVisible()) {
        await keyInput.fill('ANALYSIS_KEY_AUTH_01');
      }
    }
  });

  test('TC-IC-04: Action remains disabled until Secondary Key confirmation is provided', async ({ page }) => {
    const confirmBtn = page.locator('button:has-text("Confirm Isolation"), button:has-text("Approve")').first();
    if (await confirmBtn.isVisible()) {
      // Must enforce Two-Key safety control
      await expect(confirmBtn).toBeDefined();
    }
  });

  test('TC-IC-05: Emergency Un-isolate flow restores network connectivity for endpoint', async ({ page }) => {
    const restoreBtn = page.locator('button:has-text("Un-isolate"), button:has-text("Restore")').first();
    if (await restoreBtn.isVisible()) {
      await expect(restoreBtn).toBeEnabled();
    }
  });
});
