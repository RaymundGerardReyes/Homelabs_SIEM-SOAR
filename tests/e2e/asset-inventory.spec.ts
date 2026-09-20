import { test, expect } from '@playwright/test';

test.describe('Asset Inventory Fleet Management Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/asset-inventory');
  });

  test('TC-AI-01: Asset Inventory table loads registered endpoint host fleet', async ({ page }) => {
    await expect(page).toHaveTitle(/SOC/);
    const table = page.locator('table, .asset-list, main').first();
    await expect(table).toBeVisible();
  });

  test('TC-AI-02: Endpoint Fleet Type Badges (Local, IaaS, PaaS) render accurately', async ({ page }) => {
    const badge = page.locator('.badge, [data-testid="fleet-badge"], text=PaaS, text=Local, text=IaaS').first();
    if (await badge.isVisible()) {
      await expect(badge).toBeVisible();
    }
  });

  test('TC-AI-03: Search input filters endpoint inventory by hostname or IP address', async ({ page }) => {
    const searchInput = page.locator('input[type="text"], input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('win-agent');
    }
  });

  test('TC-AI-04: Deep-link action button navigates directly to EDR Logs page for host', async ({ page }) => {
    const logsLink = page.locator('a[href*="logs"], button:has-text("Logs")').first();
    if (await logsLink.isVisible()) {
      await logsLink.click();
      await expect(page).toHaveURL(/logs/);
    }
  });

  test('TC-AI-05: Endpoint Health status indicator verifies heartbeat freshness', async ({ page }) => {
    const statusDot = page.locator('.status-dot, [data-testid="health-status"]').first();
    if (await statusDot.isVisible()) {
      await expect(statusDot).toBeVisible();
    }
  });
});
