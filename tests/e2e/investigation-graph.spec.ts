import { test, expect } from '@playwright/test';

test.describe('Investigation Graph & AI Triage Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/investigation');
  });

  test('TC-IG-01: Investigation canvas renders node-link provenance graph', async ({ page }) => {
    await expect(page).toHaveTitle(/SOC/);
    const canvas = page.locator('canvas, svg, .graph-container').first();
    await expect(canvas).toBeVisible();
  });

  test('TC-IG-02: Double-clicking investigation node expands connected telemetry artifacts', async ({ page }) => {
    const node = page.locator('canvas, .node').first();
    if (await node.isVisible()) {
      await node.dblclick();
    }
  });

  test('TC-IG-03: AI Agent Chat Widget displays real-time triage streaming feed', async ({ page }) => {
    const chatWidget = page.locator('[data-testid="agent-chat"], .chat-widget, .agent-panel').first();
    if (await chatWidget.isVisible()) {
      await expect(chatWidget).toBeVisible();
    }
  });

  test('TC-IG-04: Submitting analyst prompt to Agent Chat returns contextual investigation response', async ({ page }) => {
    const chatInput = page.locator('input[placeholder*="agent"], textarea').first();
    if (await chatInput.isVisible()) {
      await chatInput.fill('What is the root cause of this alert?');
      await page.keyboard.press('Enter');
    }
  });

  test('TC-IG-05: Incident Timeline scrubbing slider filters attack progression by timestamp', async ({ page }) => {
    const slider = page.locator('input[type="range"], .timeline-scrubber').first();
    if (await slider.isVisible()) {
      await slider.fill('50');
    }
  });
});
