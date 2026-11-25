'use strict';
const assert = require('node:assert/strict');
// Copy this test beside the assembled QA Functions modules, then run on Node 22
// against a fresh Firestore emulator on 127.0.0.1:8786.
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8786 node test-ranking-archive-read-emulator.cjs
const {initializeApp,deleteApp} = require('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp} = require('firebase-admin/firestore');
const {HttpsError} = require('firebase-functions/v2/https');
const {createCoordinator} = require('./coordination.cjs');
const {createStage2Bridge} = require('./stage2-bridge.cjs');
const {createRankingResolver} = require('./ranking-resolver.cjs');
const core = require('./booking-core.cjs');

async function main() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8786');
  const app = initializeApp({projectId:'shiftly-t-test'});
  const db = getFirestore(app,'shiftly-qa-v1');
  assert.equal((await db.listCollections()).length,0,'Use a fresh dedicated emulator database');
  const date = '2024-11-26';
  const day = name => db.doc(name + '/' + date);
  const config = db.doc('rankingInternalConfig/runtime');
  const user = name => db.doc('users/' + name);
  const studentUid = 'private_learner_a';
  const teacherUid = 'teacher_a';
  const caller = {auth:{uid:'manager'},app:{appId:'validation-fixture'}};
  let now = date + 'T23:55:00+09:00';
  const clock = () => now;
  const {createQaRankingStore} = await import('./ranking-qa-store.mjs');
  const {buildRankingRead} = await import('./ranking-read.mjs');
  const store = createQaRankingStore({db,projectId:db.projectId,databaseId:db.databaseId,clock});
  const read = buildRankingRead({db,clock});
  try {
    const fixture = {
      'systemConfig/coordination':{enabled:true,protocolVersion:2},
      'systemConfig/normalAuthority':{enabled:true,schemaVersion:1},
      'normalAuthorityState/global':{version:1},
      'rankingInternalConfig/runtime':{enabled:true,trackingStart:date,correctionIntegrationVerified:true,automationEnabled:true,publicationEnabled:false},
      'users/manager':{role:'owner',name:'運営'},
      'users/teacher_a':{role:'employee',name:'担当講師',email:'private_teacher_address'},
      ['schoolStudents/'+studentUid]:{name:'private_learner_name',grade:'中1',school:'',regularSlots:{
        weekly:{id:'weekly',weekday:2,teacherUid,start:'17:30',end:'19:25',activeFrom:date}
      }},
      ['schoolOpenDays/'+date]:{date,note:''}
    };
    await Promise.all(Object.entries(fixture).map(([path,value])=>db.doc(path).set(value)));
    const resolver = createRankingResolver(db,{archiveDateSource:true});
    assert.equal((await store.capture(date,resolver)).slots,2);
    const snapshot = (await day('rankingInternalSnapshots').get()).data();
    assert.deepEqual(snapshot.teacherRoster,[{uid:teacherUid,role:'employee',name:'担当講師'}]);
    assert.equal(snapshot.source.date,date);
    assert(!JSON.stringify(snapshot).includes('private_teacher_address'));
    assert(!JSON.stringify(snapshot).includes('private_learner_name'));
    now = '2024-11-27T00:10:00+09:00';
    assert.deepEqual(await store.finalize(date),{state:'committed',date,revision:1});
    const request = {...caller,data:{kind:'cumulative',key:'',metric:'slots'}};
    await assert.rejects(()=>read(request),/NOT_PUBLISHED/);
    await config.update({publicationEnabled:true});
    assert.equal((await read(request)).rows[0].slots,2);

    const coor = createCoordinator({rawDb:db,FieldValue,Timestamp,core,HttpsError,key:()=> 'ad'.repeat(32)});
    const bridge = createStage2Bridge({coor,core,Timestamp,reservedDate:()=>false,
      legacyAdmin:()=>{throw Error('Unexpected booking admin call');},legacyPublic:()=>{throw Error('Unexpected public call');}});
    const changed = await bridge.normalApi({...caller,data:{
      kind:'day',requestId:'fixture_absence',date,changes:[],absences:[{teacherUid,expected:null,periods:[2]}]
    }});
    assert.equal(changed.changed,1);
    const [correctedSnapshot,correctedDay] = await Promise.all([
      day('rankingInternalSnapshots').get(), day('rankingInternalDays').get()
    ]);
    assert.equal(correctedDay.get('revision'),2);
    assert.equal(correctedDay.get('facts').length,1);
    assert.deepEqual(correctedSnapshot.get('facts'),correctedDay.get('facts'));
    assert.deepEqual(await store.finalize(date),{state:'replayed',date,revision:1});
    assert.equal((await day('rankingInternalDays').get()).get('revision'),2);

    await user(teacherUid).delete();
    const summary = await read(request);
    assert.deepEqual(summary.rows,[{teacherUid,name:'担当講師',rank:1,slots:1,regular:1,seasonal:0,days:1,students:1}]);
    const profile = await read({...caller,data:{kind:'profile',teacherUid}});
    assert.deepEqual(profile.profile.monthly,[{key:'2024-11',slots:1,regular:1,seasonal:0,days:1,students:1}]);
    assert(!JSON.stringify([summary,profile]).includes('private_'));
    await assert.rejects(()=>read({...request,auth:{uid:teacherUid}}),/FORBIDDEN/);
    await assert.rejects(()=>read({...request,app:null}),/UNAUTHENTICATED/);

    await db.doc('systemConfig/restoreJob').set({active:true});
    await assert.rejects(()=>read(request),/UNAVAILABLE/);
    console.log('SUCCESS RANKING ARCHIVE CORRECTION REPLAY AND PROFILE EMULATOR TESTS');
  } finally {
    for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
    await db.terminate();
    await deleteApp(app);
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
