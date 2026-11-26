import { datePlus, localDateFromKey, WEEKDAYS } from './calendar-date.js';
import { schoolClosureForDate } from './school-calendar.js';
import { canReceiveLesson } from './student-enrollment.js';
import { academicYearForDate } from './student-grade.js';

export const CLASS_PERIODS = [
  { number: 1, start: '17:30', end: '18:25' },
  { number: 2, start: '18:30', end: '19:25' },
  { number: 3, start: '19:30', end: '20:25' },
  { number: 4, start: '20:30', end: '21:25' },
];

export function everySlot(student) {
  return Object.values(student.regularSlots || {}).filter(slot => slot && typeof slot === 'object');
}

export function slotDescription(slot) {
  return `${WEEKDAYS[Number(slot.weekday)] || '?'}曜 ${slot.start}〜${slot.end}`;
}

export function formatRegular(slots) {
  return Object.values(slots).map(slotDescription).join(' / ');
}

function courseIncludesDate(course, date) {
  return course.startDate <= date && date <= course.endDate;
}

export function courseForDate(courses, date) {
  return courses.find(course => courseIncludesDate(course, date)) || null;
}

export function coursesOverlapOnDate(courses, date) {
  return courses.filter(course => courseIncludesDate(course, date)).length > 1;
}

export function courseDisplayName(course) {
  const year = course?.startDate ? academicYearForDate(course.startDate) : '';
  // Existing Firestore records can still contain the former winter label.
  const name = String(course?.name || '講習').replace(/冬季講習/g, '冬期講習').replace(/期間$/, '');
  return year ? `${year}年度 ${name}` : name;
}

function matchesRegularSlot(slot, date, weekday) {
  return slot && Number(slot.weekday) === weekday
    && (!slot.activeFrom || date >= slot.activeFrom)
    && (!slot.activeUntil || date <= slot.activeUntil);
}

function isVisibleEntry(entry, students, today, weekday) {
  // Keep historical records and one-off lessons. A saved future occurrence
  // can be obsolete after its parent weekly slot is removed or moved.
  if (!entry.regularId || entry.date < today) return true;
  const student = students.find(student => student.id === entry.studentId);
  return matchesRegularSlot(student?.regularSlots?.[entry.regularId], entry.date, weekday);
}

export function resolveLessonsOnDate({ entries, courses, students, people }, date, today) {
  const coursesOnDate = courses.filter(course => courseIncludesDate(course, date));
  if (coursesOnDate.length > 1) return [];
  const [course] = coursesOnDate;
  const weekday = localDateFromKey(date).getDay();
  const stored = entries.filter(entry => entry.date === date
    && isVisibleEntry(entry, students, today, weekday)
    && (course ? entry.courseId === course.id : !entry.courseId));
  // Regular lessons remain stored during a special course and are hidden
  // until the date is outside its period.
  if (course) return stored;

  const storedIds = new Set(stored.map(entry => entry.id));
  const lessons = [...stored];
  for (const student of students) {
    if (!canReceiveLesson(student, date)) continue;
    for (const slot of everySlot(student)) {
      if (!matchesRegularSlot(slot, date, weekday)) continue;
      const id = `rec_${student.id}_${slot.id}_${date}`;
      if (storedIds.has(id)) continue;
      const alreadyScheduled = stored.some(entry => entry.studentId === student.id
        && entry.start === slot.start && entry.end === slot.end);
      if (alreadyScheduled) continue;
      const teacher = people.find(person => person.id === slot.teacherUid);
      lessons.push({
        id,
        regularId: slot.id,
        virtual: true,
        studentId: student.id,
        studentName: student.name,
        grade: student.grade,
        school: student.school,
        teacherUid: slot.teacherUid,
        teacherName: teacher?.name || '担当教師',
        date,
        start: slot.start,
        end: slot.end,
        subject: slot.subject,
        status: 'scheduled',
        memo: '',
        nextDates: [],
      });
    }
  }
  return lessons;
}

export function resolveLessonById(timetable, id, today) {
  const stored = timetable.entries.find(entry => entry.id === id);
  if (stored) return stored;
  // A weekly or monthly card can point to a generated lesson on another day.
  const occurrenceDate = /^rec_.+_(\d{4}-\d{2}-\d{2})$/.exec(id || '')?.[1];
  return resolveLessonsOnDate(timetable, occurrenceDate || timetable.date, today).find(entry => entry.id === id);
}

function regularPeriodRange(entry) {
  const first = CLASS_PERIODS.findIndex(period => period.start === entry.start);
  const last = CLASS_PERIODS.findIndex(period => period.end === entry.end);
  return first >= 0 && last >= first ? CLASS_PERIODS.slice(first, last + 1) : [];
}

export function splitLessonForDisplay(entry, courses) {
  if (entry.courseId) {
    const course = courses.find(course => course.id === entry.courseId);
    const periodIndex = course?.periods.findIndex(period => period.start === entry.start && period.end === entry.end) ?? -1;
    return [{ ...entry, displayPeriod: periodIndex >= 0 ? periodIndex + 1 : undefined }];
  }
  const periods = regularPeriodRange(entry);
  if (!periods.length) return [entry];
  // Every displayed segment opens the same saved lesson and memo.
  return periods.map((period, index) => ({
    ...entry,
    start: period.start,
    end: period.end,
    displayPeriod: period.number,
    splitIndex: index + 1,
    splitTotal: periods.length,
    sourceLessonId: entry.id,
  }));
}

function lessonPeriodCount(entry) {
  return entry.courseId ? 1 : regularPeriodRange(entry).length || 1;
}

function canJoinVisits(course, previousEnd, nextStart) {
  const [endHour, endMinute] = previousEnd.split(':').map(Number);
  const [startHour, startMinute] = nextStart.split(':').map(Number);
  const gap = (startHour * 60 + startMinute) - (endHour * 60 + endMinute);
  if (gap < 0 || gap > 15) return false;
  if (!course) return true;
  // Consecutive course periods may be part of the same visit.
  const previousPeriod = course.periods.findIndex(period => period.end === previousEnd);
  const nextPeriod = course.periods.findIndex(period => period.start === nextStart);
  return previousPeriod >= 0 && nextPeriod === previousPeriod + 1;
}

export function upcomingVisits(timetable, lesson, today) {
  const dates = new Set(timetable.entries
    .filter(entry => entry.studentId === lesson.studentId && entry.date > lesson.date)
    .map(entry => entry.date));
  for (let offset = 1; offset <= 112; offset++) dates.add(datePlus(lesson.date, offset));

  const visits = [];
  for (const date of [...dates].sort()) {
    const entries = resolveLessonsOnDate(timetable, date, today)
      .filter(entry => entry.studentId === lesson.studentId && entry.status !== 'cancelled' && entry.start && entry.end)
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    if (!entries.length) continue;
    const closure = schoolClosureForDate(timetable, date);
    const course = courseForDate(timetable.courses, date);
    const courseName = course?.name || '';
    if (closure) {
      // Keep the original times visible when the school is closed.
      const times = new Set(entries.map(entry => `${entry.start}〜${entry.end}`));
      visits.push({ date, closed: true, note: closure.note || '', timeText: [...times].join('、'), courseName });
    } else {
      let current = null;
      for (const entry of entries) {
        const periods = lessonPeriodCount(entry);
        if (current && canJoinVisits(course, current.end, entry.start)) {
          if (entry.end > current.end) current.end = entry.end;
          current.periods += periods;
        } else {
          if (current) visits.push(current);
          current = { date, start: entry.start, end: entry.end, periods, courseName };
        }
      }
      if (current) visits.push(current);
    }
    if (visits.length >= 3) break;
  }
  return visits.slice(0, 3);
}
