const assert = require('node:assert/strict');
const { adjust, condition, fixtureUrl } = require('./harness.cjs');

async function sessionPrivacy({ page, date, openApplication, logIn, logOut }) {
  const name = '前のログインの生徒名';
  const legacy = '前のログインの通常授業備考';
  const memo = '前のログインの伝達事項';
  const draft = 'ログアウト前の未保存メモ';

  await openApplication(page);
  await adjust(page, {
    'schoolStudents/privacy-student': { name, grade: '中1', regular: legacy },
    'timetableEntries/privacy-lesson': {
      studentId: 'privacy-student',
      studentName: name,
      teacherUid: 'teacher',
      teacherName: '試験用講師',
      date,
      start: '18:30',
      end: '19:25',
      status: 'scheduled',
      subject: '数学',
      memo,
    },
  });
  await logIn(page, 'admin');
  await page.locator('#navCount').click();
  await page.locator('#studentSearch').fill(name);
  await page.locator('#countRows tr').filter({ hasText: name }).getByRole('button', { name: '編集' }).click();
  assert.equal(await page.locator('#studentName').inputValue(), name);
  assert.match(await page.locator('#legacyRegularNote').textContent(), new RegExp(legacy));
  await page.locator('#studentRemarks').fill(draft);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#studentDialog [data-close=studentDialog]').click();
  await page.locator('#studentDialog').waitFor({ state: 'hidden' });

  await page.locator('#navAdminLessons').click();
  await page.locator('.lesson-card').filter({ hasText: name }).click();
  assert.equal(await page.locator('#memoContent').inputValue(), memo);
  await page.locator('#editLesson').click();
  assert.equal(await page.locator('#lessonId').inputValue(), 'privacy-lesson');
  assert.equal(await page.locator('#lessonStudent').inputValue(), 'privacy-student');
  await page.locator('#lessonFormDialog [data-close=lessonFormDialog]').click();
  await page.locator('#lessonFormDialog').waitFor({ state: 'hidden' });

  await logOut(page);

  assert.equal(await page.locator('#countRows > *').count(), 0);
  assert.equal(await page.locator('#lessonList > *').count(), 0);
  assert.equal(await page.locator('#lessonStudent > *').count(), 0);
  for (const id of ['studentSearch', 'studentId', 'studentName', 'studentRemarks', 'lessonId', 'memoContent']) {
    assert.equal(await page.locator('#' + id).inputValue(), '', id);
  }
  const body = await page.locator('body').innerHTML();
  for (const marker of [name, legacy, memo, draft, 'privacy-student', 'privacy-lesson']) {
    assert.equal(body.includes(marker), false, 'Previous session data retained in the DOM: ' + marker);
  }
}

async function maintenanceReadFailure({ page, openApplication, logIn, logOut, role = 'admin' }) {
  await openApplication(page);
  await adjust(page, {
    'specialCourses/error-test-course': {
      name: '購読確認用講習',
      startDate: '2026-11-15',
      endDate: '2026-11-30',
      periods: [{ start: '17:30', end: '18:25' }],
    },
  });
  await logIn(page, role);
  await condition(page, 'listensTo', ['specialCourses/error-test-course/teacherAvailability']);
  await page.locator('#navBookingManagement').click();
  await page.locator('#bookingFrameHost iframe').waitFor();
  await page.evaluate(async (url) => {
    (await import(url)).fixture.failSnapshot('systemConfig/maintenance');
  }, fixtureUrl);

  await page.getByText('利用状況を確認できません', { exact: true }).waitFor();
  assert.equal(await page.locator('#appPanel').isVisible(), false);
  assert.equal(await page.locator('#notificationButton').isVisible(), false);
  assert.equal(await page.locator('#bookingFrameHost iframe').count(), 0);

  // The owner keeps the independent control-plane restore listener only.
  const expectedListeners = role === 'owner' ? 1 : 0;
  const observations = await page.evaluate(async (url) => {
    const { fixture } = await import(url);
    return {
      listeners: fixture.listenCount(),
      timetable: fixture.listensTo('timetableEntries'),
      availability: fixture.listensTo('specialCourses/error-test-course/teacherAvailability'),
    };
  }, fixtureUrl);
  assert.deepEqual(observations, { listeners: expectedListeners, timetable: false, availability: false });
  await logOut(page);
}

module.exports = { sessionPrivacy, maintenanceReadFailure };
