const assert = require('node:assert/strict');
const { test } = require('node:test');

const calendar = import('../calendar-date.js');
const schoolCalendar = import('../school-calendar.js');
const timetable = import('../timetable.js');

function school(overrides = {}) {
  return {
    courses: [],
    entries: [],
    students: [],
    people: [],
    closures: {},
    openDays: {},
    examEvents: {},
    date: '2026-11-30',
    ...overrides,
  };
}

function lesson(id, date, overrides = {}) {
  return {
    id,
    date,
    start: '17:30',
    end: '18:25',
    status: 'scheduled',
    studentId: 'student',
    ...overrides,
  };
}

function weeklyStudent(overrides = {}) {
  return {
    id: 'student',
    name: 'サンプル生徒',
    regularSlots: {
      slot: {
        id: 'slot',
        weekday: '1',
        start: '17:30',
        end: '18:25',
        teacherUid: 'teacher',
        activeFrom: '2026-11-23',
        activeUntil: '2026-12-14',
      },
    },
    ...overrides,
  };
}

test('Japan day boundary, day arithmetic and Monday-first weeks', async () => {
  const { dateKey, datePlus, japanDateKey, localDateFromKey, prettyDate, shiftMonth, startOfWeek } = await calendar;
  assert.equal(japanDateKey(new Date('2026-11-29T14:59:59.999Z')), '2026-11-29');
  assert.equal(japanDateKey(new Date('2026-11-29T15:00:00.000Z')), '2026-11-30');
  assert.equal(datePlus('2026-12-31', 1), '2027-01-01');
  assert.equal(dateKey(localDateFromKey('2026-03-08')), '2026-03-08');
  assert.equal(startOfWeek('2026-01-04'), '2025-12-29');
  assert.equal(shiftMonth('2028-01-31', 1), '2028-02-29');
  assert.equal(shiftMonth('2026-03-31', -1), '2026-02-28');
  assert.equal(prettyDate('2026-11-30'), '11月30日（月）');
  assert.equal(prettyDate('未定'), '未定');
});

test('Automatic and stored closures yield to special openings and exams', async () => {
  const { automaticClosure, schoolClosureForDate } = await schoolCalendar;
  const date = '2026-09-22';
  assert.equal(automaticClosure(date).holidayName, '国民の休日');
  assert.equal(automaticClosure('2026-05-06').holidayName, '振替休日');
  assert.equal(automaticClosure('2021-08-08').holidayName, '山の日');
  assert.equal(automaticClosure('2026-11-29').note, '日曜日のため休校');
  assert.equal(automaticClosure('2026-11-30'), null);
  assert.equal(automaticClosure('2100-01-01'), null);
  assert.equal(automaticClosure(''), null);

  const manual = { date, note: '手動設定' };
  const closures = { [date]: manual };
  assert.equal(schoolClosureForDate(school({ closures }), date), manual);
  assert.equal(schoolClosureForDate(school({ closures, openDays: { [date]: { date } } }), date), null);
  assert.equal(schoolClosureForDate(school({ examEvents: { [date]: { date, type: 'exam' } } }), date), null);
  assert.equal(schoolClosureForDate(school(), date).holidayName, '国民の休日');
});

test('Timetable resolves weekly slots, stored overrides and historical entries', async () => {
  const { resolveLessonById, resolveLessonsOnDate } = await timetable;
  const today = '2026-11-30';
  const historical = lesson('historical', '2026-11-23', { studentId: 'alumnus', regularId: 'removed' });
  const obsolete = lesson('obsolete', today, { studentId: 'alumnus', regularId: 'removed' });
  const cancelled = lesson('rec_student_slot_2026-12-07', '2026-12-07', {
    regularId: 'slot',
    status: 'cancelled',
  });
  const oneOff = lesson('one-off', '2026-12-14');
  const data = school({
    date: '2026-11-29',
    entries: [historical, obsolete, cancelled, oneOff],
    students: [weeklyStudent()],
    people: [{ id: 'teacher', name: 'サンプル講師' }],
  });

  const [generated] = resolveLessonsOnDate(data, today, today);
  assert.equal(generated.id, 'rec_student_slot_2026-11-30');
  assert.equal(generated.teacherName, 'サンプル講師');
  assert.equal(generated.virtual, true);
  assert.deepEqual(resolveLessonById(data, generated.id, today), generated);
  assert.equal(resolveLessonById(data, obsolete.id, today), obsolete);
  assert.deepEqual(resolveLessonsOnDate(data, '2026-11-23', today).map(entry => entry.id), [
    historical.id, 'rec_student_slot_2026-11-23',
  ]);
  assert.deepEqual(resolveLessonsOnDate(data, '2026-12-07', today), [cancelled]);
  assert.deepEqual(resolveLessonsOnDate(data, '2026-12-14', today), [oneOff]);
  assert.deepEqual(resolveLessonsOnDate(data, '2026-12-21', today), []);
});

test('Virtual lessons stop on the withdrawal date', async () => {
  const { resolveLessonsOnDate } = await timetable;
  const data = school({
    students: [weeklyStudent({ enrollmentStatus: 'withdrawn', withdrawnOn: '2026-12-07' })],
  });
  assert.equal(resolveLessonsOnDate(data, '2026-11-30', '2026-11-30').length, 1);
  assert.deepEqual(resolveLessonsOnDate(data, '2026-12-07', '2026-11-30'), []);
});

test('A course takes priority over regular lessons and conflicting dates render empty', async () => {
  const { courseDisplayName, courseForDate, coursesOverlapOnDate, resolveLessonsOnDate } = await timetable;
  const date = '2026-11-30';
  const course = { id: 'winter', name: '冬季講習期間', startDate: date, endDate: '2026-12-07' };
  const seasonal = lesson('seasonal', date, { courseId: course.id });
  const data = school({
    courses: [course],
    entries: [lesson('regular', date), seasonal],
    students: [weeklyStudent()],
  });

  assert.equal(courseDisplayName(course), '2026年度 冬期講習');
  assert.equal(courseForDate(data.courses, course.endDate), course);
  assert.equal(coursesOverlapOnDate(data.courses, date), false);
  assert.deepEqual(resolveLessonsOnDate(data, date, date), [seasonal]);

  const overlapping = { ...data, courses: [...data.courses, { ...course, id: 'other' }] };
  assert.equal(courseForDate(overlapping.courses, date), course);
  assert.equal(coursesOverlapOnDate(overlapping.courses, date), true);
  assert.deepEqual(resolveLessonsOnDate(overlapping, date, date), []);
});

test('Timetable cards retain the source lesson and split only known period boundaries', async () => {
  const { splitLessonForDisplay } = await timetable;
  const entry = lesson('double', '2026-11-30', { end: '19:25', memo: 'サンプル' });
  assert.deepEqual(splitLessonForDisplay(entry, []).map(card => [
    card.id, card.sourceLessonId, card.start, card.end, card.displayPeriod, card.splitIndex, card.splitTotal, card.memo,
  ]), [
    ['double', 'double', '17:30', '18:25', 1, 1, 2, 'サンプル'],
    ['double', 'double', '18:30', '19:25', 2, 2, 2, 'サンプル'],
  ]);

  const custom = { ...entry, start: '17:45' };
  assert.equal(splitLessonForDisplay(custom, [])[0], custom);
  const course = { id: 'winter', periods: [{ start: '16:00', end: '17:00' }, { start: '17:30', end: '19:25' }] };
  const seasonal = { ...entry, courseId: course.id };
  assert.deepEqual(splitLessonForDisplay(seasonal, [course]), [{ ...seasonal, displayPeriod: 2 }]);
});

test('Upcoming visits join adjacent periods, retain closure times and cap the list', async () => {
  const { upcomingVisits } = await timetable;
  const active = lesson('current', '2026-11-30');
  const firstDate = '2026-12-01';
  const secondDate = '2026-12-02';
  const thirdDate = '2026-12-03';
  const course = {
    id: 'winter',
    name: '冬期講習',
    startDate: thirdDate,
    endDate: thirdDate,
    periods: [
      { start: '17:30', end: '18:25' },
      { start: '18:27', end: '18:29' },
      { start: '18:30', end: '19:25' },
    ],
  };
  const data = school({
    courses: [course],
    entries: [
      active,
      lesson('second-period', firstDate, { start: '18:30', end: '19:25' }),
      lesson('cancelled', '2026-12-04', { status: 'cancelled' }),
      lesson('first-period', firstDate),
      lesson('closed', secondDate),
      lesson('closed-duplicate', secondDate),
      lesson('seasonal-first', thirdDate, { courseId: course.id }),
      lesson('seasonal-third', thirdDate, { courseId: course.id, start: '18:30', end: '19:25' }),
    ],
    closures: { [secondDate]: { note: '休校メモ' } },
  });

  assert.deepEqual(upcomingVisits(data, active, active.date), [
    { date: firstDate, start: '17:30', end: '19:25', periods: 2, courseName: '' },
    { date: secondDate, closed: true, note: '休校メモ', timeText: '17:30〜18:25', courseName: '' },
    { date: thirdDate, start: '17:30', end: '18:25', periods: 1, courseName: '冬期講習' },
  ]);
  assert.deepEqual(upcomingVisits(school({ entries: [
    lesson('cancelled', firstDate, { status: 'cancelled' }),
    lesson('long-range', '2027-06-01'),
  ] }), active, active.date), [
    { date: '2027-06-01', start: '17:30', end: '18:25', periods: 1, courseName: '' },
  ]);
});
