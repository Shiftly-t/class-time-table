import assert from 'node:assert/strict';
import {createQaRankingStore} from '../ranking-qa-store.mjs';
async function fixture(){
 const state=new Map([['rankingInternalConfig/runtime',{enabled:true,trackingStart:'2026-11-25'}]]);
 const db={projectId:'shiftly-t-test',databaseId:'shiftly-qa-v1',collection:c=>({doc:id=>c+'/'+id}),async runTransaction(fn){
  const pending=new Map();let writing=false;
  const result=await fn({async get(path){if(writing)throw Error('READ_AFTER_WRITE');return {exists:state.has(path),data:()=>state.get(path)};},set(path,value){writing=true;pending.set(path,value);},create(path,value){writing=true;if(state.has(path)||pending.has(path))throw Error('ALREADY_EXISTS');pending.set(path,value);}});
  for(const [k,v]of pending)state.set(k,v);return result;
 }};
 let now='2026-11-25T23:55:00+09:00';const date='2026-11-25';
 const slotId=JSON.stringify(['student',date,'17:30','18:25']);
 const fact=teacherUid=>({slotId,teacherUid,studentId:'student',date,endedAt:date+'T18:25:00+09:00',kind:'regular',status:'done'});
 const derive=()=>({canPublish:true,facts:[fact('a')]});
 const deps={db,projectId:db.projectId,databaseId:db.databaseId,derive,clock:()=>now};
 const store=createQaRankingStore(deps),eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('ASSERT '+JSON.stringify(a));};
 let rejected=false;try{createQaRankingStore({...deps,projectId:'shiftly-d02f6'});}catch{rejected=true;}eq(rejected,true);
 const teacherRoster=[{uid:'a',role:'employee',name:'講師A'}];
 const source={version:1,date};
 eq((await store.capture(date,async({capturedAt})=>({snapshot:{date,capturedAt,complete:true},source,teachers:[{...teacherRoster[0],email:'private'}]}))).state,'captured');
 const snapshotPath='rankingInternalSnapshots/'+date,dayPath='rankingInternalDays/'+date;
 eq(state.get(snapshotPath).teacherRoster,teacherRoster);
 eq(state.get(snapshotPath).source,source);
 eq((await store.capture(date,()=>{throw Error('should not resolve');})).state,'alreadyCaptured');
 rejected=false;try{await store.finalize(date);}catch{rejected=true;}eq(rejected,true);
 now='2026-11-26T00:01:00+09:00';
 const originalSnapshot=state.get(snapshotPath);
 for(const capturedAt of [undefined,'2026-11-24T14:59:00.000Z','2026-11-25T15:00:00.000Z']){
  state.set(snapshotPath,{...originalSnapshot,capturedAt});
  await assert.rejects(()=>store.finalize(date),/INVALID_DAILY_SNAPSHOT_CAPTURE_TIME/);
  eq(state.has(dayPath),false);
 }
 state.set(snapshotPath,originalSnapshot);
 eq((await store.finalize(date)).state,'committed');eq((await store.finalize(date)).state,'replayed');
 eq(state.get(dayPath).teacherRoster,teacherRoster);
 eq(state.get(snapshotPath).source,source);
 eq(state.get('rankingInternalRefresh/2026-11-25_1').status,'pending');
 eq(state.has('rankingInternalAudit/2026-11-25_1'),true);
 rejected=false;try{await store.correct(date,async()=>({kind:'correct',actorRole:'employee'}));}catch{rejected=true;}eq(rejected,true);
 const correct=()=>({kind:'correct',operationId:'change-teacher',expectedRevision:1,actor:'manager',actorRole:'owner',reason:'担当を訂正',changes:[{slotId,before:fact('a'),after:fact('b')}]});
 await assert.rejects(()=>store.correct(date,correct),/HISTORICAL_ROSTER_REQUIRED/);
 eq(state.get(dayPath).revision,1);
 eq(state.has('rankingInternalRefresh/2026-11-25_2'),false);
 state.set('users/b',{role:'admin',name:'講師B',email:'private-b'});
 eq((await store.correct(date,correct)).state,'committed');
 eq((await store.correct(date,correct)).state,'replayed');
 eq(state.get(dayPath).teacherRoster,[{uid:'b',role:'admin',name:'講師B'}]);
 eq(state.get(snapshotPath).source,source);
 const correctedDay=state.get(dayPath);
 state.set(snapshotPath,{...originalSnapshot,facts:correctedDay.facts,teacherRoster:correctedDay.teacherRoster});
 eq(await store.finalize(date),{state:'replayed',date,revision:1});
 eq(state.get(dayPath),correctedDay);
 eq(state.has('rankingInternalRefresh/2026-11-25_3'),false);
 state.delete(dayPath);
 await assert.rejects(()=>store.finalize(date),/INVALID_CAPTURE_RECEIPT/);
 return 'SUCCESS RANKING QA STORE TRANSACTION MOCK TESTS';
}
console.log(await fixture());
