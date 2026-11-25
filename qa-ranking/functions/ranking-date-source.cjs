'use strict';
const policy = require('./normal-authority/policy.cjs');
const {automaticClosure} = require('./normal-authority/calendar.cjs');

function lessonValue(value, id) {
  if (!value) return null;
  const {date, studentId, teacherUid, start, end, status, courseId} = value;
  if (!['scheduled', 'done', 'cancelled'].includes(status)) throw Error('RANKING_UNKNOWN_STATUS');
  return {id, date, studentId, teacherUid, start, end, status: status === 'cancelled' ? status : 'scheduled',
    ...(courseId ? {courseId} : {})};
}

function datedValue(root, value) {
  if (!value) return null;
  if (root === 'teacherDayAbsences') return policy.numbers(value.absentPeriods, 4);
  if (root === 'teacherDateWork') return policy.numbers(value.availablePeriods, 4);
  if (root === 'schoolEvents') return value.type === 'exam' ? true : null;
  return true;
}

function projectDateSource(source, capturedAt) {
  const {date, stored, recurring, course, calendar, work, availability, teachers, courseClosed} = source;
  const closed = Boolean(courseClosed || (!calendar.schoolOpenDays && !calendar.schoolEvents &&
    (calendar.schoolClosures || automaticClosure(date))));
  const snapshot = {date, capturedAt, complete: true, closed, entries: [], courses: course ? [course] : [], unavailableSlots: []};
  if (course) {
    snapshot.entries = stored.filter(entry => entry.courseId === course.id && entry.status !== 'cancelled');
    for (const entry of snapshot.entries) {
      const index = course.periods.findIndex(period => period.start === entry.start && period.end === entry.end);
      if (closed || index < 0 || !availability[entry.teacherUid]?.includes(index)) throw Error('RANKING_SEASONAL_DATE_CONFLICT');
    }
    return {snapshot, teachers};
  }
  const rows = stored.filter(entry => !entry.courseId);
  const ids = new Set(rows.map(entry => entry.id));
  const occupied = new Set(rows.map(entry => JSON.stringify([entry.studentId, entry.start, entry.end])));
  snapshot.entries = rows.concat(recurring.filter(entry => !ids.has(entry.id) &&
    !occupied.has(JSON.stringify([entry.studentId, entry.start, entry.end]))));
  snapshot.unavailableEntries = snapshot.entries.filter(entry => {
    const settings = Object.hasOwn(work, entry.teacherUid) ? work[entry.teacherUid] : null;
    return settings && policy.periods(entry).length === 0 && (settings.daily !== null || !settings.weeklyOutside);
  }).map(entry => entry.id);
  for (const {uid} of teachers) {
    const settings = work[uid];
    if (!settings) throw Error('RANKING_MISSING_FROZEN_WORK');
    for (const [i, [start, end]] of policy.PERIODS.entries()) {
      if (settings.absence?.includes(i + 1) || !(settings.daily ?? settings.weekly).includes(i + 1)) {
        snapshot.unavailableSlots.push({teacherUid: uid, start, end});
      }
    }
  }
  return {snapshot, teachers};
}

module.exports = {lessonValue, datedValue, projectDateSource};
