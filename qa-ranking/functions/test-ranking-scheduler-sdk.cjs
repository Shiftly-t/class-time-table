'use strict';

const assert=require('node:assert/strict');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');

async function test(){
 const {createQaRankingScheduler}=await import('../../ranking-scheduler.mjs');
 const app=initializeApp({projectId:'shiftly-t-test'},'ranking-scheduler-test');
 const db=getFirestore(app,'shiftly-qa-v1');
 assert.equal(db.projectId,'shiftly-t-test');
 assert.equal(db.databaseId,'shiftly-qa-v1');
 let transactions=0,active=false;
 // Use the real Admin named database metadata and SDK Scheduler HTTP wrapper without cloud I/O.
 db.runTransaction=async work=>{
  transactions++;
  return work({get:async ref=>{
   const fields=active&&ref.path==='rankingInternalConfig/runtime'?{
    enabled:true,automationEnabled:true,correctionIntegrationVerified:true,trackingStart:'2026-11-25'
   }:null;
   return {exists:fields!==null,data:()=>fields};
  }});
 };

 const clock=()=> '2026-11-26T00:10:30+09:00';
 const resolve=()=>assert.fail('finalize must not call the resolver');
 const {qaRankingCaptureDaily,qaRankingFinalizeDaily}=createQaRankingScheduler({db,resolve,clock});
 assert.throws(()=>createQaRankingScheduler({db:getFirestore(app),resolve,clock}),/TARGET_MISMATCH/);
 const previousProject=process.env.GOOGLE_CLOUD_PROJECT;
 try{
  process.env.GOOGLE_CLOUD_PROJECT='shiftly-d02f6';
  assert.throws(()=>createQaRankingScheduler({db,resolve,clock}),/TARGET_MISMATCH/);
 }finally{
  if(previousProject===undefined)delete process.env.GOOGLE_CLOUD_PROJECT;
  else process.env.GOOGLE_CLOUD_PROJECT=previousProject;
 }
 for(const [fn,schedule] of [[qaRankingCaptureDaily,'55 23 * * *'],[qaRankingFinalizeDaily,'10 0 * * *']]){
  assert.deepEqual(fn.__endpoint.region,['asia-northeast1']);
  assert.equal(fn.__endpoint.platform,'gcfv2');
  assert.equal(fn.__endpoint.serviceAccountEmail,'qa-shiftly-runtime@shiftly-t-test.iam.gserviceaccount.com');
  assert.equal(fn.__endpoint.scheduleTrigger.schedule,schedule);
  assert.equal(fn.__endpoint.scheduleTrigger.timeZone,'Asia/Tokyo');
  assert.equal(fn.__endpoint.scheduleTrigger.retryConfig.retryCount,2);
 }
 async function invoke(headers){
  let status;
  await qaRankingFinalizeDaily({header:key=>headers[key]}, {status(code){status=code;return this;},send(){}});
  return status;
 }
 const schedulerHeaders={
  'X-CloudScheduler-JobName':'projects/shiftly-t-test/locations/asia-northeast1/jobs/firebase-schedule-qaRankingFinalizeDaily-asia-northeast1',
  'X-CloudScheduler-ScheduleTime':'2026-11-25T15:10:00Z'
 };
 assert.equal(await invoke({}),500);
 assert.equal(transactions,0);
 assert.equal(await invoke(schedulerHeaders),200);
 active=true;
 assert.equal(await invoke(schedulerHeaders),500);
 assert.equal(transactions,2);
 console.log('SUCCESS RANKING FIREBASE SCHEDULER SDK TESTS');
}

test().catch(error=>{console.error(error);process.exitCode=1;});
