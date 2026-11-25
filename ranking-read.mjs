import {aggregateRanking,rankTeachers} from './ranking-core.mjs';
import {rankingWindow} from './ranking-view-model.mjs';
import {isRankingTeacherRole,isRankingTeacherUid,rankingTeacher,readArchivedRankingTeachers} from './ranking-roster.mjs';

const ONE_DAY = 86400000;
const JST_OFFSET = 9 * 3600000;
const FIRST_SUPPORTED_DATE = '2000-01-01';
const METRICS = ['slots','regular','seasonal','days','students'];
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
 Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const jstDate = time => new Date(time + JST_OFFSET).toISOString().slice(0,10);
const emptyCoverage = () => ({expected:0,recorded:0,complete:true,from:null,to:null});
const publicTotals = totals => Object.fromEntries(METRICS.map(key => [key,totals?.[key] ?? 0]));
const verifyQa = db => {
 if (db.projectId !== 'shiftly-t-test' || db.databaseId !== 'shiftly-qa-v1') throw Error('QA_RANKING_TARGET_MISMATCH');
};

function parseQuery(input,uid,window) {
 if (input && typeof input === 'object' && !Array.isArray(input)) {
  if (input.kind === 'profile' && Object.keys(input).every(key => ['kind','teacherUid'].includes(key))) {
   const teacherUid = input.teacherUid === undefined ? uid : input.teacherUid;
   if (isRankingTeacherUid(teacherUid)) return {kind:input.kind,teacherUid};
  }
  if (METRICS.includes(input.metric) && Object.keys(input).every(key => ['kind','key','metric'].includes(key))) {
   if (input.kind === 'cumulative' && (input.key === '' || input.key === undefined)) {
    return {kind:input.kind,metric:input.metric};
   }
   if (['month','year'].includes(input.kind) && typeof input.key === 'string') {
    return {kind:input.kind,metric:input.metric,period:window(input.kind,input.key)};
   }
  }
 }
 throw Error('INVALID_RANKING_QUERY');
}

// This helper runs inside the caller's server-side transaction. Its facts and roster contain
// private data. Callable responses must select only approved summaries and display names.
export async function readRankingLedger({tx,db,from,to,now}) {
 verifyQa(db);
 const time = Date.parse(now);
 if (!Number.isFinite(time) || !isDate(from) || !isDate(to) || (from <= to && to >= jstDate(time))) {
  throw Error('INVALID_RANKING_PERIOD');
 }

 const expected = from <= to ? Math.round((Date.parse(to) - Date.parse(from)) / ONE_DAY) + 1 : 0;
 const [users,days] = await Promise.all([
  tx.get(db.collection('users').limit(301)),
  expected ? tx.get(db.collection('rankingInternalDays').where('date','>=',from).where('date','<=',to).limit(expected + 1)) : {docs:[]}
 ]);
 if (users.docs.length > 300 || days.docs.length > expected) throw Error('RANKING_READ_LIMIT');

 const roster = new Map();
 for (const user of users.docs) {
  const role = user.get('role');
  if (isRankingTeacherRole(role)) roster.set(user.id,rankingTeacher({uid:user.id,role,name:user.get('name')}));
 }
 const historical = new Map();
 const recorded = new Set();
 const slotIds = new Set();
 const facts = [];
 for (const doc of days.docs) {
  const day = doc.data();
  if (doc.id !== day?.date || !isDate(day.date) || day.date < from || day.date > to || recorded.has(day.date) ||
      !Number.isSafeInteger(day.revision) || day.revision < 1 || !Array.isArray(day.facts) || day.facts.length > 4000) {
   throw Error('RANKING_INVALID_LEDGER');
  }
  if (facts.length + day.facts.length > 150000) throw Error('RANKING_FACT_LIMIT');

  recorded.add(day.date);
  const archive = readArchivedRankingTeachers(day.teacherRoster);
  const matchingTeachers = new Set();
  for (const fact of day.facts) {
   if (fact?.date !== day.date || fact.status !== 'done' || typeof fact.studentId !== 'string' || !fact.studentId ||
       typeof fact.slotId !== 'string' || !fact.slotId || slotIds.has(fact.slotId) || !isRankingTeacherUid(fact.teacherUid) ||
       !['regular','seasonal'].includes(fact.kind) || typeof fact.endedAt !== 'string' ||
       !Number.isFinite(Date.parse(fact.endedAt)) || Date.parse(fact.endedAt) > time) {
    throw Error('RANKING_INVALID_FACT');
   }
   slotIds.add(fact.slotId);
   matchingTeachers.add(fact.teacherUid);
   facts.push(fact);
  }
  for (const [uid,teacher] of archive) {
   if (!matchingTeachers.has(uid)) throw Error('RANKING_INVALID_ROSTER');
   if (!historical.has(uid) || historical.get(uid).date < day.date) historical.set(uid,{date:day.date,teacher});
  }
 }
 for (const [uid,entry] of historical) {
  if (!roster.has(uid)) roster.set(uid,entry.teacher);
 }
 if (facts.some(fact => !roster.has(fact.teacherUid))) throw Error('RANKING_HISTORICAL_ROSTER_REQUIRED');

 return {
  coverage:expected ? {expected,recorded:recorded.size,complete:expected === recorded.size,from,to} : emptyCoverage(),
  facts,
  teachers:[...roster.values()]
 };
}

function monthlyTotals({facts,teacher,from,to,now,aggregate}) {
 const byMonth = new Map();
 for (const fact of facts) {
  const key = fact.date.slice(0,7);
  if (!byMonth.has(key)) byMonth.set(key,[]);
  byMonth.get(key).push(fact);
 }
 const rows = [];
 const month = new Date(from.slice(0,7) + '-01');
 while (month.toISOString().slice(0,10) <= to) {
  const key = month.toISOString().slice(0,7);
  const totals = aggregate({facts:byMonth.get(key) || [],teachers:[teacher],from,to,cutoff:now});
  rows.push({key,...publicTotals(totals[0])});
  month.setUTCMonth(month.getUTCMonth() + 1);
 }
 return rows;
}

// Only call after Firebase callable authentication and App Check verification.
// request.auth/app are trusted runtime context, unlike request.data.
export function buildRankingRead({db,aggregate=aggregateRanking,rank=rankTeachers,window=rankingWindow,clock=()=>new Date().toISOString()}) {
 verifyQa(db);
 const read = (tx,path) => tx.get(db.doc(path)).then(snapshot => snapshot.exists ? snapshot.data() : null);

 return async function readRanking(request) {
  const uid = request?.auth?.uid;
  if (!isRankingTeacherUid(uid) || !request.app) throw Error('RANKING_UNAUTHENTICATED');
  const input = parseQuery(request.data,uid,window);
  const now = clock();
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw Error('RANKING_INVALID_CLOCK');
  const today = jstDate(time);
  const yesterday = jstDate(time - ONE_DAY);
  if (input.period && (!isDate(input.period.from) || !isDate(input.period.to) ||
      input.period.from > today || input.period.from < FIRST_SUPPORTED_DATE)) throw Error('INVALID_RANKING_PERIOD');

  return db.runTransaction(async tx => {
   const [user,config,maintenance,restore] = await Promise.all([
    read(tx,'users/' + uid),
    read(tx,'rankingInternalConfig/runtime'),
    read(tx,'systemConfig/maintenance'),
    read(tx,'systemConfig/restoreJob')
   ]);
   if (!['employee','admin','owner'].includes(user?.role)) throw Error('RANKING_FORBIDDEN');
   if (restore || maintenance?.enabled === true) throw Error('RANKING_UNAVAILABLE');
   if (config?.enabled !== true || config.publicationEnabled !== true || !isDate(config.trackingStart)) throw Error('RANKING_NOT_PUBLISHED');

   const label = input.period?.label || '累計';
   const from = input.period?.from > config.trackingStart ? input.period.from : config.trackingStart;
   const to = input.period?.to < yesterday ? input.period.to : yesterday;
   if (from > to && input.kind !== 'profile') return {period:label,rows:[],coverage:emptyCoverage(),asOf:now};

   const {coverage,facts,teachers} = await readRankingLedger({tx,db,from,to,now});
   if (input.kind === 'profile') {
    const teacher = teachers.find(candidate => candidate.uid === input.teacherUid);
    if (!teacher) return {profile:null,coverage,asOf:now};
    let totals = null;
    let monthly = [];
    if (coverage.complete) {
     const taught = facts.filter(fact => fact.teacherUid === teacher.uid);
     const profileTotals = coverage.expected ? aggregate({facts:taught,teachers:[teacher],from,to,cutoff:now}) : [];
     totals = publicTotals(profileTotals[0]);
     if (coverage.expected) monthly = monthlyTotals({facts:taught,teacher,from,to,now,aggregate});
    }
    return {profile:{teacherUid:teacher.uid,name:teacher.name,totals,monthly},coverage,asOf:now};
   }

   // Missing days are not equivalent to zero lessons. Withhold standings until resolved.
   const names = new Map(teachers.map(teacher => [teacher.uid,teacher.name]));
   const rows = coverage.complete
    ? rank(aggregate({facts,teachers,from,to,cutoff:now}),input.metric)
     .map(total => ({teacherUid:total.teacherUid,name:names.get(total.teacherUid),rank:total.rank,...publicTotals(total)}))
    : [];
   return {period:label,rows,coverage,asOf:now};
  },{readOnly:true});
 };
}
