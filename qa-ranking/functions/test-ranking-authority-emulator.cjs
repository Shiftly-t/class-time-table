'use strict';
const assert = require('node:assert/strict');
const {initializeApp,deleteApp} = require('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp} = require('firebase-admin/firestore');
const {HttpsError} = require('firebase-functions/v2/https');
const {createCoordinator} = require('./coordination.cjs');
const {createStage2Bridge} = require('./stage2-bridge.cjs');
const {createRankingResolver} = require('./ranking-resolver.cjs');
const core = require('./booking-core.cjs');

async function main() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8788') {
    throw Error('Start a fresh isolated Firestore emulator on 127.0.0.1:8788');
  }
  const app = initializeApp({projectId:'shiftly-t-test'});
  const db = getFirestore(app,'shiftly-qa-v1');
  const collections = await db.listCollections();
  assert.equal(collections.length,0,'Use a fresh dedicated emulator database');
  const date = '2024-11-26';
  const employee = {role:'employee',name:'講師A'};
  const student = {name:'生徒',grade:'中1',school:'',regularSlots:{
    weekly:{id:'weekly',weekday:2,teacherUid:'teacher_a',start:'17:30',end:'19:25',activeFrom:date}
  }};
  const fixture = {
    'systemConfig/coordination':{enabled:true,protocolVersion:2},
    'systemConfig/normalAuthority':{enabled:true,schemaVersion:1},
    'normalAuthorityState/global':{version:1},
    'rankingInternalConfig/runtime':{enabled:true,trackingStart:date,correctionIntegrationVerified:true,automationEnabled:true},
    'users/manager':{role:'admin',name:'管理者'},
    'users/owner':{role:'owner',name:'運営'},
    'users/teacher_a':employee,
    'users/teacher_b':{...employee,name:'講師B'},
    'schoolStudents/student_a':student,
    ['schoolOpenDays/'+date]:{date,note:''}
  };
  await Promise.all(Object.entries(fixture).map(([path,value])=>db.doc(path).set(value)));
  const raw = db;
  const coor = createCoordinator({rawDb:raw,FieldValue,Timestamp,core,HttpsError,key:()=> 'ad'.repeat(32)});
  const bridge = createStage2Bridge({coor,core,Timestamp,reservedDate:()=>false,
    legacyAdmin:()=>{throw Error('Unexpected booking admin call');},legacyPublic:()=>{throw Error('Unexpected public call');}});
  const {createQaRankingStore} = await import('./ranking-qa-store.mjs');
  let now = date+'T23:55:00+09:00';
  const store = createQaRankingStore({db,projectId:db.projectId,databaseId:db.databaseId,clock:()=>now});
  const capture = createRankingResolver(db,{archiveDateSource:true});
  try {
    assert.equal((await store.capture(date,capture)).slots,2);
    const run = (data,uid='manager',appId='fixture')=>bridge.normalApi({auth:{uid},app:appId?{appId}:null,data});
    const seasonal = data=>bridge.seasonalApi({auth:{uid:'owner'},app:{appId:'fixture'},data});
    const maintenance = db.doc('systemConfig/maintenance');
    await maintenance.set({enabled:true});
    const archive = await seasonal({action:'createSnapshot',requestId:'archive',label:'emulator only'});
    assert.equal((await seasonal({action:'planBatchedRestore',archiveId:archive.archiveId})).canApply,true);
    await maintenance.set({enabled:false});
    const absence = {kind:'day',requestId:'absence',date,changes:[],absences:[{teacherUid:'teacher_a',expected:null,periods:[2]}]};
    await assert.rejects(run(absence,'teacher_a'),/Administrator/);
    await assert.rejects(run(absence,'manager',null),/App Check/);
    assert.equal((await run(absence)).changed,1);
    assert.equal((await run(absence)).changed,1);
    await assert.rejects(run({...absence,absences:[{...absence.absences[0],periods:[1]}]}),/payload mismatch/);
    const pending = (await db.doc('rankingInternalSnapshots/'+date).get()).data();
    assert.equal(pending.facts.length,1);
    assert.equal(pending.source.work.teacher_a.absence[0],2);
    now = '2024-11-27T00:10:00+09:00';
    assert.equal((await store.finalize(date)).revision,1);
    const currentVersion = (await db.doc('normalAuthorityState/global').get()).get('version');
    await run({kind:'work',type:'weekly',requestId:'weekly',teacherUid:'teacher_a',values:[],expectedVersion:currentVersion});
    const snapshot = await run({kind:'inspect',requestId:'inspect',date});
    await run({kind:'day',requestId:'reinstate',date,changes:[],absences:[{
      teacherUid:'teacher_a',periods:[],expected:snapshot.absences.teacher_a.token
    }]});
    const restored = (await db.doc('rankingInternalDays/'+date).get()).data();
    assert.equal(restored.facts.length,2,'Weekly edits must not change the frozen historic day');
    assert.equal(restored.revision,2);
    assert.deepEqual(restored.teacherRoster,[{uid:'teacher_a',...employee}]);
    assert.equal((await db.doc('rankingInternalRefresh/'+date+'_2').get()).get('status'),'pending');

    const id = 'rec_student_a_weekly_'+date;
    const view = await run({kind:'inspect',requestId:'inspect_again',date});
    const expectedOccurrence = view.virtuals[id].token;
    const value = {studentId:'student_a',studentName:'生徒',grade:'中1',school:'',teacherUid:'teacher_b',
      teacherName:'講師B',date,start:'17:30',end:'19:25',regularId:'weekly',subject:'',status:'done',memo:'lesson note',nextDates:[]};
    await run({kind:'day',requestId:'reassign',date,absences:[],changes:[{id,expected:null,expectedOccurrence,value}]});
    const rows = await db.doc('rankingInternalDays/'+date).get();
    assert.equal(rows.get('revision'),3);
    assert.ok(rows.get('facts').every(fact=>fact.teacherUid==='teacher_b'));
    assert.equal((await db.doc('timetableEntries/'+id).get()).get('teacherUid'),'teacher_b');
    assert.ok((await db.doc('rankingInternalAudit/'+date+'_3').get()).exists);

    const priorDone = (await run({kind:'inspect',requestId:'done_view',date})).entries[id].token;
    const moved = {...value,start:'18:30',end:'19:25'};
    await run({kind:'day',requestId:'completed_time',date,changes:[{id,expected:priorDone,value:moved}],absences:[]});
    assert.equal((await db.doc('timetableEntries/'+id).get()).get('memo'),'lesson note');
    assert.equal((await db.doc('rankingInternalDays/'+date).get()).get('facts').length,1);

    // Race two verified editors using the same baseline. One loses, including its audit and refresh.
    const existing = (await run({kind:'inspect',requestId:'race_view',date})).entries[id].token;
    const cancel = requestId=>run({kind:'day',requestId,date,changes:[{id,expected:existing,value:{...moved,status:'cancelled'}}],absences:[]});
    const race = await Promise.allSettled([cancel('race_first'),cancel('race_other')]);
    assert.equal(race.filter(result=>result.status==='fulfilled').length,1);
    assert.match(race.find(result=>result.status==='rejected').reason.message,/changed; reload/);
    const final = await db.doc('rankingInternalDays/'+date).get();
    assert.deepEqual(final.get('facts'),[]);
    assert.equal(final.get('revision'),5);
    assert.equal((await db.doc('rankingInternalRefresh/'+date+'_6').get()).exists,false);
    assert.equal((await store.finalize(date)).state,'replayed');
    await maintenance.set({enabled:true});
    await assert.rejects(seasonal({action:'planBatchedRestore',archiveId:archive.archiveId}),/RANKING_RESTORE_CHANGES_TRACKED_DATE/);
    assert.equal((await db.doc('rankingInternalDays/'+date).get()).get('revision'),5);
    assert.equal((await db.doc('systemConfig/restoreJob').get()).exists,false);
    console.log('SUCCESS RANKING AUTHORITY COORDINATOR EMULATOR TESTS');
  } finally {
    for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
    await db.terminate();
    await deleteApp(app);
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
