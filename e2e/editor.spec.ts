import { expect, test, type Page } from '@playwright/test';

/** Taps on touch projects, clicks otherwise. */
async function press(page: Page, selector: string) {
  const touch = test.info().project.use.hasTouch;
  if (touch) await page.locator(selector).first().tap();
  else await page.locator(selector).first().click();
}

async function createProject(page: Page, name: string) {
  await page.goto('/');
  await press(page, '.hero button:has-text("Create Project")');
  const dialog = page.getByRole('dialog', { name: 'Create a new project' });
  await expect(dialog).toBeVisible();
  // Empty Baseplate is the default template.
  await expect(dialog.getByRole('radio', { name: /Empty Baseplate/ })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByLabel('Project name').fill(name);
  await press(page, '.dialog-actions button:has-text("Create project")');
  await expect(page.getByTestId('editor-workspace')).toBeVisible();
  await expect(page.locator('canvas.zino-viewport-canvas')).toBeVisible();
}

async function openObjectsPanelIfCompact(page: Page) {
  await expect(page.getByTestId('editor-workspace')).toBeVisible();
  await expect(page.locator('.toolbar')).toBeVisible();
  const tree = page.getByRole('tree', { name: 'Scene objects' });
  if (!(await tree.isVisible())) await press(page, '.toolbar button[aria-label="Objects"]');
  await expect(tree).toBeVisible();
}

/** On compact (portrait) layouts only one side drawer is open at a time. */
async function openInspectorIfCompact(page: Page) {
  await expect(page.getByTestId('editor-workspace')).toBeVisible();
  const inspector = page.getByTestId('object-inspector');
  if (!(await inspector.isVisible())) await press(page, '.toolbar button[aria-label="Inspector"]');
  await expect(inspector).toBeVisible();
}

test.describe('ZinoGame Studio editor', () => {
  test('creates a baseplate project, edits it, and reopens it after a reload', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await createProject(page, 'E2E World');

    await openObjectsPanelIfCompact(page);
    for (const name of ['Baseplate', 'Camera', 'Sun', 'Player Spawn']) {
      await expect(page.getByTestId(`tree-row-${name}`)).toBeVisible();
    }

    // Add a cube from the toolbar.
    await press(page, '.toolbar button:has-text("Add")');
    await press(page, '[role="menuitem"]:has-text("Cube")');
    await openObjectsPanelIfCompact(page);
    await expect(page.getByTestId('tree-row-Cube')).toHaveAttribute('aria-selected', 'true');

    // Rename through the inspector.
    await openInspectorIfCompact(page);
    const inspector = page.getByTestId('object-inspector');
    const name = inspector.getByLabel('Object name');
    await name.fill('Hero Block');
    await name.press('Enter');
    await openObjectsPanelIfCompact(page);
    await expect(page.getByTestId('tree-row-Hero Block')).toBeVisible();

    // Undo and redo the rename from the toolbar.
    await press(page, '.toolbar button[aria-label="Undo"]');
    await expect(page.getByTestId('tree-row-Cube')).toBeVisible();
    await press(page, '.toolbar button[aria-label="Redo"]');
    await expect(page.getByTestId('tree-row-Hero Block')).toBeVisible();

    // Autosave, then reload and reopen.
    await expect(page.getByTestId('save-status')).toContainText('Saved', { timeout: 20_000 });
    await page.reload();
    await press(page, 'button[aria-label="Open E2E World"]');
    await openObjectsPanelIfCompact(page);
    await expect(page.getByTestId('tree-row-Hero Block')).toBeVisible();
    await expect(page.getByTestId('tree-row-Baseplate')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('changes baseplate size and grid from the inspector', async ({ page }) => {
    await createProject(page, 'Baseplate Test');
    await openObjectsPanelIfCompact(page);
    await press(page, '[data-testid="tree-row-Baseplate"]');
    await openInspectorIfCompact(page);
    const inspector = page.getByTestId('object-inspector');
    await expect(inspector.getByRole('group', { name: 'Baseplate size presets' })).toBeVisible();
    await expect(inspector.getByRole('button', { name: '512', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await inspector.getByRole('button', { name: '128', exact: true }).click();
    await expect(inspector.getByLabel('Baseplate width')).toHaveValue('128');
    await inspector.getByRole('switch', { name: 'Show editor grid' }).uncheck({ force: true });
    await expect(inspector.getByRole('switch', { name: 'Show editor grid' })).not.toBeChecked();
  });

  test('plays the scene and returns to the editor unchanged', async ({ page }) => {
    await createProject(page, 'Play Test');
    await openObjectsPanelIfCompact(page);
    const before = await page.getByRole('tree', { name: 'Scene objects' }).innerText();
    await press(page, '[data-testid="play-button"]');
    await expect(page.getByTestId('play-overlay')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.score-pill')).toContainText('Score: 0');
    await page.waitForTimeout(1000);
    await press(page, '[data-testid="stop-button"]');
    await expect(page.getByTestId('play-overlay')).toBeHidden();
    await openObjectsPanelIfCompact(page);
    expect(await page.getByRole('tree', { name: 'Scene objects' }).innerText()).toBe(before);
  });

  test('selects an object by tapping it in the 3D viewport', async ({ page }) => {
    await createProject(page, 'Pick Test');
    await press(page, '.toolbar button:has-text("Add")');
    await press(page, '[role="menuitem"]:has-text("Cube")');
    await page.keyboard.press('Escape');
    const canvas = page.locator('canvas.zino-viewport-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not visible');
    // The editor camera looks at (0, 1, 0); the new cube sits just below that point.
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2 + Math.max(12, box.height * 0.03);
    if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await openObjectsPanelIfCompact(page);
    await expect(page.getByTestId('tree-row-Cube')).toHaveAttribute('aria-selected', 'true');
  });

  test('opens the block script editor with a code preview', async ({ page }) => {
    await page.goto('/');
    await press(page, 'button:has-text("Coin Collector")');
    await expect(page.getByTestId('editor-workspace')).toBeVisible();
    const nav = page.locator('nav:visible').getByRole('button', { name: 'Scripts' });
    await nav.first().click();
    await expect(page.getByTestId('block-editor')).toBeVisible();
    await expect(page.locator('.blocklySvg').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Code generated from the blocks')).toContainText('on collision');
    await expect(page.getByText('Ready to run')).toBeVisible();
  });
});
