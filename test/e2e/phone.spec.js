// The page on a phone (a Pixel 7, with touch): nothing spills off the screen, the keys are there to tap,
// and the story's Studio chapter fits the width.
import { test, expect } from '@playwright/test';
import { play, storyAt, watchErrors } from './helpers.js';

let errors;
test.beforeEach(({ page }) => { errors = watchErrors(page); });
test.afterEach(() => { expect(errors).toEqual([]); });

test('the playground fits the screen, with keys to tap', async ({ page }) => {
    await play(page);
    const fit = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        // a field under 16px makes phone browsers zoom in when it is tapped
        typeSize: parseFloat(getComputedStyle(document.querySelector('#type')).fontSize)
    }));
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.typeSize).toBeGreaterThanOrEqual(16);
    const keys = page.locator('#keys .key');
    await expect(keys.first()).toBeVisible();
    await keys.nth(2).tap();
    for (const b of ['#b-adventure', '#b-studio']) await expect(page.locator(b)).toBeInViewport();
});

test('the story keeps the keys away until a chapter is played on them', async ({ page }) => {
    await storyAt(page, 1, 'The Name');
    await expect(page.locator('#keys')).toBeHidden();
    await expect(page.locator('#story')).toBeInViewport();
});

test('the factory: sixteen steps a row, all on screen, tapped', async ({ page }) => {
    await storyAt(page, 6, 'The Factory');
    const width = page.viewportSize().width;
    const cells = page.locator('#stu-drums .stu-cell[data-track="kick"]');
    await expect(cells).toHaveCount(16);
    for (const i of [0, 15]) {
        const box = await cells.nth(i).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    for (const i of [0, 4, 8, 12]) await cells.nth(i).tap();
    await expect(page.locator('#stu-drums .stu-trow[data-track="kick"]')).toHaveClass(/right/);
});
