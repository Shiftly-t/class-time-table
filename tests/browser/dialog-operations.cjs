const assert = require('node:assert/strict');
const { fixtureUrl } = require('./harness.cjs');

async function staleDialogOperations({ page, openApplication, logIn }) {
  await openApplication(page);
  await page.evaluate(async (url) => {
    const { fixture } = await import(url);
    const finish = [];
    window.finishCalendarSave = (success) => finish.shift()(success);
    fixture.handleCallable('seasonalAuthorityApi', async (request) => {
      const protocolVersion = 3;
      if (request.action === 'capabilities') return { protocolVersion, operations: ['saveCalendar'] };
      if (request.action !== 'saveCalendar') throw new Error('Unexpected calendar action');
      const success = await new Promise((resolve) => finish.push(resolve));
      if (!success)
        throw Object.assign(new Error('Fixture rejected the old save'), {
          code: 'functions/permission-denied',
        });
      fixture.setRecords({ [request.collection + '/' + request.date]: request.value });
      return { protocolVersion, version: 1, changed: 1 };
    });
  }, fixtureUrl);
  await logIn(page, 'admin');
  await page.locator('#navClosures').click();

  const add = page.locator('#addClosure');
  const form = page.locator('#closureDialog');
  const date = form.locator('#closureDate');
  const note = form.locator('#closureNote');
  const save = form.locator('button[type=submit]');
  const dismiss = form.getByRole('button', { name: '閉じる', exact: true });
  for (const [index, success] of [true, false].entries()) {
    const savedDate = `2026-11-${13 + index}`;
    await add.click();
    await date.fill(savedDate);
    await note.fill('First opening');
    await save.click();
    await page.waitForFunction(
      async ({ url, count }) => {
        const { fixture } = await import(url);
        return fixture.callLog.filter(({ request }) => request.action === 'saveCalendar').length === count;
      },
      { url: fixtureUrl, count: index + 1 },
    );

    page.once('dialog', (dialog) => dialog.accept());
    await dismiss.click();
    await form.waitFor({ state: 'hidden' });
    await add.click();
    await date.fill('2026-11-19');
    await note.fill('Draft for the next opening');
    await page.evaluate((ok) => window.finishCalendarSave(ok), success);
    await page.waitForFunction(() => !document.querySelector('#closureForm button[type=submit]').disabled);

    assert.equal(await form.isVisible(), true, 'Old completion must not close the new form');
    assert.equal(await date.inputValue(), '2026-11-19');
    assert.equal(await note.inputValue(), 'Draft for the next opening');
    assert.equal(await page.locator('#shiftlyNotice').isVisible(), false);
    assert.equal(await page.locator('.shiftly-inline-success').count(), 0);
    assert.equal(await page.locator('#message').textContent(), '');
    const record = await page.evaluate(
      async ({ fixtureUrl, savedDate }) => {
        const { fixture } = await import(fixtureUrl);
        return fixture.getRecord('schoolClosures/' + savedDate);
      },
      { fixtureUrl, savedDate },
    );
    assert.deepEqual(record, success ? { date: savedDate, note: 'First opening' } : undefined);
    page.once('dialog', (dialog) => dialog.accept());
    await dismiss.click();
  }
}

module.exports = { staleDialogOperations };
