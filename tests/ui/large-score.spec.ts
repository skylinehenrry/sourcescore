import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { orchestralFixture } from '../../scripts/fixtures';

test('20-part 1,000-measure score opens, navigates to its final measure and edits a mapped note', async ({ page }) => {
  test.setTimeout(120000);
  mkdirSync('work', { recursive: true });
  writeFileSync('work/ui-large-orchestra.musicxml', orchestralFixture(1000, 20));
  await page.goto('/'); await page.getByTestId('file-input').setInputFiles('work/ui-large-orchestra.musicxml');
  await expect(page.locator('[data-note-id="0:0:0"]')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.score-facts')).toContainText('1,000 measures');
  await page.getByLabel('Go to measure').fill('1000'); await page.getByRole('button', { name: 'Go', exact: true }).click();
  const final = page.locator('[data-note-id="0:999:0"]');
  await expect(final).toHaveAttribute('aria-pressed', 'true', { timeout: 60000 });
  await expect(final).toBeInViewport({ timeout: 30000 });
  await page.getByRole('button', { name: 'Natural', exact: true }).click();
  await expect(page.getByTestId('selected-pitch')).toHaveText('F5', { timeout: 60000 });
  await expect(page.locator('.render-error')).toHaveCount(0);
});
