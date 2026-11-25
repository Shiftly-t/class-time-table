'use strict';
const {isDeepStrictEqual} = require('node:util');
const {createHash} = require('node:crypto');
const {lessonValue, datedValue, projectDateSource} = require('./ranking-date-source.cjs');

const datedRoots = new Set(['teacherDayAbsences','teacherDateWork','schoolClosures','schoolOpenDays','schoolEvents']);
const datedWorkRoots = new Set(['teacherDayAbsences','teacherDateWork']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const sourceDate = value => typeof value === 'string' && datePattern.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const jstDate = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const midnightAfter = date => Date.parse(date + 'T00:00:00+09:00') + 86400000;

function createRankingAuthority({coor}) {
  const {db, fail, rawDb} = coor;
  if (rawDb.projectId !== 'shiftly-t-test' || rawDb.databaseId !== 'shiftly-qa-v1') throw Error('QA_RANKING_TARGET_MISMATCH');
  const invalid = code => fail('failed-precondition', code);
  const sizeCheck = value => {
    if (Buffer.byteLength(JSON.stringify(value)) > 400000) invalid('RANKING_DOCUMENT_SIZE_LIMIT');
  };

  async function collectDatedChanges() {
    const dates = new Map();
    function push(date, change) {
      if (!sourceDate(date)) invalid('RANKING_INVALID_SOURCE_DATE');
      if (!dates.has(date)) dates.set(date, []);
      dates.get(date).push(change);
    }
    for (const path of coor.writes().keys()) {
      const [root, id, sub] = path.split('/');
      if (sub || (root !== 'timetableEntries' && !datedRoots.has(root))) continue;
      const after = await coor.effective(path), before = coor.baseline(path);
      if (root === 'timetableEntries') {
        const old = lessonValue(before, id), next = lessonValue(after, id);
        if (isDeepStrictEqual(old, next)) continue;
        for (const date of new Set([old?.date, next?.date].filter(Boolean))) {
          push(date, {root, id, old: old?.date === date ? old : null, next: next?.date === date ? next : null});
        }
      } else {
        const old = datedValue(root, before), next = datedValue(root, after);
        if (isDeepStrictEqual(old, next)) continue;
        push(datedWorkRoots.has(root) ? id.slice(0,10) : id, {root, id, old, next});
      }
    }
    return dates;
  }

  async function applySourceChange(source, change) {
    const {root, id, old, next} = change;
    if (root === 'timetableEntries') {
      const index = source.stored.findIndex(entry => entry.id === id);
      if (!isDeepStrictEqual(source.stored[index] ?? null, old)) invalid('RANKING_LESSON_BASELINE_CONFLICT');
      if (next) {
        if ((next.courseId ?? null) !== (source.course?.id ?? null)) invalid('RANKING_COURSE_BASELINE_CONFLICT');
        if (id.startsWith('rec_') && !old && !source.recurring.some(entry => entry.id === id && entry.studentId === next.studentId)) {
          invalid('RANKING_WEEKLY_OCCURRENCE_NOT_ARCHIVED');
        }
        if (next.status !== 'cancelled') {
          const learner = await coor.effective('schoolStudents/' + next.studentId);
          if (!learner || !require('./enrollment.cjs').allows(learner, source.date)) invalid('RANKING_STUDENT_NOT_ENROLLED');
        }
      }
      if (index >= 0) source.stored.splice(index, 1);
      if (next) source.stored.push(next);
    } else if (datedWorkRoots.has(root)) {
      const uid = id.slice(11), field = root === 'teacherDateWork' ? 'daily' : 'absence';
      const settings = Object.hasOwn(source.work, uid) ? source.work[uid] : null;
      if (!settings || !isDeepStrictEqual(settings[field], old)) invalid('RANKING_WORK_BASELINE_CONFLICT');
      settings[field] = next;
    } else {
      if (!isDeepStrictEqual(source.calendar[root], old)) invalid('RANKING_CALENDAR_BASELINE_CONFLICT');
      source.calendar[root] = next;
    }
  }

  async function beforeCommit(ctx, {restorePlanning = false} = {}) {
    const runtime = (await coor.get('rankingInternalConfig/runtime')).data();
    const active = runtime?.enabled === true && runtime.correctionIntegrationVerified === true;
    const today = jstDate(ctx.now);
    const dates = await collectDatedChanges();
    const verifiedNormalLessons = new Set();
    for (const [date, changes] of dates) {
      if (date > today) continue;
      const snapshotRef = db.doc('rankingInternalSnapshots/' + date), dayRef = db.doc('rankingInternalDays/' + date);
      const [captured, current] = await Promise.all([snapshotRef.get(), dayRef.get()]).then(result => result.map(doc => doc.data()));
      if (!captured && !current) {
        if (!active || runtime.automationEnabled !== true || date === today) continue;
        if (!sourceDate(runtime.trackingStart)) invalid('RANKING_INVALID_TRACKING_START');
        if (date < runtime.trackingStart) continue;
      }
      if (restorePlanning) invalid('RANKING_RESTORE_CHANGES_TRACKED_DATE');
      if (!captured || captured.source?.schema !== 1 || captured.source.date !== date) invalid('RANKING_MISSING_DATE_SOURCE');
      if (current) {
        const sortFacts = facts => Array.isArray(facts) ? [...facts].sort((a,b)=>a.slotId.localeCompare(b.slotId)) : null;
        if (current.date !== date || !Number.isSafeInteger(current.revision) || current.revision < 1 ||
            !Array.isArray(captured.facts) || !isDeepStrictEqual(sortFacts(current.facts),sortFacts(captured.facts))) {
          invalid('RANKING_LEDGER_BASELINE_CONFLICT');
        }
      }
      const source = structuredClone(captured.source);
      const normal = ctx.domain === 'normal' && ['day','move','work','calendar'].includes(ctx.action);
      const calendar = ctx.domain === 'seasonal' && ctx.action === 'saveCalendar' &&
        changes.every(change => !datedWorkRoots.has(change.root) && change.root !== 'timetableEntries');
      const seasonal = ['admin','seasonal'].includes(ctx.domain) && (
        calendar || ctx.rankingCorrection?.date === date ||
        (date === today && ctx.role && changes.every(change => change.root === 'timetableEntries' &&
          (change.old?.courseId || change.next?.courseId))));
      if (!['admin','owner'].includes(ctx.role) || (!normal && !seasonal)) invalid('RANKING_DATE_EDIT_REQUIRES_VERIFIED_CORRECTION');
      for (const change of changes) await applySourceChange(source, change);

      const now = new Date(ctx.now).toISOString();
      const projectionTime = new Date(Math.min(ctx.now, midnightAfter(date) - 1)).toISOString();
      const cutoff = new Date(midnightAfter(date)).toISOString();
      const {snapshot, teachers} = projectDateSource(source, projectionTime);
      const [{deriveDailyRanking},{archiveRankingTeachers},{planDateCorrection}] = await Promise.all([
        import('./ranking-daily.mjs'), import('./ranking-roster.mjs'), import('./ranking-correction.mjs')
      ]);
      const next = deriveDailyRanking({snapshot,teachers,trackingStart:date,cutoff});
      if (!next.canPublish) invalid('RANKING_CORRECTION_PROJECTION_INVALID');
      const operationId = 'authority:' + createHash('sha256').update(JSON.stringify([ctx.domain,ctx.actor,ctx.req.data.requestId])).digest('hex');
      const reason = ctx.rankingCorrection?.reason || '日付指定の授業・勤務・開校設定の訂正';
      const teacherRoster = archiveRankingTeachers({facts:next.facts,teachers,previous:captured.teacherRoster});
      if (active && normal && ctx.action === 'day') {
        for (const entry of changes) {
          if (entry.root === 'timetableEntries' && entry.old && !entry.old.courseId &&
              (!entry.next || !entry.next.courseId)) verifiedNormalLessons.add('timetableEntries/' + entry.id);
        }
      }
      const pending = {...captured,source,teacherRoster,facts:next.facts,correctedAt:now};
      sizeCheck(pending);
      if (!current) {
        const op = {date,operationId,actor:ctx.actor,reason,at:now,kind:'pending-date-correction'};
        const opKey = createHash('sha256').update(JSON.stringify([date,operationId])).digest('hex');
        await db.doc('rankingInternalOperations/' + opKey).create(op);
        await db.doc('rankingInternalAudit/' + date + '_pending_' + opKey).create(op);
        await snapshotRef.set(pending);
        continue;
      }

      const change = planDateCorrection({date,current,beforeFacts:captured.facts,afterFacts:next.facts,actor:ctx.actor,
        actorRole:ctx.role,operationId,reason,now});
      if (change.state === 'planned') {
        const {day,operation,audit,refresh,revision} = change.result;
        day.teacherRoster = archiveRankingTeachers({facts:day.facts,teachers,previous:current.teacherRoster});
        const opKey = createHash('sha256').update(JSON.stringify([date,operationId])).digest('hex');
        for (const record of [day,operation,audit,refresh]) sizeCheck(record);
        await dayRef.set(day);
        await db.doc('rankingInternalOperations/' + opKey).create(operation);
        await db.doc('rankingInternalAudit/' + date + '_' + revision).create(audit);
        await db.doc('rankingInternalRefresh/' + date + '_' + revision).create({...refresh,status:'pending',createdAt:now});
      }
      await snapshotRef.set(pending);
    }
    return verifiedNormalLessons;
  }
  return {beforeCommit};
}
module.exports = {createRankingAuthority};
