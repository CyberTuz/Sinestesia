// Shared steps for the browser tests: open the page, press Play, start the story at a chapter,
// and read what the page shows. The page's own modules can be imported inside page.evaluate:
// they are the same instances the page runs.
import { expect } from '@playwright/test';

// the facts a story continued at a later chapter starts from
export const FACTS = { name: 'Lumen', bpm: 120, note: 'A', freq: 9.7, rhythm: true };

// every test fails on an error in the page
export function watchErrors(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    return errors;
}

// the page with Play pressed; `story` saved progress (a chapter number and facts), or none for a fresh start
export async function play(page, { story = null, memory = null } = {}) {
    await page.addInitScript(([save, mem]) => {
        // the first-visit tips stay out of the way
        localStorage.setItem('sinestesia-tips', '1');
        if (save) localStorage.setItem('sinestesia-story', JSON.stringify(save));
        if (mem) localStorage.setItem('sinestesia-memoria', JSON.stringify(mem));
    }, [story, memory]);
    await page.goto('/');
    await page.locator('#go').click();
    await expect(page.locator('#start')).toBeHidden();
}

// the story, continued at chapter `ch` (0 is the prologue): resolves once her lines are over and the puzzle listens
export async function storyAt(page, ch, title, facts = FACTS) {
    await play(page, { story: ch ? { ch, ...facts } : null });
    await page.locator('#b-adventure').click();
    if (ch) await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('#st-chapter')).toContainText(title);
    await expect(page.locator('#st-task')).not.toBeEmpty({ timeout: 40_000 });
}

export async function expectChapter(page, title) {
    await expect(page.locator('#st-chapter')).toContainText(title, { timeout: 60_000 });
}

// the progress bar under the task, from 0 to 1
export async function meter(page) {
    return page.locator('#st-meter').evaluate(el => parseFloat(el.style.width || '0') / 100);
}

// a point on the sound surface, clear of the panels: x from 0 to 1 across the window
export function surface(page, x) {
    const { width, height } = page.viewportSize();
    return [Math.round(x * (width - 1)), Math.round(height * 0.3)];
}

// a key pressed on the page itself, as a player would (Playwright's keyboard types into whatever has focus)
export async function key(page, k, type = 'keydown') {
    await page.evaluate(([k, type]) => document.body.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true })), [k, type]);
}

// a shape drawn with the mouse held down on the sound surface. The pointer events are sent from inside the page,
// all at once: a spell must be drawn within four seconds, and the test browser draws its visuals slowly
export async function draw(page, points) {
    await page.evaluate(pts => {
        const fx = document.getElementById('fx');
        const send = (type, [x, y]) => fx.dispatchEvent(new PointerEvent(type, {
            clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1
        }));
        send('pointerdown', pts[0]);
        for (const p of pts.slice(1)) send('pointermove', p);
        send('pointerup', pts.at(-1));
    }, points);
}

export function shapes(cx, cy, r) {
    const poly = corners => corners.flatMap((p, k) => {
        const q = corners[(k + 1) % corners.length];
        return Array.from({ length: 20 }, (_, i) => [p[0] + (q[0] - p[0]) * i / 20, p[1] + (q[1] - p[1]) * i / 20]);
    }).concat([corners[0]]);
    return {
        circle: Array.from({ length: 60 }, (_, i) => {
            const a = i / 59 * Math.PI * 2;
            return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
        }),
        triangle: poly([[cx, cy - r], [cx + r, cy + r * 0.8], [cx - r, cy + r * 0.8]]),
        square: poly([[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]])
    };
}
