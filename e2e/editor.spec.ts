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

/** A minimal valid GLB (one triangle). */
function triangleGlb(): Buffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]);
  const bin = Buffer.from(positions.buffer);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Tri' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 0] }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]);
}

test.describe('Assets', () => {
  test('imports a GLB model, places it, and keeps it after a reload', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'asset import flow is covered once');
    await createProject(page, 'Asset World');
    await page.locator('nav:visible').getByRole('button', { name: 'Assets' }).first().click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import files' }).first().click();
    await (await chooser).setFiles({ name: 'Robot.glb', mimeType: 'model/gltf-binary', buffer: triangleGlb() });
    const card = page.getByRole('article', { name: 'Robot' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('1 tris');
    await card.getByRole('button', { name: 'Add to scene' }).click();
    await expect(page.getByTestId('tree-row-Robot')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('Saved', { timeout: 20_000 });

    await page.reload();
    await page.getByRole('button', { name: 'Open Asset World' }).click();
    await expect(page.getByTestId('tree-row-Robot')).toBeVisible();
    await page.locator('nav:visible').getByRole('button', { name: 'Assets' }).first().click();
    await expect(page.getByRole('article', { name: 'Robot' })).toBeVisible();
  });

  test('explains unsupported files instead of failing silently', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'covered once');
    await createProject(page, 'Bad Files');
    await page.locator('nav:visible').getByRole('button', { name: 'Assets' }).first().click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import files' }).first().click();
    await (await chooser).setFiles({ name: 'car.fbx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a model') });
    await expect(page.getByText('Could not import car.fbx')).toBeVisible();
    await expect(page.getByText(/Export your model as .glb/)).toBeVisible();
  });
});
