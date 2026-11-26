const assert = require('node:assert/strict');
const { adjust, fixtureUrl } = require('./harness.cjs');

async function seasonalCourses({ page, openApplication, logIn }) {
  const courseId = 'old-winter';
  const coursePath = `specialCourses/${courseId}`;
  const availabilityPath = `${coursePath}/teacherAvailability/teacher`;
  const deadline = '2030-01-01T00:00:00.000Z';
  const course = {
    type: 'winter',
    name: '冬季講習',
    startDate: '2025-12-20',
    endDate: '2026-01-10',
    periods: [{ start: '17:30', end: '18:25' }],
    availabilityDeadline: { testTimestamp: deadline },
  };
  const availability = { slots: ['2025-12-20_0'] };
  await openApplication(page);
  await adjust(page, { [coursePath]: course, [availabilityPath]: availability });
  await page.evaluate(
    async ({ courseId, coursePath, deadline, fixtureUrl }) => {
      const { fixture } = await import(fixtureUrl);
      fixture.handleCallable('seasonalAuthorityApi', (request) => {
        const protocol = { protocolVersion: 3 };
        if (request.action === 'capabilities') return { ...protocol, operations: ['patchCourse'] };
        if (request.courseId !== courseId) throw new Error(`Unexpected test course ${request.courseId}`);
        const record = fixture.getRecord(coursePath);
        if (request.action === 'inspectCourse')
          return {
            ...protocol,
            course: {
              token: 'course-token',
              value: { ...record, availabilityDeadline: { __shiftlyType: 'timestamp', value: deadline } },
            },
            entries: {},
            meta: {},
          };
        if (request.action !== 'patchCourse' || request.expected !== 'course-token') {
          throw new Error(`Unexpected seasonal test call ${request.action}`);
        }
        fixture.setRecords({ [coursePath]: { ...record, ...request.patch } });
        return { ...protocol, ok: true, version: 1, changed: 1 };
      });
    },
    { courseId, coursePath, deadline, fixtureUrl },
  );
  await logIn(page, 'admin');
  const coursesTab = page.locator('#navCourses');
  const overview = page.locator('#availabilityPeriodOverview');
  await coursesTab.click();
  await page.locator('#coursesOpenAvailability').click();
  await page.locator('#availabilityPerson').selectOption('teacher');
  await overview.getByText('受付中', { exact: true }).waitFor();
  assert.match(await overview.innerText(), /提出済み/);
  await coursesTab.click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '非表示にする', exact: true }).click();
  await page.waitForFunction(
    async ({ coursePath, fixtureUrl }) =>
      (await import(fixtureUrl)).fixture.getRecord(coursePath)?.archived === true,
    { coursePath, fixtureUrl },
  );
  await page.locator('#coursesOpenAvailability').click();
  assert.equal(await page.locator('#availabilityCourse option').count(), 0);
  assert.equal(await overview.innerText(), '');
  await coursesTab.click();
  await page.locator('#coursesOpenEditor').click();
  assert.equal(await page.locator('#editorCourse option').count(), 0);
  assert.equal(await page.locator('#courseEditorPage').isVisible(), false);
  await page
    .locator('#shiftlyNotice')
    .getByText('先に講習期間を登録してください。', { exact: true })
    .waitFor();
  await page.locator('#shiftlyNoticeClose').click();
  await page.getByRole('button', { name: /非表示一覧/ }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /再表示する/ }).click();
  await page.waitForFunction(
    async ({ coursePath, fixtureUrl }) =>
      (await import(fixtureUrl)).fixture.getRecord(coursePath)?.archived === false,
    { coursePath, fixtureUrl },
  );
  await page.locator('#coursesOpenAvailability').click();
  await page.locator('#availabilityPerson').selectOption('teacher');
  await overview.getByText('2025年度 冬期講習', { exact: true }).waitFor();
  await overview.getByText('✓ 提出済み', { exact: true }).waitFor();
  const persisted = await page.evaluate(
    async ({ availabilityPath, fixtureUrl }) => {
      const { fixture } = await import(fixtureUrl);
      return { availability: fixture.getRecord(availabilityPath), direct: fixture.directWrites.length };
    },
    { availabilityPath, fixtureUrl },
  );
  assert.deepEqual(persisted, { availability, direct: 0 });
}

module.exports = { seasonalCourses };
