export function emptyWorkspaceRecords() {
  return {
    students: [],
    people: [],
    entries: [],
    entriesStatus: 'loading',
    closures: {},
    closuresStatus: 'loading',
    openDays: {},
    openDaysStatus: 'loading',
    examEvents: {},
    examStatus: 'loading',
    courses: [],
    coursesStatus: 'loading',
    notices: [],
  };
}

export function emptyTeacherWorkRecords(teacherWorkEnabled) {
  const workStatus = teacherWorkEnabled ? 'loading' : 'disabled';
  return {
    teacherWeeklyWork: {},
    teacherWeeklyWorkStatus: workStatus,
    teacherDateWork: {},
    teacherDateWorkStatus: workStatus,
  };
}

export function emptySessionRecords() {
  return {
    officialAnnouncements: [],
    officialSeenIds: new Set(),
    officialSeenReady: false,
    availability: new Map(),
    availabilityStatus: {},
    teacherAbsences: {},
    teacherAbsencesStatus: 'loading',
  };
}
