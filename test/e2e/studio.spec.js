// The Studio's tracks: the one you make is saved in the browser, and a track that arrives in a link or as a code
// never takes its place for good. The one you had is kept aside, and "Swap tracks" brings it back.
import { test, expect } from '@playwright/test';
import { FACTS, play, readCode as read, trackCode as track, watchErrors } from './helpers.js';

let errors;
test.beforeEach(async ({ page }) => {
    errors = watchErrors(page);
    // the first-visit tips stay out of the way
    await page.addInitScript(() => localStorage.setItem('sinestesia-tips', '1'));
});
test.afterEach(() => { expect(errors).toEqual([]); });

// these tests tell the tracks apart by their tempo
const tempo = code => read(code).bpm;
const tempoNow = page => page.evaluate(async () => (await import('/js/core/state.js')).S.bpm);

// what this browser holds: the track playing, and the ones kept aside (the last one left comes first)
const held = page => page.evaluate(() => ({
    track: localStorage.getItem('sinestesia-track'),
    kept: JSON.parse(localStorage.getItem('sinestesia-track-kept') || '[]')
}));
const keptTempos = async page => (await held(page)).kept.map(tempo);

// the tracks an earlier visit left in this browser
async function visitedBefore(page, { mine, kept = [], memory = null }) {
    await page.goto('/');
    await page.evaluate(([mine, kept, memory]) => {
        localStorage.setItem('sinestesia-track', mine);
        if (kept.length) localStorage.setItem('sinestesia-track-kept', JSON.stringify(kept));
        if (memory) localStorage.setItem('sinestesia-memoria', JSON.stringify(memory));
    }, [mine, kept, memory]);
}

// a link that carries a track: once Play is pressed the Studio opens by itself, with that track
async function openLink(page, code) {
    await page.goto('/?track=' + code);
    await page.locator('#go').click();
    await expect(page.locator('#studio')).toBeVisible();
}

// one step of the perc row, empty in a new track: switching it on is the edit these tests make
const mark = page => page.locator('#stu-drums .stu-cell[data-track="perc"][data-step="3"]');
const marked = code => read(code).sl[read(code).cur || 0].g.split('.')[5] === '0001000000000000';

test('a friend\'s link does not erase your track', async ({ page }) => {
    await play(page);
    await page.locator('#b-studio').click();
    await mark(page).click();
    // the track is saved at the next bar
    await expect.poll(async () => { const t = (await held(page)).track; return !!t && marked(t); }).toBe(true);
    const mine = (await held(page)).track;

    await openLink(page, track(140));
    // the link's track is the one playing and saved from now on, and yours is kept aside
    await expect.poll(async () => tempo((await held(page)).track)).toBe(140);
    expect((await held(page)).kept).toEqual([mine]);
    expect(await tempoNow(page)).toBe(140);
    await expect(page.locator('#toast')).toContainText('kept aside');

    await page.locator('#stu-swap').click();
    await expect(mark(page)).toHaveAttribute('data-v', '1');
    expect(await tempoNow(page)).toBe(128);
    const swapped = await held(page);
    expect(read(swapped.track)).toEqual(read(mine));
    expect(swapped.kept.map(tempo)).toEqual([140]);

    // after a reload it is your track that comes back, and the other one still waits
    await play(page);
    await page.locator('#b-studio').click();
    await expect(mark(page)).toHaveAttribute('data-v', '1');
    await expect(page.locator('#stu-swap')).toBeVisible();
});

test('links you only listen to never push your track out, and one you changed is kept too', async ({ page }) => {
    await visitedBefore(page, { mine: track(101) });
    await openLink(page, track(111));
    await expect.poll(() => keptTempos(page)).toEqual([101]);
    // the first link's track was never changed, and its link still holds it: only yours is kept
    await openLink(page, track(121));
    await expect.poll(() => tempoNow(page)).toBe(121);
    expect(await keptTempos(page)).toEqual([101]);
    await expect(page.locator('#stu-swap')).toHaveText('⇄ Swap tracks');

    // changed, the link's track is yours as well
    await mark(page).click();
    await expect.poll(async () => marked((await held(page)).track)).toBe(true);
    await openLink(page, track(131));
    await expect.poll(() => tempoNow(page)).toBe(131);
    expect(await keptTempos(page)).toEqual([121, 101]);
    await expect(page.locator('#stu-swap')).toHaveText('⇄ Swap tracks (2)');
});

test('her rhythm, given to a track from a link, does not make it yours', async ({ page }) => {
    // someone who rebuilt her rhythm in the story finds it in slot H of whatever track is open
    await visitedBefore(page, { mine: track(101), memory: { herRhythm: { kick: '1000100010001000', clap: '0000100000001000' } } });
    await openLink(page, track(111));
    await expect(page.locator('#toast')).toContainText('kept aside');
    await expect.poll(async () => !!read((await held(page)).track).sl[7]).toBe(true);
    await openLink(page, track(121));
    await expect.poll(() => tempoNow(page)).toBe(121);
    expect(await keptTempos(page)).toEqual([101]);
});

test('four tracks are kept, a fifth is handed back as a code, and the button goes round them', async ({ page }) => {
    await visitedBefore(page, { mine: track(101), kept: [102, 103, 104, 105].map(track) });
    await openLink(page, track(111));
    await expect.poll(() => keptTempos(page)).toEqual([101, 102, 103, 104]);
    // the oldest one waits in the code box, to be copied
    expect(tempo(await page.locator('#stu-code').inputValue())).toBe(105);
    await expect(page.locator('#toast')).toContainText('code box');

    await page.locator('#stu-swap').click();
    expect(await tempoNow(page)).toBe(101);
    expect(await keptTempos(page)).toEqual([102, 103, 104, 111]);
    await page.locator('#stu-swap').click();
    expect(await tempoNow(page)).toBe(102);
    expect(await keptTempos(page)).toEqual([103, 104, 111, 101]);
});

test('“Load code” keeps the track you had aside as well', async ({ page }) => {
    await visitedBefore(page, { mine: track(101) });
    await play(page);
    await page.locator('#b-studio').click();
    await expect.poll(() => tempoNow(page)).toBe(101);
    await expect(page.locator('#stu-swap')).toBeHidden();
    await page.locator('#stu-code').fill(track(150));
    await page.locator('#stu-load').click();
    await expect(page.locator('#toast')).toContainText('kept aside');
    expect(await tempoNow(page)).toBe(150);
    expect(await keptTempos(page)).toEqual([101]);
    // the same code again changes nothing
    await page.locator('#stu-load').click();
    expect(await keptTempos(page)).toEqual([101]);
});

test('a link that cannot be read leaves your track where it was', async ({ page }) => {
    await visitedBefore(page, { mine: track(101) });
    await openLink(page, 'SNS1-nonsense');
    await expect(page.locator('#toast')).toContainText('could not be read');
    expect(await tempoNow(page)).toBe(101);
    // nor can a code name a scale that is not one
    const odd = 'SNS1-' + Buffer.from(JSON.stringify({ ...read(track(150)), sc: 'constructor' })).toString('base64url');
    await openLink(page, odd);
    await expect(page.locator('#toast')).toContainText('could not be read');
    expect(await tempoNow(page)).toBe(101);
    const after = await held(page);
    expect(tempo(after.track)).toBe(101);
    expect(after.kept).toEqual([]);
});

test('the story borrows the Studio without the tracks kept aside', async ({ page }) => {
    await visitedBefore(page, { mine: track(101), kept: [track(102)] });
    await play(page, { story: { ch: 6, ...FACTS } });
    await page.locator('#b-studio').click();
    await expect(page.locator('#stu-swap')).toBeVisible();
    await page.locator('#stu-close').click();
    await page.locator('#b-adventure').click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('#studio')).toHaveClass(/guest/, { timeout: 40_000 });
    await expect(page.locator('#stu-swap')).toBeHidden();
});
