import {createQaRankingStore} from '../ranking-qa-store.mjs';
async function fixture(){
 const state=new Map([['rankingInternalConfig/runtime',{enabled:true,trackingStart:'2026-11-25'}]]);
 const db={projectId:'shiftly-t-test',databaseId:'shiftly-qa-v1',collection:c=>({doc:id=>c+'/'+id}),async runTransaction(fn){
  const pending=new Map();let writing=false;
  const result=await fn({async get(path){if(writing)throw Error('READ_AFTER_WRITE');return {exists:state.has(path),data:()=>state.get(path)};},set(path,value){writing=true;pending.set(path,value);},create(path,value){writing=true;if(state.has(path)||pending.has(path))throw Error('ALREADY_EXISTS');pending.set(path,value);}});
  for(const [k,v]of pending)state.set(k,v);return result;
 }};
 let now='2026-11-25T23:55:00+09:00';const date='2026-11-25';
 const plan=({date,current,command,priorOperation,now})=>{if(priorOperation)return {replayed:true,revision:priorOperation.revision};const revision=(current?.revision||0)+1;return {revision,day:{date,revision,facts:command.facts||[]},operation:{revision},audit:{revision},refresh:{revision}};};
 const derive=()=>({canPublish:true,facts:[]});
 const deps={db,projectId:db.projectId,databaseId:db.databaseId,derive,plan,clock:()=>now,digest:()=> 'a'.repeat(64),byteLength:s=>s.length};
 const store=createQaRankingStore(deps),eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('ASSERT '+JSON.stringify(a));};
 let rejected=false;try{createQaRankingStore({...deps,projectId:'shiftly-d02f6'});}catch{rejected=true;}eq(rejected,true);
 eq((await store.capture(date,async({capturedAt})=>({snapshot:{date,capturedAt,complete:true},teachers:[]}))).state,'captured');
 eq((await store.capture(date,()=>{throw Error('should not resolve');})).state,'alreadyCaptured');
 rejected=false;try{await store.finalize(date);}catch{rejected=true;}eq(rejected,true);
 now='2026-11-26T00:01:00+09:00';eq((await store.finalize(date)).state,'committed');eq((await store.finalize(date)).state,'replayed');
 eq(state.get('rankingInternalRefresh/2026-11-25_1').status,'pending');
 eq(state.has('rankingInternalAudit/2026-11-25_1'),true);
 rejected=false;try{await store.correct(date,async()=>({kind:'correct',actorRole:'employee'}));}catch{rejected=true;}eq(rejected,true);
 return 'SUCCESS RANKING QA STORE TRANSACTION MOCK TESTS';
}
console.log(await fixture());
