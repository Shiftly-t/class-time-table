'use strict';
const assert=require('node:assert/strict');
const {getFirestore}=require('firebase-admin/firestore');
const {getApp,deleteApp}=require('firebase-admin/app');
const core=require('./booking-core.cjs');
async function main(){
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8788'||process.env.GCLOUD_PROJECT!=='shiftly-t-test')throw Error('ISOLATED EMULATOR REQUIRED');
 const {qaBookingAdminApi}=require('./index.js');
 const app=getApp(),db=getFirestore(app,'shiftly-qa-v1');
 assert.equal((await db.listCollections()).length,0);
 const date='2024-11-26',courseId='winter',studentId='s1',teacherUid='a',slot=core.slotId(courseId,date,0),id='b_test',teacher={role:'employee',name:'A'};
 const course={name:'冬期講習',type:'winter',startDate:date,endDate:date,periods:[{start:'13:00',end:'13:55'},{start:'14:00',end:'14:55'}],archived:false};
 const slot2=core.slotId(courseId,date,1);
 const load=(key,uid)=>'bookingTeacherLoad/'+core.tokenHash(courseId+':'+key+':'+uid);
 const entry='bookingEntries/'+courseId+'__'+studentId;
 const lesson={date,courseId,studentId,studentName:'生徒',grade:'中1',school:'',teacherUid,teacherName:'A',start:'13:00',end:'13:55',status:'done',subject:'数学',memo:'',nextDates:[]};
 const fixture={
  'systemConfig/coordination':{enabled:true,protocolVersion:2,enforceDirectWriteDeny:true},
  'systemConfig/normalAuthority':{enabled:true,schemaVersion:1},
  'normalAuthorityState/global':{version:1},
  'rankingInternalConfig/runtime':{enabled:true,trackingStart:date,correctionIntegrationVerified:true,automationEnabled:true},
  'users/admin':{role:'admin',name:'管理者'},'users/a':teacher,'users/b':{...teacher,name:'B'},
  'schoolStudents/s1':{name:'生徒',grade:'中1',school:'',regularSlots:{}},
  ['schoolOpenDays/'+date]:{date,note:''},
  ['specialCourses/'+courseId]:course,
  ['specialCourses/'+courseId+'/teacherAvailability/a']:{slots:[date+'_0',date+'_1']},
  ['specialCourses/'+courseId+'/teacherAvailability/b']:{slots:[date+'_0',date+'_1']},
  ['bookingSettings/'+courseId]:{enabled:true,excludedDates:[]},
  ['bookingSlots/'+slot]:{courseId,date,index:0,start:'13:00',end:'13:55',used:1,capacity:4},
  ['bookingSlots/'+slot2]:{courseId,date,index:1,start:'14:00',end:'14:55',used:0,capacity:4},
  [load(slot,'a')]:{courseId,slotId:slot,teacherUid:'a',used:1},
  [entry]:{courseId,studentId,status:'submitted',wishes:[slot],confirmed:[{slotId:slot,teacherUid:'a',teacherName:'A',subject:'数学',published:true,lessonId:id}],revision:1},
  ['timetableEntries/'+id]:lesson
 };
 try{
  await Promise.all(Object.entries(fixture).map(([p,v])=>db.doc(p).set(v)));
  const {createQaRankingStore}=await import('./ranking-qa-store.mjs');
  const {createRankingResolver}=require('./ranking-resolver.cjs');
  let now=date+'T23:55:00+09:00';
  const store=createQaRankingStore({db,projectId:db.projectId,databaseId:db.databaseId,clock:()=>now});
  assert.equal((await store.capture(date,createRankingResolver(db,{archiveDateSource:true,enableSeasonal:true,periodFromSlot:core.periodFromSlot}))).slots,1);
  now='2024-11-27T00:10:00+09:00';await store.finalize(date);
  const day=db.doc('rankingInternalDays/'+date);
  const run=(data,uid='admin')=>qaBookingAdminApi.run({auth:{uid},app:{appId:'fixture'},data:{courseId,studentId,...data}});
  const correction={date,reason:'QA訂正'};
  async function request(action,requestId,fields){return {action,requestId,expectedRevision:(await db.doc(entry).get()).get('revision'),correction,...fields};}
  const absent=await request('setPublishedAttendance','absent',{slotId:slot,status:'cancelled'});
  await assert.rejects(run(absent,'a'),/Administrator/);
  await run(absent);await run(absent);
  assert.equal((await day.get()).get('facts').length,0);
  assert.equal((await day.get()).get('revision'),2);
  assert.equal((await db.doc('bookingSlots/'+slot).get()).get('used'),1);
  assert.equal((await db.doc(entry).get()).get('confirmed').length,1);
  await run(await request('setPublishedAttendance','reinstate',{slotId:slot,status:'done'}));
  assert.equal((await day.get()).get('facts').length,1);
  await assert.rejects(run({...await request('changePublished','stale',{from:slot,to:slot2,teacherUid:'b',subject:'数学'}),expectedRevision:1}),/Booking changed/);
  await run(await request('changePublished','move',{from:slot,to:slot2,teacherUid:'b',subject:'数学'}));
  assert.equal((await day.get()).get('facts')[0].teacherUid,'b');
  assert.equal((await db.doc(entry).get()).get('confirmed')[0].slotId,slot2);
  assert.equal((await db.doc('bookingSlots/'+slot).get()).get('used'),0);
  assert.equal((await db.doc('bookingSlots/'+slot2).get()).get('used'),1);
  await run(await request('cancelConfirmed','cancel',{slotId:slot2}));
  assert.equal((await day.get()).get('facts').length,0);
  assert.equal((await day.get()).get('revision'),5);
  assert.equal((await db.doc(entry).get()).get('confirmed').length,0);
  assert.equal((await db.doc('bookingSlots/'+slot2).get()).get('used'),0);
  assert.equal((await db.doc('timetableEntries/'+id).get()).exists,false);
  console.log('SUCCESS RANKING BOOKING CORRECTION EMULATOR TESTS');
 }finally{
  for(const c of await db.listCollections())await db.recursiveDelete(c);
  await db.terminate();await deleteApp(app);
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
