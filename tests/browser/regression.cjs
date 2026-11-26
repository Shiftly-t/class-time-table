const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { normalSchedule } = require('./normal-schedule.cjs');
const { seasonalCourses } = require('./seasonal-courses.cjs');
const { adjust, browsers, condition, fixtureUrl, launch, openPage, startServer } = require('./harness.cjs');

const date = '2026-11-12';
const seed = {
  'users/owner': { role: 'owner', name: '試験用運営' },
  'users/admin': { role: 'admin', name: '試験用管理者' },
  'users/teacher': { role: 'employee', name: '試験用講師' },
  'users/other': { role: 'employee', name: '別の講師' },
  'schoolStudents/student-a': {
    name: '試験用生徒',
    grade: '中1',
    school: '試験用中学',
    regularSlots: {
      weekly: {
        id: 'weekly',
        weekday: 4,
        start: '19:30',
        end: '21:25',
        teacherUid: 'teacher',
        subject: '数学',
      },
    },
  },
  'schoolStudents/student-b': { name: '別の生徒', grade: '中2' },
  'timetableEntries/entry-a': {
    studentId: 'student-b',
    studentName: '別の生徒',
    date,
    start: '17:30',
    end: '18:25',
    teacherUid: 'other',
    teacherName: '別の講師',
    status: 'scheduled',
    subject: '英語',
  },
  'systemConfig/maintenance': { enabled: false, version: 'v26.0' },
};
const deviceCases = [
  { name: 'PC', width: 1440, height: 900, role: 'admin' },
  { name: 'iPad portrait', width: 1024, height: 1366, role: 'owner', touch: true },
  { name: 'iPad split view', width: 507, height: 1024, role: 'admin', touch: true },
  { name: 'phone', width: 390, height: 844, role: 'teacher', touch: true },
];

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
});

async function openApplication(page) {
  await page.goto(server.origin);
  await page.locator('#loginForm').waitFor();
  await adjust(page, seed);
}

async function logIn(page, role) {
  await page.locator('#email').fill(`${role}@example.invalid`);
  await page.locator('#password').fill('browser-test-only');
  await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#appPanel').waitFor();
  await condition(page, 'listensTo', ['timetableEntries']);
}

async function logOut(page) {
  await page.locator('#logout').click();
  await page.locator('#logoutConfirm').click();
  await page.locator('#loginForm').waitFor();
  await page.waitForFunction(async (url) => (await import(url)).fixture.listenCount() === 0, fixtureUrl);
  assert.equal(await page.locator('dialog[open]').count(), 0);
}

async function assertFits(page, width) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  assert.equal(metrics.viewport, width);
  assert.ok(
    metrics.page <= metrics.viewport + 1,
    `Document horizontal overflow: ${metrics.page}px at ${metrics.viewport}px`,
  );
}

async function assertDialogFits(dialog) {
  await dialog.waitFor();
  const geometry = await dialog.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: innerWidth,
      height: innerHeight,
    };
  });
  assert.ok(geometry.x >= -1 && geometry.right <= geometry.width + 1, JSON.stringify(geometry));
  assert.ok(geometry.y >= -1 && geometry.bottom <= geometry.height + 1, JSON.stringify(geometry));
}

async function assertNoWrites(page) {
  const writes = await page.evaluate(async (url) => {
    const { fixture } = await import(url);
    return { direct: fixture.directWrites.length, callable: fixture.callLog.length };
  }, fixtureUrl);
  assert.deepEqual(writes, { direct: 0, callable: 0 });
}

for (const browserName of browsers) {
  test(browserName, async (suite) => {
    const browser = await launch(browserName);
    try {
      for (const device of deviceCases) {
        await suite.test(`${device.name}, ${device.role}`, async () => {
          const { page, close } = await openPage(browser, server, {
            viewport: { width: device.width, height: device.height },
            deviceScaleFactor: device.touch ? 2 : 1,
            hasTouch: Boolean(device.touch),
            isMobile: Boolean(device.touch),
          });
          try {
            await openApplication(page);
            await assertFits(page, device.width);
            await logIn(page, device.role);
            const management = device.role !== 'teacher';
            assert.equal(await page.locator('#navDashboard').isVisible(), management);
            assert.equal(await page.locator('#navOwnerHistory').isVisible(), device.role === 'owner');
            assert.equal(await page.locator('#navMaintenanceOwner').isVisible(), device.role === 'owner');
            assert.equal(await page.locator('#navCount').isVisible(), management);
            assert.equal(await page.locator('#navTeacherStudents').isVisible(), !management);
            assert.equal(await page.locator('#navBookingManagement').isVisible(), management);
            if (management) {
              await page.locator('#dashboardSearch').fill('試験用中学');
              await page
                .locator('#dashboardSearchResults')
                .getByText('試験用生徒', { exact: true })
                .waitFor();
            }
            await page.locator(management ? '#navAdminLessons' : '#navTeacherLessons').click();
            await page.locator('.lesson-card').first().waitFor();
            assert.equal(await page.locator('.lesson-card').count(), management ? 3 : 2);
            await assertFits(page, device.width);

            await page.locator('#scheduleDateOpen').click();
            const dateDialog = page.locator('#scheduleDateDialog');
            await assertDialogFits(dateDialog);
            await dateDialog.locator('[data-schedule-view=week]').click();
            await page.locator('#scheduleDateApply').click();
            assert.match(await page.locator('#displayDate').innerText(), /〜/);
            await assertFits(page, device.width);

            await page.locator(management ? '#navCount' : '#navTeacherStudents').click();
            const directory = page.locator(management ? '#adminCountPage' : '#teacherStudentsPage');
            const studentRow = directory.getByRole('row').filter({ hasText: '試験用生徒' });
            await studentRow.waitFor();
            assert.equal(await studentRow.getByRole('button', { name: '編集' }).count(), management ? 1 : 0);
            await assertFits(page, device.width);
            if (management) {
              await studentRow.getByRole('button', { name: '編集' }).click();
              const studentDialog = page.locator('#studentDialog');
              await assertDialogFits(studentDialog);
              await page.locator('#studentRemarks').fill('未保存のテスト');
              page.once('dialog', (dialog) => dialog.dismiss());
              await studentDialog.getByRole('button', { name: '閉じる' }).click();
              assert.equal(await studentDialog.isVisible(), true);
              assert.equal(await page.locator('#studentRemarks').inputValue(), '未保存のテスト');
              page.once('dialog', (dialog) => dialog.accept());
              await studentDialog.getByRole('button', { name: '閉じる' }).click();
              await studentDialog.waitFor({ state: 'hidden' });
            }
            const beforeMaintenance = await page.evaluate(
              async (url) => (await import(url)).fixture.listenCount(),
              fixtureUrl,
            );
            assert.ok(beforeMaintenance > 1);
            await adjust(page, {
              'systemConfig/maintenance': { enabled: true, message: '保守試験', version: 'v27.0' },
            });
            if (device.role === 'owner') {
              await page.locator('#navMaintenanceOwner').click();
              await page
                .locator('#maintenanceModeLabel')
                .getByText('メンテナンス中', { exact: true })
                .waitFor();
              assert.equal(await page.locator('#maintenancePanel').isVisible(), false);
            } else {
              await page.getByText('保守試験', { exact: true }).waitFor();
              assert.equal(await page.locator('#appPanel').isVisible(), false);
              assert.equal(await page.locator('#notificationButton').isVisible(), false);
              await page.waitForFunction(
                async (url) => (await import(url)).fixture.listenCount() === 1,
                fixtureUrl,
              );
            }
            await adjust(page, { 'systemConfig/maintenance': seed['systemConfig/maintenance'] });
            await page.locator('#appPanel').waitFor();
            await page.waitForFunction(
              async ({ fixtureUrl, beforeMaintenance }) =>
                (await import(fixtureUrl)).fixture.listenCount() === beforeMaintenance,
              { fixtureUrl, beforeMaintenance },
            );
            if (device.role !== 'owner') assert.equal(await directory.isVisible(), true);
            await assertNoWrites(page);
            await logOut(page);
          } finally {
            await close();
          }
        });
      }

      await suite.test('normal timetable staging, touch, save, capacity and conflict', async () => {
        const { context, page, close } = await openPage(browser, server, {
          viewport: { width: 1024, height: 1366 },
          hasTouch: true,
          isMobile: true,
        });
        try {
          await normalSchedule({ browserName, context, page, date, openApplication, logIn, logOut });
        } finally {
          await close();
        }
      });

      await suite.test('seasonal course archive and restore preserve availability', async () => {
        const { page, close } = await openPage(browser, server, { viewport: { width: 1024, height: 1366 } });
        try {
          await seasonalCourses({ page, openApplication, logIn });
        } finally {
          await close();
        }
      });

      if (browserName === 'chromium') {
        await suite.test(
          'repeated workspace lifecycle releases listeners and detached DOM',
          async (measurements) => {
            const { context, page, close } = await openPage(browser, server, {
              viewport: { width: 1440, height: 900 },
            });
            try {
              const appRequests = [];
              page.on('requestfinished', (request) => {
                const url = new URL(request.url());
                if (url.origin === server.origin && !url.pathname.startsWith('/_tests/')) {
                  appRequests.push(request.sizes());
                }
              });
              const start = performance.now();
              await openApplication(page);
              const startupMs = Math.round(performance.now() - start);
              const cdp = await context.newCDPSession(page);
              const afterGc = async () => {
                await cdp.send('HeapProfiler.collectGarbage');
                return cdp.send('Memory.getDOMCounters');
              };
              const cycle = async () => {
                await logIn(page, 'admin');
                await page.locator('#navAdminLessons').click();
                await page.locator('.lesson-card').first().waitFor();
                await page.locator('#scheduleDateOpen').click();
                await page.locator('#scheduleDateDialog').getByRole('button', { name: 'キャンセル' }).click();
                await adjust(page, { 'systemConfig/maintenance': { enabled: true } });
                await page.locator('#maintenancePanel').waitFor();
                await adjust(page, { 'systemConfig/maintenance': seed['systemConfig/maintenance'] });
                await page.locator('#appPanel').waitFor();
                await logOut(page);
              };
              await cycle();
              const warm = await afterGc();
              for (let i = 0; i < 5; i += 1) await cycle();
              const repeated = await afterGc();
              const resources = await Promise.all(appRequests);
              const localBytes = resources.reduce((sum, request) => sum + request.responseBodySize, 0);
              measurements.diagnostic(
                JSON.stringify({ warm, repeated, startupMs, localAssets: resources.length, localBytes }),
              );
              assert.equal(repeated.documents, warm.documents);
              assert.ok(repeated.nodes <= warm.nodes + 25, 'DOM node count grew across repeated lifecycles');
              assert.ok(
                repeated.jsEventListeners <= warm.jsEventListeners + 5,
                'Event listener count grew across repeated lifecycles',
              );
              await assertNoWrites(page);
            } finally {
              await close();
            }
          },
        );
      }

      await suite.test('signed-out and employee booking gates', async () => {
        const { page, close } = await openPage(browser, server, { viewport: { width: 390, height: 844 } });
        try {
          await page.goto(`${server.origin}/course-booking.html`);
          await page.getByRole('heading', { name: 'QRコードが確認できません' }).waitFor();
          await assertFits(page, 390);
          await page.goto(`${server.origin}/course-booking-admin.html`);
          await page.getByRole('heading', { name: 'ログインが必要です' }).waitFor();
          await adjust(page, seed);
          await page.evaluate(async (url) => (await import(url)).fixture.setUser('teacher'), fixtureUrl);
          await page.getByRole('heading', { name: '管理者のみ利用できます' }).waitFor();
          await assertFits(page, 390);
          await assertNoWrites(page);
        } finally {
          await close();
        }
      });
    } finally {
      await browser.close();
    }
  });
}
