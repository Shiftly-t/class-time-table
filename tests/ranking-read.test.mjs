import assert from 'node:assert/strict';
import {buildRankingRead} from '../ranking-read.mjs';
const date='2026-11-25';
const fact=(studentId,teacherUid)=>({slotId:JSON.stringify([studentId,date,'17:30','18:25']),date,studentId,teacherUid,endedAt:date+'T18:25:00+09:00',kind:'regular',status:'done'});
const state=new Map([
 ['users/a',{name:'講師A',role:'employee',email:'private-a'}],
 ['users/b',{name:'講師B',role:'admin'}],
 ['users/o',{name:'運営',role:'owner'}],
 ['users/x',{name:'外部',role:'guest'}],
 ['rankingInternalConfig/runtime',{enabled:true,publicationEnabled:true,trackingStart:date}],
 ['rankingInternalDays/'+date,{date,revision:1,facts:[fact('private-student-1','a'),fact('private-student-2','a'),fact('private-student-3','b')]}]
]);
const doc=(id,value)=>({id,exists:value!==undefined,data:()=>value,get:k=>value?.[k]});
const db={projectId:'shiftly-t-test',databaseId:'shiftly-qa-v1',doc:path=>({path}),collection:col=>({col,filters:[],where(k,op,v){return {...this,filters:[...this.filters,[k,op,v]]};},limit(n){return {...this,n};}}),async runTransaction(fn,options){assert.equal(options.readOnly,true);return fn({async get(q){if(q.path)return doc(q.path.split('/').at(-1),state.get(q.path));return {docs:[...state].filter(([p,v])=>p.startsWith(q.col+'/')&&q.filters.every(([k,op,b])=>op==='>='?v[k]>=b:v[k]<=b)).slice(0,q.n).map(([p,v])=>doc(p.split('/').at(-1),v))};}});}};
const read=buildRankingRead({db,clock:()=> '2026-11-26T09:00:00+09:00'});
const req=(uid='a',kind='month',key='2026-11')=>({auth:{uid},app:{appId:'verified-fixture'},data:{kind,key,metric:'slots'}});
for(const uid of ['a','b','o']){
 const result=await read(req(uid));
 assert.deepEqual(result.rows.map(r=>[r.name,r.rank,r.slots]),[['講師A',1,2],['講師B',2,1]]);
 assert.equal(result.coverage.complete,true);
 assert(!JSON.stringify(result).includes('private'));
}
assert.equal((await read(req('a','year','2026'))).rows[0].slots,2);
await assert.rejects(()=>read(req('x')),/FORBIDDEN/);
await assert.rejects(()=>read({...req(),auth:null}),/UNAUTHENTICATED/);
await assert.rejects(()=>read({...req(),app:null}),/UNAUTHENTICATED/);
state.set('systemConfig/restoreJob',{active:true});
await assert.rejects(()=>read(req()),/UNAVAILABLE/);
state.delete('systemConfig/restoreJob');
state.set('rankingInternalConfig/runtime',{enabled:true,publicationEnabled:false,trackingStart:date});
await assert.rejects(()=>read(req()),/NOT_PUBLISHED/);
state.set('rankingInternalConfig/runtime',{enabled:true,publicationEnabled:true,trackingStart:'2026-11-24'});
const missing=await read(req());
assert.equal(missing.coverage.complete,false);
assert.equal(missing.rows.length,0);
state.set('rankingInternalConfig/runtime',{enabled:true,publicationEnabled:true,trackingStart:date});
state.delete('users/b');
await assert.rejects(()=>read(req()),/HISTORICAL_ROSTER_REQUIRED/);
assert.throws(()=>buildRankingRead({db:{...db,projectId:'shiftly-d02f6'}}),/TARGET_MISMATCH/);
console.log('SUCCESS RANKING READ ACCESS FIXTURE TESTS');
