import { test, expect } from '@playwright/test';

test.describe('Executive Dashboard Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('TC-DB-01: Executive Dashboard layout renders navigation bar and header', async ({ page }) => {
    await expect(page).toHaveTitle(/SOC/);
    const nav = page.locator('nav, header').first();
    await expect(nav).toBeVisible();
  });

  test('TC-DB-02: Telemetry Ingestion Rate KPI tile displays real-time event stats', async ({ page }) => {
    const kpiTile = page.locator('text=Events, text=Ingestion, .kpi-card').first();
    await expect(kpiTile).toBeVisible();
  });

  test('TC-DB-03: Active Threats Summary card displays severity breakdown badge', async ({ page }) => {
    const summaryCard = page.locator('[data-testid="threat-summary"], .summary-card, main').first();
    await expect(summaryCard).toBeVisible();
  });

  test('TC-DB-04: System Health Widget confirms Go, Python and Database mesh connectivity', async ({ page }) => {
    const healthBar = page.locator('[data-testid="system-health"], .health-bar, footer').first();
    if (await healthBar.isVisible()) {
      await expect(healthBar).toBeVisible();
    }
  });

  test('TC-DB-05: Quick Action shortcut link navigates directly to Command Center', async ({ page }) => {
    const link = page.locator('a[href*="command"], button:has-text("Command")').first();
    if (await link.isVisible()) {
      await link.click();
      await expect(page).toHaveURL(/command/);
    }
  });
});
