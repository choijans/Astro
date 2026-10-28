// Manual check for the offline command outbox (docs/plan.md Task 11).
//
// Not part of any automated suite and not a project dependency — Playwright
// isn't in frontend/package.json. Run it one-off from the frontend directory:
//
//   cd frontend
//   npm install --no-save playwright
//   npx playwright install chromium   # first time only, downloads the browser
//   node scripts/manual-checks/offline-outbox.mjs
//
// `--no-save` keeps package.json untouched; `npm install` afterwards (no
// args) restores node_modules to exactly what's in package-lock.json if you
// want it back to a clean state. (A plain `npx -y -p playwright node ...`
// looks simpler, but Node's ESM resolution looks for the "playwright" package
// starting from this file's own directory and walking up — npx's temporary
// install isn't anywhere in that chain, so it fails with
// ERR_MODULE_NOT_FOUND unless playwright is actually installed under
// frontend/node_modules, which is what the steps above do.)
//
// Needs the dev stack up first (docker compose up -d, the backend API, the
// worker, and the frontend dev server — see README.md "Setup"). It drives a
// real Chromium browser against the real running app and asserts:
//   - a favourite toggle while offline is NOT rolled back and is queued
//   - add-then-remove of the SAME channel while offline preserves order
//   - the header shows the right queued count while offline
//   - reconnecting flushes the outbox and shows "Changes synced"
//   - the result survives a reload
//
// See docs/TESTING.md for what this does and does not cover, and why it's a
// manual script rather than an automated test (jsdom's navigator.onLine is
// always true, so this exact scenario can't be driven from a jsdom test).

import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

function log(msg) {
  console.log(`[check] ${msg}`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const firstCard = page.locator('[aria-label^="Add "]').first();
    await firstCard.waitFor({ state: 'visible' });
    const label = await firstCard.getAttribute('aria-label');
    const channelTitle = label.replace(/^Add /, '').replace(/ to favourites$/, '');
    log(`Using channel: "${channelTitle}"`);

    log('Going offline...');
    await context.setOffline(true);

    // Add, then remove, the SAME channel while offline — order must survive.
    // Each click's mutation stays pending (button disabled) for however long
    // the fetch takes to reject before the NetworkError resolves and queues
    // it — the optimistic flip itself is immediate, but a second click has
    // to wait for that to finish, same as the existing "ignore clicks while
    // pending" behavior.
    await firstCard.click();
    const removeButton = page.locator(`[aria-label="Remove ${channelTitle} from favourites"]`);
    await removeButton.waitFor({ state: 'visible', timeout: 5000 });
    log('Heart flipped to "favourited" while offline (no rollback).');

    await removeButton.click({ timeout: 15000 });
    const addButtonAgain = page.locator(`[aria-label="Add ${channelTitle} to favourites"]`);
    await addButtonAgain.waitFor({ state: 'visible', timeout: 15000 });
    log('Heart flipped back to "not favourited" while offline (add then remove, both queued).');

    // The second request's connection failure can take a bit longer to
    // surface than the first's, so poll for "2 changes" rather than
    // checking once immediately after the click.
    const offlineStatus = page.getByRole('status').filter({ hasText: '2 changes' });
    await offlineStatus.waitFor({ state: 'visible', timeout: 10000 });
    const offlineText = await offlineStatus.textContent();
    log(`Offline indicator shown: "${offlineText}"`);

    log('Going back online...');
    await context.setOffline(false);

    const syncedStatus = page.getByRole('status').filter({ hasText: 'Changes synced' });
    await syncedStatus.waitFor({ state: 'visible', timeout: 20000 });
    log('Outbox flushed: "Changes synced" shown.');

    await addButtonAgain.waitFor({ state: 'visible', timeout: 10000 });
    log('Final state after sync: "Add" (not favourited) — correct, add-then-remove nets to not-favourited.');

    log('Reloading page...');
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .locator(`[aria-label="Add ${channelTitle} to favourites"]`)
      .waitFor({ state: 'visible', timeout: 10000 });
    log('State persisted correctly after reload: still "Add" (not favourited).');

    log('ALL CHECKS PASSED');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[check] FAILED:', err);
  process.exitCode = 1;
});
