import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseScore, changedEvents } from '../../src/core/model';
import { ScoreDocument } from '../../src/core/editor';

const fixture = path.resolve('fixtures/orchestral-study.musicxml');
async function openExample(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Open orchestral example' }).click();
  await expect(page.locator('[data-note-id="0:0:0"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('note-overlay')).toHaveAttribute('aria-busy', 'false');
}
async function download(page: Page) {
  const result = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click();
  const saved = await result; return readFileSync((await saved.path())!, 'utf8');
}
test('engraved notes select, change pitch, keep identity after rerender, undo and redo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await openExample(page); await page.locator('[data-note-id="0:0:0"]').click();
  await expect(page.getByTestId('selected-pitch')).toHaveText('F♯5');
  await page.getByRole('button', { name: 'Natural', exact: true }).click();
  await expect(page.getByTestId('selected-pitch')).toHaveText('F5');
  await expect(page.locator('[data-note-id="0:0:0"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Undo (⌘Z)' }).click(); await expect(page.getByTestId('selected-pitch')).toHaveText('F♯5');
  await page.getByRole('button', { name: 'Redo (⇧⌘Z)' }).click(); await expect(page.getByTestId('selected-pitch')).toHaveText('F5');
  await expect(page.getByTestId('note-overlay')).toHaveAttribute('aria-busy', 'false');
  mkdirSync('work/screenshots', { recursive: true }); await page.screenshot({ path: 'work/screenshots/editor.png' });
  expect(errors).toEqual([]);
});
test('no-op download is byte-identical; an intentional pitch edit changes exactly one event', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('file-input').setInputFiles(fixture);
  await expect(page.locator('[data-note-id="0:0:0"]')).toBeVisible({ timeout: 30000 });
  const original = readFileSync(fixture, 'utf8'); expect(await download(page)).toBe(original);
  await page.locator('[data-note-id="0:0:0"]').click(); await page.getByRole('button', { name: 'Natural', exact: true }).click();
  await expect(page.getByTestId('selected-pitch')).toHaveText('F5');
  const output = await download(page), expected = new ScoreDocument(original); expected.setAccidental(['0:0:0'], 0);
  expect(output).toBe(expected.source); expect(changedEvents(parseScore(original), parseScore(output))).toEqual(['0:0:0']);
});
test('chord noteheads map independently, keyboard editing and multi-selection work', async ({ page }) => {
  await openExample(page); await page.locator('[data-note-id="3:0:1"]').click(); await expect(page.getByTestId('selected-pitch')).toHaveText('A4');
  await page.keyboard.press('ArrowDown'); await expect(page.getByTestId('selected-pitch')).toHaveText('G4');
  await expect(page.getByTestId('note-overlay')).toHaveAttribute('aria-busy', 'false');
  await page.locator('[data-note-id="3:0:2"]').click({ modifiers: ['Meta'] });
  await expect(page.locator('.note-hit.selected')).toHaveCount(2); await page.keyboard.press('Shift+ArrowUp');
  await expect(page.getByTestId('selected-pitch')).toHaveText('C6');
  const output = await download(page); expect(changedEvents(parseScore(readFileSync(fixture, 'utf8')), parseScore(output))).toEqual(['3:0:1', '3:0:2']);
});
test('duration workflow is explicit and keeps the measure balanced', async ({ page }) => {
  await openExample(page); await page.locator('[data-note-id="0:0:0"]').click(); await page.getByRole('button', { name: 'eighth note (4)' }).click();
  await expect(page.getByRole('dialog')).toContainText('following rest'); await page.getByRole('button', { name: 'Apply duration change' }).click();
  await expect(page.getByLabel('Duration', { exact: true })).toHaveValue('eighth');
  const model = parseScore(await download(page)); expect(model.notes.get('0:0:0')?.duration.toString()).toBe('1/2'); expect(model.diagnostics).toEqual([]);
});
test('vertical dragging edits an individual note with a preserved source identity', async ({ page }) => {
  await openExample(page); const target = page.locator('[data-note-id="0:0:0"]'), box = await target.boundingBox(); expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 9, { steps: 6 }); await page.mouse.up();
  await expect(page.getByTestId('selected-pitch')).toHaveText('A5');
  const output = await download(page); expect(changedEvents(parseScore(readFileSync(fixture, 'utf8')), parseScore(output))).toEqual(['0:0:0']);
});
test('diagnostics navigate to an incomplete measure and highlight the affected staff', async ({ page }) => {
  const source = readFileSync(fixture, 'utf8').replace('<duration>48</duration><voice>1</voice><type>quarter</type>', '<duration>24</duration><voice>1</voice><type>eighth</type>');
  await page.goto('/'); await page.getByTestId('file-input').setInputFiles({ name: 'incomplete.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  await expect(page.locator('.diagnostic-row')).toContainText('The staff ends before'); await page.locator('.diagnostic-row').click();
  await expect(page.getByTestId('selected-pitch')).toHaveText('F♯5'); await expect(page.locator('[data-note-id="0:0:0"]')).toHaveClass(/issue/);
});
test('measure and instrument navigation, zoom, diagnostics and invalid input handling', async ({ page }) => {
  await openExample(page); await page.getByLabel('Go to measure').fill('11'); await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.locator('[data-note-id="0:10:0"]')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Show Piano only', exact: true }).click();
  await expect(page.locator('[data-note-id="3:10:0"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-note-id="0:10:0"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zoom in' }).click(); await expect(page.locator('.zoom-label')).toHaveText('100%');
  await page.getByRole('button', { name: /^Diagnostics/ }).click(); await expect(page.locator('.panel-clear')).toContainText('No timing');
  await page.getByTestId('file-input').setInputFiles({ name: 'corrupt.xml', mimeType: 'text/xml', buffer: Buffer.from('<score-partwise><part></score-partwise>') });
  await expect(page.getByRole('dialog')).toContainText('XML syntax error'); await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.locator('.score-heading')).toContainText('Orchestral editing study');
});
const real = path.resolve('fixtures/local/rachmaninoff-variation18.musicxml');
test('private Rachmaninoff score renders with individual notes and navigates to its last passage', async ({ page }) => {
  test.skip(!existsSync(real), 'Private fixture is not present on this machine.');
  await page.goto('/'); await page.getByTestId('file-input').setInputFiles(real);
  await expect(page.locator('.note-hit').first()).toBeVisible({ timeout: 45000 });
  await expect(page.getByTestId('note-overlay')).toHaveAttribute('aria-busy', 'false', { timeout: 45000 });
  const model = parseScore(readFileSync(real, 'utf8'));
  await page.getByLabel('Go to measure').fill(String(model.measures)); await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.locator(`[data-note-id^="0:${model.measures - 1}:"]`).first()).toBeAttached({ timeout: 45000 });
  await expect(page.locator('.render-error')).toHaveCount(0);
});
