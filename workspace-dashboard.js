import { todayKey, prettyDate } from './calendar-date.js';
import { CLASS_PERIODS } from './timetable.js';
import { isWithdrawn } from './student-enrollment.js';
import { summarizeDay, searchDirectory } from './workspace-ux.js?v=20261126-ux2';

export function installWorkspaceDashboard({
  state,
  directoryReady,
  $,
  make,
  isAdmin,
  isOwner,
  isAssignableTeacher,
  teacherWorkFeatureEnabled,
  teacherWorkDataReady,
  hasCourseConflict,
  closureFor,
  courseFor,
  visibleLessonsOnDate,
  nav,
  openStudent,
  openScheduleDay,
}) {
  function dashboardCanRead() {
    return isAdmin() && Boolean(state.user) && !$('appPanel').hidden;
  }
  function renderDashboard() {
    if (!dashboardCanRead()) return;
    const date = todayKey();
    $('dashboardDate').dataset.date = date;
    $('dashboardDate').textContent = date.slice(0, 4) + '年' + prettyDate(date);
    const ready =
      directoryReady.students &&
      directoryReady.people &&
      ['entriesStatus', 'closuresStatus', 'openDaysStatus', 'examStatus', 'coursesStatus'].every(
        (k) => state[k] === 'ready',
      ) &&
      !hasCourseConflict(date);
    const teacherReady = ready && teacherWorkDataReady() && state.teacherAbsencesStatus === 'ready';
    const periodList = courseFor(date)?.periods || CLASS_PERIODS;
    const periods = periodList.map((p, i) => ({ ...p, number: p.number || i + 1 }));
    const rows = ready ? visibleLessonsOnDate(date) : [];
    const summary = summarizeDay(
      rows,
      periods,
      new Set(state.people.filter((p) => isAssignableTeacher(p.role)).map((p) => p.id)),
    );
    $('dashboardLessonCount').textContent = ready ? String(summary.lessons) : '—';
    $('dashboardTeacherCount').textContent = teacherReady ? String(summary.teachers) : '—';
    $('dashboardStatus').textContent = !ready
      ? '時間割データの確認中、または取得できない項目があります。'
      : closureFor(date)
        ? '本日は休校日です。'
        : !teacherReady
          ? '講師勤務・欠席情報の確認中です。'
          : '';
    const bars = $('dashboardPeriods');
    bars.replaceChildren();
    if (ready) {
      const max = Math.max(1, ...summary.counts.map((p) => p.count));
      for (const item of summary.counts) {
        const row = make('div', 'dashboard-period-row');
        const heading = make('div', 'dashboard-period-label');
        heading.append(
          make('span', '', item.label + '　' + item.time),
          make('strong', '', item.count + 'コマ'),
        );
        const track = make('div', 'dashboard-track'),
          bar = make('div', 'dashboard-bar');
        bar.style.width = (100 * item.count) / max + '%';
        track.append(bar);
        row.append(heading, track);
        bars.append(row);
      }
    } else bars.append(make('p', 'muted', '時間割の確認が完了すると表示します。'));
    $('dashboardTeacherLink').hidden = !teacherWorkFeatureEnabled;
    $('dashboardSystemLink').hidden = !isOwner();
    $('dashboardRankingLink').hidden = $('rankingButton').hidden;
    $('dashboardBookingLink').hidden = $('navBookingManagement')?.hidden !== false;
    renderDashboardSearch();
  }
  function renderDashboardSearch() {
    const results = $('dashboardSearchResults');
    results.replaceChildren();
    if (!dashboardCanRead()) return;
    const q = $('dashboardSearch').value.trim();
    if (!q) return;
    if (!directoryReady.students || !directoryReady.people) {
      results.append(make('p', 'muted', '検索対象を読み込んでいます…'));
      return;
    }
    const matches = searchDirectory(
      q,
      state.students.filter((s) => !isWithdrawn(s)),
      state.people.filter((p) => isAssignableTeacher(p.role)),
    );
    if (!matches.length) {
      results.append(make('p', 'muted', '一致する生徒・講師がいません。'));
      return;
    }
    for (const item of matches) {
      const b = make('button', 'dashboard-search-result');
      b.type = 'button';
      b.append(
        make('strong', '', item.name || '名称未登録'),
        make('small', '', item.type === 'student' ? '生徒 ' + item.detail : '講師'),
      );
      b.addEventListener('click', () => {
        if (!dashboardCanRead()) return;
        if (item.type === 'student') {
          nav('count');
          if (state.page === 'count') openStudent(item.id);
        } else if (teacherWorkFeatureEnabled) {
          nav('teacherManagement');
          if (state.page === 'teacherManagement') {
            const select = $('workTeacher');
            if ([...select.options].some((o) => o.value === item.id)) {
              select.value = item.id;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        } else {
          nav('adminSchedule');
        }
      });
      results.append(b);
    }
  }
  $('dashboardSearch').addEventListener('input', renderDashboardSearch);
  $('dashboardAddStudent').addEventListener('click', () => {
    if (dashboardCanRead()) {
      nav('count');
      if (state.page === 'count') openStudent('');
    }
  });
  $('dashboardScheduleLink').addEventListener('click', () => {
    if (dashboardCanRead()) {
      nav('adminSchedule');
      if (state.page === 'adminSchedule') openScheduleDay(todayKey());
    }
  });
  $('dashboardTeacherLink').addEventListener('click', () => {
    if (dashboardCanRead() && teacherWorkFeatureEnabled) nav('teacherManagement');
  });
  $('dashboardBookingLink').addEventListener('click', () => {
    if (dashboardCanRead() && !$('navBookingManagement')?.hidden) nav('bookingManagement');
  });
  $('dashboardRankingLink').addEventListener('click', () => {
    if (dashboardCanRead() && !$('rankingButton').hidden) $('rankingButton').click();
  });
  $('dashboardSystemLink').addEventListener('click', () => {
    if (dashboardCanRead() && isOwner()) nav('maintenanceOwner');
  });

  return renderDashboard;
}
