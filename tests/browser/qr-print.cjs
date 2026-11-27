const assert = require('node:assert/strict');
const { fixtureUrl, openPage } = require('./harness.cjs');

const namespace = 'http://www.w3.org/2000/svg';
const validArt =
  `<?xml version="1.0"?><svg xmlns="${namespace}" viewBox="0 0 29 29" width="116" height="116">` +
  '<title>試験用のQR</title><rect width="29" height="29" fill="#fff"/>' +
  '<g transform="translate(4 4)"><path fill="none" stroke="#000" d="M0 0h7m-7 1h1m5 0h1" shape-rendering="crispEdges"/></g></svg>';

async function seedQrPrint(page, server, svg = validArt) {
  await page.goto(`${server.origin}/course-booking-admin.html`);
  await page.getByRole('heading', { name: 'ログインが必要です' }).waitFor();
  await page.evaluate(
    async ({ url, art }) => {
      const { fixture } = await import(url);
      const course = {
        id: 'example-course',
        name: '試験講習 & 冬',
        startDate: '2026-11-12',
        endDate: '2026-11-30',
        periods: [{ start: '17:30', end: '18:25' }],
      };
      const students = [
        { id: 'student-a', name: '試験生徒 <A>', status: 'unanswered', wishes: 0, confirmed: 0 },
        { id: 'student-b', name: '試験生徒 & B', status: 'unanswered', wishes: 0, confirmed: 0 },
      ];
      window.qrResponses = Object.fromEntries(students.map(({ id }) => [id, art]));
      fixture.setRecords({ 'users/admin': { role: 'admin', name: '試験管理者' } });
      fixture.handleCallable('bookingAdminApi', ({ action, studentId }) => {
        switch (action) {
          case 'courses':
            return { courses: [course] };
          case 'getSettings':
            return { course, settings: { enabled: true } };
          case 'roster':
            return { rows: students };
          case 'slotDemand':
            return { slots: [] };
          case 'teachers':
            return { teachers: [] };
          case 'detail':
            return { student: students.find((student) => student.id === studentId) };
          case 'getQr':
            return {
              courseId: course.id,
              courseName: course.name,
              studentId,
              studentName: students.find((student) => student.id === studentId).name,
              closingAt: '2026-11-30T08:00:00Z',
              svg: window.qrResponses[studentId],
            };
          default:
            throw new Error(`Unexpected action: ${action}`);
        }
      });
      fixture.setUser('admin');
    },
    { url: fixtureUrl, art: svg },
  );
  await page.getByRole('heading', { name: '生徒別の提出状況' }).waitFor();
}

async function openPreview(page) {
  await page.locator('#printReady').click();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: '許可' }).click(),
  ]);
  return popup;
}

async function assertRejected(page) {
  await page
    .locator('#bookingNoticeText')
    .getByText('印刷データの形式を確認できません。', { exact: false })
    .waitFor();
  assert.equal(await page.locator('#printRoot > *').count(), 0);
  await page.locator('#printReadyWrap').waitFor({ state: 'hidden' });
  await page.locator('#bookingNoticeClose').click();
}

async function qrPrint(browser, server) {
  const { page, close } = await openPage(browser, server, { viewport: { width: 1200, height: 900 } });
  try {
    await seedQrPrint(page, server);
    await page.locator('[data-act="printAll"]').click();
    await page.locator('#printReady').waitFor();
    const preparedArt = page.locator('#printRoot svg');
    assert.equal(await preparedArt.count(), 2);
    assert.equal(await preparedArt.first().getAttribute('viewBox'), '0 0 29 29');
    assert.equal(await preparedArt.first().locator('path').getAttribute('shape-rendering'), 'crispEdges');
    assert.equal(await page.locator('.printitem .studentname').first().textContent(), '試験生徒 <A> さん');

    const popup = await openPreview(page);
    await popup.locator('.qr-art svg').first().waitFor();
    assert.equal(await popup.locator('.qr-paper').count(), 2);
    await popup.getByLabel('印刷レイアウト').selectOption('4');
    assert.equal(await popup.locator('.qr-paper[data-layout="4"]').count(), 1);
    assert.equal(await popup.locator('.qr-art svg').count(), 2);
    assert.equal(await popup.locator('.qr-art svg').first().getAttribute('width'), '116');
    assert.equal(await popup.locator('.qr-name').first().textContent(), '試験生徒 <A> さん');
    await popup.close();

    await page.evaluate(
      (svg) => (window.qrResponses['student-b'] = svg),
      `<svg xmlns="${namespace}"><circle/></svg>`,
    );
    await page.locator('[data-act="printAll"]').click();
    await assertRejected(page);

    await page.locator('[data-act="student:student-a"]').click();
    const printOne = page.getByRole('button', { name: '現在のQRを印刷' });
    for (const invalidArt of [
      12,
      `<svg xmlns="${namespace}"><path></svg>`,
      `<svg xmlns="${namespace}"><g xmlns="urn:fixture"/></svg>`,
      `<svg xmlns="${namespace}" class="fixture"/>`,
      `<svg xmlns="${namespace}" fill="var(--fixture-color)"/>`,
    ]) {
      await page.evaluate((svg) => (window.qrResponses['student-a'] = svg), invalidArt);
      await printOne.click();
      await assertRejected(page);
    }

    await page.evaluate((svg) => (window.qrResponses['student-a'] = svg), validArt);
    await printOne.click();
    await page.locator('#printReady').waitFor();
    await page.evaluate(() => (window.qrResponses['student-a'] = '<invalid/>'));
    await page.locator('#printReady').click();
    await page.getByRole('button', { name: '許可' }).click();
    await assertRejected(page);
    assert.equal(page.context().pages().length, 1, 'invalid refresh closed the blank print popup');
  } finally {
    await close();
  }
}

module.exports = { openPreview, qrPrint, seedQrPrint };
