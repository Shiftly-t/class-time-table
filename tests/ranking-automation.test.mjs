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
