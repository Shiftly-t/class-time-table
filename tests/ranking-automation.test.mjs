import assert from 'node:assert/strict';
import {createRankingAutomation,createRankingSchedules} from '../ranking-automation.mjs';
const state=new Map();
let writes=0,now='2026-11-25T23:55:30+09:00';
const db={projectId:'shiftly-t-test',databaseId:'shiftly-qa-v1',doc:path=>path,collection:name=>name,runTransaction:fn=>fn({get:async p=>({exists:state.has(p),data:()=>state.get(p)})})};
const storeFactory=({db})=>({
 capture:(date,resolve)=>db.runTransaction(async tx=>{await resolve({tx,date});writes++;return {state:'captured',date};}),
 finalize:date=>db.runTransaction(async()=>{writes++;return {state:'committed',date};})
});
const run=createRankingAutomation({db,resolve:async()=>{},clock:()=>now,storeFactory});
const capture={scheduleTime:'2026-11-25T23:55:00+09:00'};
const config={enabled:true,automationEnabled:true,correctionIntegrationVerified:true,trackingStart:'2026-11-25'};
assert.equal((await run('capture',capture)).state,'disabled');
state.set('rankingInternalConfig/runtime',{...config,correctionIntegrationVerified:false});
assert.equal((await run('capture',capture)).state,'disabled');
assert.equal(writes,0);
state.set('rankingInternalConfig/runtime',config);
state.set('systemConfig/restoreJob',{});
await assert.rejects(()=>run('capture',capture),/MAINTENANCE_OR_RESTORE/);
state.delete('systemConfig/restoreJob');
state.set('systemConfig/maintenance',{enabled:true});
await assert.rejects(()=>run('capture',capture),/MAINTENANCE_OR_RESTORE/);
state.delete('systemConfig/maintenance');
assert.deepEqual(await run('capture',capture),{state:'captured',date:'2026-11-25'});
now='2026-11-26T00:10:30+09:00';
await assert.rejects(()=>run('capture',capture),/OUTSIDE_DAY/);
assert.deepEqual(await run('finalize',{scheduleTime:'2026-11-26T00:10:00+09:00'}),{state:'committed',date:'2026-11-25'});
assert.equal(writes,2);
state.set('rankingInternalConfig/runtime',{...config,trackingStart:'2026-11-26'});
assert.equal((await run('finalize',{scheduleTime:'2026-11-26T00:10:00+09:00'})).state,'beforeTrackingStart');
assert.throws(()=>createRankingAutomation({db:{...db,projectId:'shiftly-d02f6'},resolve:()=>{}}),/TARGET_MISMATCH/);
const schedules=createRankingSchedules({onSchedule:(options,handler)=>({options,handler}),run});
assert.equal(schedules.qaRankingCaptureDaily.options.schedule,'55 23 * * *');
assert.equal(schedules.qaRankingFinalizeDaily.options.schedule,'10 0 * * *');
assert.equal(schedules.qaRankingCaptureDaily.options.timeZone,'Asia/Tokyo');
console.log('SUCCESS RANKING AUTOMATION GATE TESTS');

const docs=new Map([['rankingInternalConfig/runtime',config]]);
const transactionDb={
 projectId:'shiftly-t-test',databaseId:'shiftly-qa-v1',doc:path=>path,
 collection:name=>({doc:id=>`${name}/${id}`}),
 async runTransaction(work){
  const pending=new Map();
  const result=await work({
   async get(path){
    assert.equal(pending.size,0,'Firestore reads must precede writes');
    return {exists:docs.has(path),data:()=>docs.get(path)};
   },
   create(path,value){
    assert.equal(docs.has(path)||pending.has(path),false);
    pending.set(path,value);
   },
   set(path,value){pending.set(path,value);}
  });
  for(const [path,value] of pending)docs.set(path,value);
  return result;
 }
};
let clock='2026-11-25T23:56:00+09:00',resolutions=0,crossMidnight=false;
const runStore=createRankingAutomation({
 db:transactionDb,clock:()=>clock,
 async resolve({date,capturedAt}){
  resolutions++;
  if(crossMidnight)clock='2026-11-26T00:00:00+09:00';
  return {snapshot:{date,capturedAt,complete:true,closed:true,entries:[],courses:[],unavailableSlots:[]},teachers:[]};
 }
});
const captureUtc={scheduleTime:'2026-11-25T14:55:00.000Z'};
const finalizeUtc={scheduleTime:'2026-11-25T15:10:00Z'};
await assert.rejects(runStore('capture',{scheduleTime:'2026-11-25T23:55:00'}),/INVALID_SCHEDULE_TIME/);
await assert.rejects(runStore('capture',{scheduleTime:'2026-11-25T14:55:01Z'}),/UNEXPECTED_SCHEDULE_TIME/);
await assert.rejects(runStore('recoverFinalization',{date:'2026-11-25'}),/FINALIZATION_NOT_DUE/);
await assert.rejects(runStore('recoverFinalization',{date:'2026-02-30'}),/INVALID_DATE/);
crossMidnight=true;
await assert.rejects(runStore('capture',captureUtc),/OUTSIDE_DAY/);
assert.equal(docs.has('rankingInternalSnapshots/2026-11-25'),false);
crossMidnight=false;
clock='2026-11-25T23:56:00+09:00';
assert.deepEqual(await runStore('capture',captureUtc),{state:'captured',date:'2026-11-25',slots:0});
assert.equal((await runStore('capture',captureUtc)).state,'alreadyCaptured');
assert.equal(resolutions,2);

clock='2026-11-26T00:10:30+09:00';
docs.set('systemConfig/maintenance',{enabled:true});
await assert.rejects(runStore('finalize',finalizeUtc),/MAINTENANCE_OR_RESTORE/);
docs.delete('systemConfig/maintenance');
docs.set('rankingInternalConfig/runtime',{...config,automationEnabled:false});
assert.equal((await runStore('finalize',finalizeUtc)).state,'disabled');
assert.equal(docs.has('rankingInternalDays/2026-11-25'),false);

clock='2026-11-27T00:12:00+09:00';
await assert.rejects(runStore('finalize',finalizeUtc),/OUTSIDE_DAY/);
docs.set('rankingInternalConfig/runtime',config);
const lateDate={date:'2026-11-25'};
assert.deepEqual(await runStore('recoverFinalization',lateDate),{state:'committed',date:'2026-11-25',revision:1});
assert.equal((await runStore('recoverFinalization',lateDate)).state,'replayed');
assert.equal(docs.get('rankingInternalRefresh/2026-11-25_1').status,'pending');
assert.equal(docs.get('rankingInternalDays/2026-11-25').revision,1);
await assert.rejects(runStore('recoverFinalization',{date:'2026-11-26'}),/MISSING_DAILY_SNAPSHOT/);
assert.equal(docs.has('rankingInternalDays/2026-11-26'),false);
assert.equal(resolutions,2);

const logs=[];
const failures=createRankingSchedules({
 onSchedule:(_options,handler)=>handler,
 run:async()=>{throw Error('private_source_record');},
 logger:{info(){assert.fail('unexpected success log');},error:(...args)=>logs.push(args)}
});
await assert.rejects(failures.qaRankingCaptureDaily(captureUtc),/^Error: RANKING_JOB_FAILED$/);
assert.deepEqual(logs,[['RANKING_CAPTURE',{reason:'RANKING_JOB_FAILED',scheduleTime:captureUtc.scheduleTime}]]);
console.log('SUCCESS RANKING SCHEDULER RETRY PAUSE AND RECOVERY TESTS');
