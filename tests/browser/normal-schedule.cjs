const assert = require('node:assert/strict');
const { adjust, fixtureUrl } = require('./harness.cjs');

const entryId = 'rec_student-a_weekly_2026-11-12';
const absencePath = 'teacherDayAbsences/2026-11-12_teacher';
const entryPath = `timetableEntries/${entryId}`;

async function installNormalBackend(page, date) {
  await page.evaluate(
    async ({ date, entryId, entryPath, absencePath, fixtureUrl }) => {
      const { fixture } = await import(fixtureUrl);
      let pendingInspection = null;
      window.holdNormalInspection = () => {
        let resume;
        pendingInspection = new Promise((resolve) => {
          resume = resolve;
        });
        window.releaseNormalInspection = resume;
      };
      fixture.handleCallable('normalAuthorityApi', async (request) => {
        const contract = { protocolVersion: 1, version: 1 };
        if (request.date !== date) throw new Error(`Unexpected test date ${request.date}`);
        if (request.kind === 'inspect') {
          const conflictingTeacherName = await pendingInspection;
          pendingInspection = null;
          const entry = fixture.getRecord(entryPath);
          const absence = fixture.getRecord(absencePath);
          return {
            ...contract,
            entries: entry
              ? {
                  [entryId]: {
                    token: 'stored-entry',
                    value: {
                      ...entry,
                      ...(conflictingTeacherName && { teacherName: conflictingTeacherName }),
                    },
                  },
                }
              : {},
            absences: absence ? { teacher: { token: 'teacher-absence', value: absence } } : {},
            calendar: {},
            virtuals: {
              [entryId]: {
                token: 'weekly-entry',
                value: {
                  studentId: 'student-a',
                  regularId: 'weekly',
                  date,
                  start: '19:30',
                  end: '21:25',
                  teacherUid: 'teacher',
                  subject: '数学',
                  status: 'scheduled',
                },
              },
            },
          };
        }
        if (request.kind !== 'day') throw new Error(`Unexpected normal call ${request.kind}`);
        const records = {};
        for (const { teacherUid, periods } of request.absences) {
          records[`teacherDayAbsences/${date}_${teacherUid}`] = { date, teacherUid, absentPeriods: periods };
        }
        for (const { id, value } of request.changes) records[`timetableEntries/${id}`] = value;
        fixture.setRecords(records);
        return { ...contract, changed: request.changes.length + request.absences.length };
      });
    },
    { date, entryId, entryPath, absencePath, fixtureUrl },
  );
}

async function dragLesson(browserName, context, source, target) {
  if (browserName === 'chromium') {
    await source.scrollIntoViewIfNeeded();
    const cdp = await context.newCDPSession(source.page());
    try {
      const from = await source.boundingBox();
      const to = await target.boundingBox();
      const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      for (let fraction = 1; fraction <= 8; fraction += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: start.x + ((to.x + 30 - start.x) * fraction) / 8,
              y: start.y + ((to.y + 30 - start.y) * fraction) / 8,
            },
          ],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.detach();
    }
    return;
  }
  const to = await target.boundingBox();
  await source.evaluate(
    (element, point) => {
      const from = element.getBoundingClientRect();
      const pointer = { bubbles: true, isPrimary: true, pointerId: 10, pointerType: 'touch' };
      element.dispatchEvent(
        new PointerEvent('pointerdown', { ...pointer, clientX: from.x + 15, clientY: from.y + 15 }),
      );
      for (const type of ['pointermove', 'pointerup']) {
        element.dispatchEvent(new PointerEvent(type, { ...pointer, ...point }));
      }
    },
    { clientX: to.x + 25, clientY: to.y + 25 },
  );
}

async function callRecords(page) {
  return page.evaluate(async (url) => {
    const { fixture } = await import(url);
    return {
      directWrites: fixture.directWrites,
      daySaves: fixture.callLog.filter(({ request }) => request.kind === 'day').map(({ request }) => request),
      inspectCount: fixture.callLog.filter(({ request }) => request.kind === 'inspect').length,
    };
  }, fixtureUrl);
}

async function normalSchedule({ browserName, context, page, date, openApplication, logIn, logOut }) {
  await openApplication(page);
  await installNormalBackend(page, date);
  await logIn(page, 'admin');
  await page.locator('#navAdminLessons').click();
  await page.locator('#openNormalEditor').click();
  const cell = (uid, period) => page.locator(`.normal-cell[data-uid="${uid}"][data-period="${period}"]`);
  const lesson = (uid) => cell(uid, 3).locator('.normal-entry');
  const stageAbsence = async (name, period) => {
    await page.getByRole('button', { name, exact: true }).click();
    await page.locator(`#normalAbsenceOptions input[value="${period}"]`).check();
    await page.locator('#normalAbsenceForm button[type=submit]').click();
  };
  const publish = page.locator('#normalPublish');
  const closeNotice = async (expected) => {
    await page.locator('#shiftlyNotice[open]').waitFor();
    assert.match(await page.locator('#shiftlyNoticeText').innerText(), expected);
    await page.locator('#shiftlyNoticeClose').click();
  };

  await lesson('teacher').waitFor();
  await stageAbsence('試験用講師', 3);
  assert.equal(await cell('teacher', 3).getAttribute('class'), 'normal-cell is-absent');
  assert.equal(await cell('teacher', 4).getAttribute('class'), 'normal-cell');
  assert.equal((await callRecords(page)).daySaves.length, 0);

  await stageAbsence('別の講師', 4);
  await lesson('teacher').click();
  await cell('other', 3).click();
  assert.equal(await lesson('teacher').count(), 1);
  await closeNotice(/欠席/);
  await page.locator('#normalUndo').click();
  await dragLesson(browserName, context, lesson('teacher'), cell('other', 3));
  await lesson('other').waitFor();
  assert.equal(await lesson('other').count(), 1);
  await lesson('other').tap();
  assert.equal(await cell('other', 3).locator('.is-selected').count(), 1);
  await page.locator('#normalUndo').click();
  assert.equal(await lesson('teacher').count(), 1);

  page.once('dialog', (dialog) => dialog.accept());
  await publish.click();
  await page.waitForFunction(
    async ({ fixtureUrl, absencePath }) => Boolean((await import(fixtureUrl)).fixture.getRecord(absencePath)),
    { fixtureUrl, absencePath },
  );
  assert.deepEqual(
    (await callRecords(page)).daySaves[0].absences.map(({ periods }) => periods),
    [[3]],
  );
  await page.locator('#normalPreview').click();
  assert.equal(await page.locator('.lesson-card.is-teacher-absent').count(), 1);
  assert.equal(await page.locator('.lesson-card').filter({ hasText: '試験用生徒' }).count(), 2);
  await page.locator('#openNormalEditor').click();

  await lesson('teacher').click();
  await cell('other', 3).click();
  await page.evaluate(() => window.holdNormalInspection());
  await publish.click();
  assert.equal(await page.locator('#normalNext').isDisabled(), true);
  await page.locator('#navAdminLessons').click();
  assert.equal(await page.locator('#normalEditorPage').isVisible(), true);
  await closeNotice(/保存中/);
  await page.evaluate(() => window.releaseNormalInspection());
  await page.waitForFunction(
    async ({ fixtureUrl, entryPath }) =>
      (await import(fixtureUrl)).fixture.getRecord(entryPath)?.teacherUid === 'other',
    { fixtureUrl, entryPath },
  );
  await page.waitForFunction(() => !document.getElementById('normalNext').disabled);
  const weeklyOwner = await page.evaluate(
    async (url) =>
      (await import(url)).fixture.getRecord('schoolStudents/student-a').regularSlots.weekly.teacherUid,
    fixtureUrl,
  );
  assert.equal(weeklyOwner, 'teacher');
  const writes = await callRecords(page);
  assert.equal(writes.daySaves.length, 2);
  assert.equal(writes.daySaves[1].changes[0].expectedOccurrence, 'weekly-entry');
  assert.deepEqual(writes.directWrites, []);

  await adjust(page, {
    [absencePath]: null,
    'timetableEntries/capacity-a': {
      studentId: 'a',
      studentName: '定員確認A',
      date,
      start: '19:30',
      end: '20:25',
      teacherUid: 'teacher',
      teacherName: '試験用講師',
      status: 'scheduled',
    },
    'timetableEntries/capacity-b': {
      studentId: 'b',
      studentName: '定員確認B',
      date,
      start: '19:30',
      end: '20:25',
      teacherUid: 'teacher',
      teacherName: '試験用講師',
      status: 'scheduled',
    },
  });
  await cell('teacher', 3).getByText('定員確認B').waitFor();
  await lesson('other').click();
  await cell('teacher', 3).click({ position: { x: 10, y: 10 } });
  assert.equal(await lesson('other').count(), 1);
  await closeNotice(/担当上限/);
  await adjust(page, { 'timetableEntries/capacity-a': null, 'timetableEntries/capacity-b': null });
  await cell('teacher', 3).getByText('定員確認B').waitFor({ state: 'detached' });
  if (!(await lesson('other').getAttribute('class')).includes('is-selected')) await lesson('other').click();
  await cell('teacher', 3).click();
  await page.evaluate(() => window.holdNormalInspection());
  await publish.click();
  await page.evaluate(() => window.releaseNormalInspection('別端末の変更'));
  await page.waitForFunction(() => !document.getElementById('normalNext').disabled);
  assert.equal((await callRecords(page)).daySaves.length, 2);
  await closeNotice(/他の端末/);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#normalDiscard').click();
  await logOut(page);
  await logIn(page, 'other');
  await page.locator('.lesson-card').first().waitFor();
  assert.equal(await page.locator('.lesson-card').filter({ hasText: '試験用生徒' }).count(), 2);
  const dateInput = page.locator('#scheduleDateOpen');
  await dateInput.click();
  await page
    .locator('#scheduleDateGrid')
    .getByRole('button', { name: /2026年11月19日/ })
    .click();
  assert.equal(await page.locator('.lesson-card').count(), 0);
  await page.locator('#teacherFilter').selectOption('all');
  assert.equal(await page.locator('.lesson-card').filter({ hasText: '試験用講師' }).count(), 2);
}

module.exports = { normalSchedule };
