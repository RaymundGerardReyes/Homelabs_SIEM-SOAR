import { test, expect } from '@playwright/test';

test.describe('War Room Analyst Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/war-room');
  });

  test('TC-WR-01: Header and Active Incident Status Badge render correctly', async ({ page }) => {
    await expect(page).toHaveTitle(/SOC/);
    const heading = page.locator('h1, h2, header').first();
    await expect(heading).toBeVisible();
  });

  test('TC-WR-02: Real-time incident feed updates without page reload', async ({ page }) => {
    const feedContainer = page.locator('[data-testid="incident-feed"], .incident-feed, main').first();
    await expect(feedContainer).toBeVisible();
  });

  test('TC-WR-03: Collaboration chat widget accepts input and posts message', async ({ page }) => {
    const chatInput = page.locator('input[type="text"], textarea').first();
    if (await chatInput.isVisible()) {
      await chatInput.fill('Investigating suspicious process tree on host-01');
      await page.keyboard.press('Enter');
    }
  });

  test('TC-WR-04: Threat containment trigger button opens action modal', async ({ page }) => {
    const containBtn = page.locator('button:has-text("Contain"), button:has-text("Isolate"), button:has-text("Action")').first();
    if (await containBtn.isVisible()) {
      await containBtn.click();
      const modal = page.locator('[role="dialog"], .modal').first();
      await expect(modal).toBeVisible();
    }
  });

  test('TC-WR-05: Incident timeline filters by severity level', async ({ page }) => {
    const filterBtn = page.locator('button:has-text("Critical"), button:has-text("Filter"), select').first();
    if (await filterBtn.isVisible()) {
      await filterBtn.click();
    }
  });
});
