const assert = require('node:assert/strict');

const courseId = 'test-course';
const slotId = courseId + '__2026-11-12__0';
const period = { start: '17:30', end: '18:25' };
const course = {
  name: '試験用講習',
  startDate: '2026-11-12',
  endDate: '2026-11-12',
  periods: [period],
};
const slot = { ...period, id: slotId, date: course.startDate };
const openView = {
  phase: 'open',
  course,
  booking: { status: 'unanswered' },
  slots: [{ ...slot, remaining: 2 }],
};
const submittedView = {
  ...openView,
  booking: { status: 'submitted', confirmedCount: 0, wishes: [slotId], published: [], changes: [] },
};
const invalidMessage =
  '予約情報を確認できませんでした。再読み込みしても解決しない場合は教室へお問い合わせください。';

async function loadView(page, server, fixtureUrl, scenario, views) {
  const credentials = new URLSearchParams({ c: courseId, s: 'student-fixture', t: 'x'.repeat(42) });
  await page.goto(`${server.origin}/course-booking.html?fixture=${scenario}#${credentials}`);
  await page.locator('#nameInput').waitFor();
  await page.evaluate(
    async ({ fixtureUrl, views }) => {
      const { fixture } = await import(fixtureUrl);
      fixture.handleCallable('bookingPublicApi', ({ action }) => {
        if (action === 'view' && views.length) return views.shift();
        if (action === 'submit') return { ok: true };
        throw new Error(`Unexpected public booking action: ${action}`);
      });
    },
    { fixtureUrl, views },
  );
  await page.locator('#nameInput').fill('試験用生徒');
  await page.locator('#nameForm button').click();
}

async function requests(page, fixtureUrl) {
  const { actions, directWrites } = await page.evaluate(async (url) => {
    const { fixture } = await import(url);
    return {
      actions: fixture.callLog.map((entry) => entry.request.action),
      directWrites: fixture.directWrites.length,
    };
  }, fixtureUrl);
  assert.equal(directWrites, 0, 'Public booking bypassed the Callable');
  return actions;
}

async function publicBookingResponseChecks(page, server, fixtureUrl) {
  // 開始前の応答は空き枠数や提出後の情報を省略できる。
  await loadView(page, server, fixtureUrl, 'before', [
    {
      phase: 'before',
      openingAt: '2026-11-12T04:00:00Z',
      course,
      booking: { status: 'unanswered' },
      slots: [{ ...period, date: course.startDate }],
    },
  ]);
  await page.getByText('受付開始前', { exact: true }).waitFor();
  await page.getByText('17:30〜18:25', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-slot]').count(), 0);
  assert.equal(await page.getByText(/残り.*枠/).count(), 0);
  assert.deepEqual(await requests(page, fixtureUrl), ['view']);

  await loadView(page, server, fixtureUrl, 'omitted-capacity', [{ ...openView, slots: [slot] }]);
  await page.locator('[data-act="join"]').click();
  const unavailable = page.locator('[data-slot]');
  assert.equal(await unavailable.isDisabled(), true);
  assert.match(await unavailable.innerText(), /満席/);
  assert.deepEqual(await requests(page, fixtureUrl), ['view']);

  await loadView(page, server, fixtureUrl, 'invalid', [
    { ...openView, slots: [{ ...slot, remaining: '2' }] },
  ]);
  await page.locator('#bookingNoticeText').getByText(invalidMessage, { exact: true }).waitFor();
  await page.locator('#bookingNoticeClose').click();
  await page.locator('#nameInput').waitFor();
  assert.equal(await page.locator('[data-act="join"]').count(), 0);
  assert.deepEqual(await requests(page, fixtureUrl), ['view']);

  // 新規選択から除外された日でも、公開済み授業はカレンダーに残る。
  await loadView(page, server, fixtureUrl, 'closed', [
    {
      phase: 'closed',
      course,
      booking: {
        status: 'submitted',
        confirmedCount: 2,
        wishes: [slotId],
        published: [{ slotId, subject: '数学' }],
        changes: [{ id: 'change', from: slotId, to: slotId }],
      },
    },
  ]);
  const published = page.getByRole('listitem').filter({ hasText: '教科：数学' });
  await published.getByText('2026年11月12日（木） 17:30〜18:25', { exact: true }).waitFor();
  assert.match(await published.innerText(), /教科：数学$/);
  await page.getByRole('heading', { name: '授業変更のお知らせ' }).waitFor();
  await page.locator('[data-act="showCalendar"]').click();
  await page.getByText('17:30', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-act="edit"]').count(), 0);
  assert.deepEqual(await requests(page, fixtureUrl), ['view']);

  // 確定後の表示取得に失敗しても、同じ操作を再送しない。
  await loadView(page, server, fixtureUrl, 'refresh', [
    openView,
    { ...submittedView, booking: { ...submittedView.booking, confirmedCount: '0' } },
    submittedView,
  ]);
  await page.locator('[data-act="join"]').click();
  await page.getByText('残り2枠', { exact: true }).waitFor();
  await page.locator('[data-slot]').click();
  await page.locator('[data-act="review"]').click();
  await page.locator('[data-act="submit"]').click();
  await page
    .locator('#bookingNoticeText')
    .getByText(/保存は完了しましたが、最新表示を取得できませんでした/)
    .waitFor();
  await page.locator('#bookingNoticeClose').click();
  assert.deepEqual(await requests(page, fixtureUrl), ['view', 'submit', 'view']);
  await page.locator('[data-act="submit"]').click();
  await page.getByText('希望提出済み', { exact: true }).waitFor();
  assert.deepEqual(await requests(page, fixtureUrl), ['view', 'submit', 'view', 'view']);
  await page.locator('[data-act="edit"]').click();
  assert.equal(await page.locator('[data-slot]').getAttribute('aria-pressed'), 'true');
}

module.exports = { publicBookingResponseChecks };
