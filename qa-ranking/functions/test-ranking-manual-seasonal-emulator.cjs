'use strict';
const assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const {createCoordinator}=require('./coordination.cjs');
const {createStage2Bridge}=require('./stage2-bridge.cjs');
const {createRankingResolver}=require('./ranking-resolver.cjs');
const core=require('./booking-core.cjs');
async function main(){
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8788')throw Error('ISOLATED EMULATOR REQUIRED');
 const app=initializeApp({projectId:'shiftly-t-test'});
 const db=getFirestore(app,'shiftly-qa-v1');
 assert.equal((await db.listCollections()).length,0);
 const date='2024-11-26',courseId='winter',teacher={role:'employee',name:'A'};
 const lesson={date,courseId,studentId:'s1',studentName:'生徒',grade:'中1',school:'',teacherUid:'a',teacherName:'A',start:'13:00',end:'13:55',status:'done',subject:'数学',memo:'',nextDates:[]};
 const fixture={
  'systemConfig/coordination':{enabled:true,protocolVersion:2,enforceDirectWriteDeny:true},
  'systemConfig/normalAuthority':{enabled:true,schemaVersion:1},
  'normalAuthorityState/global':{version:1},
  'rankingInternalConfig/runtime':{enabled:true,trackingStart:date,correctionIntegrationVerified:true,automationEnabled:true},
  'users/admin':{role:'admin',name:'管理者'},'users/a':teacher,'users/b':{...teacher,name:'B'},
  'schoolStudents/s1':{name:'生徒',grade:'中1',school:'',regularSlots:{}},
  ['schoolOpenDays/'+date]:{date,note:''},
  ['specialCourses/'+courseId]:{name:'冬期講習',type:'winter',startDate:date,endDate:date,periods:[{start:'13:00',end:'13:55'}],archived:false},
  ['specialCourses/'+courseId+'/teacherAvailability/a']:{slots:[date+'_0']},
  ['specialCourses/'+courseId+'/teacherAvailability/b']:{slots:[date+'_0']},
  'timetableEntries/manual1':lesson
 };
 try{
  await Promise.all(Object.entries(fixture).map(([p,v])=>db.doc(p).set(v)));
  const coor=createCoordinator({rawDb:db,FieldValue,Timestamp,core,HttpsError,key:()=> 'ad'.repeat(32)});
  const bridge=createStage2Bridge({coor,core,Timestamp,reservedDate:()=>false,legacyAdmin:()=>{throw Error('UNEXPECTED');},legacyPublic:()=>{throw Error('UNEXPECTED');}});
  const {createQaRankingStore}=await import('./ranking-qa-store.mjs');
  let now=date+'T23:55:00+09:00';
  const store=createQaRankingStore({db,projectId:db.projectId,databaseId:db.databaseId,clock:()=>now});
  assert.equal((await store.capture(date,createRankingResolver(db,{archiveDateSource:true,enableSeasonal:true,periodFromSlot:core.periodFromSlot}))).slots,1);
  now='2024-11-27T00:10:00+09:00';
  await store.finalize(date);
  const run=(data,uid='admin')=>bridge.seasonalApi({auth:{uid},app:{appId:'fixture'},data:{courseId,...data}});
  async function request(id,change,correction={date,reason:'QA訂正'}){
   const v=await run({action:'inspectCourse'});
   return {action:'publishManualCourse',requestId:id,expectedCourse:v.course.token,expectedMeta:v.meta.token,changes:[{id:'manual1',expected:v.entries.manual1.token,...change}],...(correction?{correction}:{})};
  }
  const change={value:{...lesson,teacherUid:'b',teacherName:'B'}};
  await assert.rejects(run(await request('no_correction',change,null)),/Completed history/);
  await assert.rejects(run(await request('wrong_date',change,{date:'2024-11-25',reason:'QA'})),/NOT_READY/);
  const valid=await request('reassign',change);
  await assert.rejects(run(valid,'a'),/Administrator/);
  assert.equal((await run(valid)).changed,1);
  assert.equal((await run(valid)).changed,1);
  const day=db.doc('rankingInternalDays/'+date);
  assert.equal((await day.get()).get('revision'),2);
  assert.equal((await day.get()).get('facts')[0].teacherUid,'b');
  assert.equal((await db.doc('timetableEntries/manual1').get()).get('teacherUid'),'b');
  await run(await request('cancel',{value:{...change.value,status:'cancelled'}}));
  assert.deepEqual((await day.get()).get('facts'),[]);
  assert.equal((await day.get()).get('revision'),3);
  await run(await request('restore_attendance',change));
  assert.equal((await day.get()).get('facts').length,1);
  await run(await request('delete',{remove:true}));
  assert.equal((await day.get()).get('revision'),5);
  assert.deepEqual((await day.get()).get('facts'),[]);
  assert.equal((await db.doc('timetableEntries/manual1').get()).exists,false);
  console.log('SUCCESS RANKING MANUAL SEASONAL CORRECTION EMULATOR TESTS');
 }finally{
  for(const c of await db.listCollections())await db.recursiveDelete(c);
  await db.terminate();await deleteApp(app);
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
