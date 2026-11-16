// The Signal, chapter by chapter: each test continues the story at one chapter, solves its puzzle the way a
// player would (mouse, keys, the radio dial, the Studio grid) and checks that the next chapter begins.
import { test, expect } from '@playwright/test';
import { FACTS, draw, expectChapter, key, meter, play, shapes, storyAt, surface, watchErrors } from './helpers.js';

let errors;
test.beforeEach(({ page }) => { errors = watchErrors(page); });
test.afterEach(() => { expect(errors).toEqual([]); });

test('the page plays, and asks nothing of any other host', async ({ page }) => {
    const foreign = [];
    page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1')) foreign.push(r.url()); });
    await play(page);
    await expect(page.locator('#b-adventure')).toBeVisible();
    // the page is laid out by the standard rules, and says what language it is in
    expect(await page.evaluate(() => [document.compatMode, document.documentElement.lang])).toEqual(['CSS1Compat', 'en']);
    expect(await page.evaluate(async () => (await import('/js/core/audio.js')).ac?.state)).toBe('running');
    expect(await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').length)).toBeGreaterThan(0);
    expect(foreign).toEqual([]);
});

test('prologue: the signal is tuned with the mouse', async ({ page }) => {
    await storyAt(page, 0, 'The Signal');
    await expect(page.locator('#st-step')).toHaveText('1 / 13');
    // sweep the width, then go back to where the signal was clearest and stay there
    let best = { x: 0, m: -1 };
    for (let x = 0.02; x <= 0.98; x += 0.02) {
        await page.mouse.move(...surface(page, x));
        await page.waitForTimeout(60);
        const m = await meter(page);
        if (m > best.m) best = { x, m };
    }
    await page.mouse.move(...surface(page, best.x));
    await expectChapter(page, 'The Name');
});

test('the name: typed, it becomes her groove', async ({ page }) => {
    await storyAt(page, 1, 'The Name');
    await page.keyboard.type('Lumen');
    await page.keyboard.press('Enter');
    await expectChapter(page, 'The Heartbeat');
});

test('the heartbeat: eight steady taps set the tempo', async ({ page }) => {
    await storyAt(page, 2, 'The Heartbeat');
    for (let i = 0; i < 10; i++) {
        await page.mouse.click(...surface(page, 0.5));
        await page.waitForTimeout(500);
    }
    await expectChapter(page, 'The City');
    const bpm = await page.evaluate(async () => (await import('/js/core/state.js')).S.bpm);
    // a tap every half second or a little more: about 120
    expect(bpm).toBeGreaterThanOrEqual(95);
    expect(bpm).toBeLessThanOrEqual(130);
});

test('the city: the theremin finds her note and holds it', async ({ page }) => {
    await storyAt(page, 3, 'The City');
    await page.mouse.move(...surface(page, 0.3));
    await page.mouse.down();
    // her note is in the middle third of the width: past a third of the meter, the note is right
    for (let x = 0.3; x <= 0.72; x += 0.006) {
        await page.mouse.move(...surface(page, x));
        await page.waitForTimeout(250);
        if (await meter(page) > 0.37) break;
    }
    await expectChapter(page, 'Shortwave');
    await page.mouse.up();
});

test('shortwave: the numbers station reads the frequency to tune to', async ({ page }) => {
    await storyAt(page, 4, 'Shortwave');
    const dial = page.locator('#rd-dial');
    await expect(page.locator('#radio')).toBeVisible();
    // a click on the scale jumps there (sweeping the dial could cross her station on the way), the arrows finish it
    const tuneTo = async f => {
        const box = await dial.boundingBox();
        const [lo, hi] = [2.5, 12];
        await page.mouse.click(box.x + box.width * (f - lo) / (hi - lo), box.y + box.height / 2);
        await dial.focus();
        for (let i = 0; i < 40; i++) {
            const diff = f - parseFloat(await dial.getAttribute('aria-valuenow'));
            if (Math.abs(diff) < 0.015) return;
            await page.keyboard.press(diff > 0 ? 'ArrowRight' : 'ArrowLeft');
        }
    };
    await tuneTo(6.1);
    const read = page.locator('#st-lines p', { hasText: 'A flat voice reads two numbers' });
    // her lines are typed out letter by letter: wait for the whole line
    await expect(read).toHaveText(/numbers: \w+, \w+\./);
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const [a, b] = (await read.textContent()).match(/numbers: (\w+), (\w+)/).slice(1).map(w => words.indexOf(w));
    await tuneTo(a + b / 10);
    await expectChapter(page, 'The Archive');
    await expect(page.locator('#radio')).toBeHidden();
});

test('the archive: three phrases sung back on the keys', async ({ page }) => {
    // the keys she lights while she sings are the phrase to play back
    await page.addInitScript(() => {
        window.sung = [];
        new MutationObserver(list => {
            for (const m of list) {
                const k = m.target;
                if (k.classList?.contains('key') && k.classList.contains('hit') && !m.oldValue?.includes('hit')) window.sung.push(+k.dataset.i);
            }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    });
    await storyAt(page, 5, 'The Archive');
    for (let round = 0; round < 3; round++) {
        await expect(page.locator('#st-task')).toHaveText('Your turn: play it back.');
        const phrase = await page.evaluate(() => window.sung.splice(0));
        expect(phrase.length).toBe(3 + round);
        for (const i of phrase) {
            await page.locator(`#keys .key[data-i="${i}"]`).dispatchEvent('pointerdown');
            await page.waitForTimeout(250);
        }
        // the keys flash as you press them too: those are not hers
        await page.evaluate(() => { window.sung = []; });
        if (round < 2) await expect(page.locator('#st-task')).toHaveText('Listen.');
    }
    await expectChapter(page, 'The Factory');
});

test('the factory: her rhythm rebuilt in the Studio grid, with her help', async ({ page }) => {
    await storyAt(page, 6, 'The Factory');
    const studio = page.locator('#studio');
    await expect(studio).toBeVisible();
    await expect(studio).toHaveClass(/guest/);
    // only the three rows she asks for are shown
    await expect(page.locator('#stu-drums .stu-trow:visible')).toHaveCount(3);
    const cell = (t, i) => page.locator(`#stu-drums .stu-cell[data-track="${t}"][data-step="${i}"]`);
    for (const i of [0, 4, 8, 12]) await cell('kick', i).click();
    await expect(page.locator('#stu-drums .stu-trow[data-track="kick"]')).toHaveClass(/right/);
    await expect(page.locator('#st-task')).toContainText('clap');
    // stuck for a while: she shows the squares
    await expect(page.locator('#st-lines')).toContainText('I\'ll show you', { timeout: 40_000 });
    for (const c of await page.locator('.stu-cell.want').all()) await c.click();
    await expect(page.locator('#st-task')).toContainText('closed hat');
    for (const c of await page.locator('.stu-cell.want').all()) await c.click();
    await expectChapter(page, 'The Storm');
    // your own Studio comes back, whole
    await expect(studio).toBeHidden();
    await expect(studio).not.toHaveClass(/guest/);
    const her = await page.evaluate(() => JSON.parse(localStorage.getItem('sinestesia-memoria')).herRhythm);
    expect(her.kick).toBe('1000100010001000');
});

test('the storm: three shapes, and the third does not end the story', async ({ page }) => {
    await storyAt(page, 7, 'The Storm');
    const { width, height } = page.viewportSize();
    const s = shapes(width / 2, height * 0.3, Math.min(120, height * 0.15));
    await page.evaluate(async () => {
        const { on } = await import('/js/core/bus.js');
        window.spells = [];
        on('spell', name => window.spells.push(name));
    });
    for (const name of ['circle', 'triangle', 'square']) {
        await draw(page, s[name]);
        await page.waitForTimeout(400);
    }
    expect(await page.evaluate(() => window.spells)).toEqual(['Water', 'Fire', 'Time']);
    await expectChapter(page, 'The Vault');
    await expect(page.locator('#story')).toBeVisible();
    // the spells only flared: the story's tempo is untouched
    expect(await page.evaluate(async () => (await import('/js/core/state.js')).S.bpm)).toBe(FACTS.bpm);
});

test('the vault: the memory is mined', async ({ page }) => {
    await storyAt(page, 8, 'The Vault');
    await page.getByRole('button', { name: /Mine the memory/ }).click();
    await expect(page.locator('#st-lines')).toContainText('Key found', { timeout: 90_000 });
    await expectChapter(page, 'The Archivist');
});

test('the archivist: eight bars that never repeat', async ({ page }) => {
    await storyAt(page, 9, 'The Archivist');
    // one different letter in each bar
    await page.evaluate(async () => {
        const { on } = await import('/js/core/bus.js');
        const letters = 'qwertyuiopasdfghjklzxcvbnm';
        let k = 0;
        on('bar', () => {
            setTimeout(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: letters[k++ % letters.length], bubbles: true })), 300);
        });
    });
    await expectChapter(page, 'The Drop');
});

test('the drop: three releases on the one', async ({ page }) => {
    await storyAt(page, 10, 'The Drop');
    await page.evaluate(async () => {
        const { on } = await import('/js/core/bus.js');
        window.barT = 0;
        on('bar', t => { window.barT = t; });
    });
    // an early release is refused
    await key(page, ' ');
    await page.waitForTimeout(300);
    await key(page, ' ', 'keyup');
    await expect(page.locator('#st-task')).toContainText('Hold it longer');
    // three drops on the one; a release the busy test browser makes late is simply tried again, as a player would
    for (let attempt = 0; attempt < 10; attempt++) {
        if (await page.locator('#st-chapter').textContent().then(t => t.includes('The Cathedral'))) break;
        if (await page.locator('#st-lines').textContent().then(t => t.includes('Enough.'))) break;
        await page.waitForTimeout(1200);
        await page.evaluate(async () => {
            const { ac } = await import('/js/core/audio.js');
            const { S } = await import('/js/core/state.js');
            const send = type => document.body.dispatchEvent(new KeyboardEvent(type, { key: ' ', bubbles: true }));
            // the riser peaks on the first downbeat at least three beats away: let go right there
            const now = ac.currentTime, bar = 240 / S.bpm;
            const peak = window.barT + Math.ceil((now + bar * 0.75 - window.barT) / bar) * bar;
            send('keydown');
            // timers run late while the page draws; the last stretch is waited on the clock itself
            const stamp = ac.getOutputTimestamp();
            const at = stamp.performanceTime + (peak - stamp.contextTime) * 1000;
            await new Promise(r => setTimeout(r, Math.max(0, at - performance.now() - 250)));
            while (performance.now() < at) { /* the release has to land within a few milliseconds */ }
            send('keyup');
        });
    }
    await expectChapter(page, 'The Cathedral');
});

test('the cathedral: her reply to your own words', async ({ page }) => {
    await storyAt(page, 11, 'The Cathedral');
    await page.locator('#type').fill('a friend made of sound');
    await page.locator('#type').press('Enter');
    await expectChapter(page, 'The Choice');
});

for (const [label, ending, kicker] of [['Stay with me', 'resta', 'Symbiosis'], ['Go beyond the horizon', 'vai', 'Horizon'], ['Become the music', 'diventa', 'Synesthesia']]) {
    test(`the choice: "${label}" ends the story`, async ({ page }) => {
        await storyAt(page, 12, 'The Choice');
        await page.getByRole('button', { name: label }).click();
        await expect(page.locator('#epilogue')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#ep-kicker')).toContainText(kicker);
        await expect(page.locator('#ep-title')).toHaveText(FACTS.name);
        const store = await page.evaluate(() => ({ progress: localStorage.getItem('sinestesia-story'), memory: JSON.parse(localStorage.getItem('sinestesia-memoria')) }));
        expect(store.progress).toBeNull();
        expect(store.memory.ending).toBe(ending);
        expect(store.memory.name).toBe(FACTS.name);
        await page.locator('#ep-play').click();
        await expect(page.locator('#epilogue')).toBeHidden();
        await expect(page.locator('#story')).toBeHidden();
    });
}
