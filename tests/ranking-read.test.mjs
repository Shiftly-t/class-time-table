import assert from 'node:assert/strict';
import {buildRankingRead} from '../ranking-read.mjs';
const date='2026-11-25';
const fact=(studentId,teacherUid,day=date,kind='regular')=>({slotId:JSON.stringify([studentId,day,'17:30','18:25']),date:day,studentId,teacherUid,endedAt:day+'T18:25:00+09:00',kind,status:'done'});
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
assert.equal((await read(req('o','cumulative',''))).period,'累計');
const profile=(uid='a',teacherUid=uid)=>({...req(uid),data:{kind:'profile',teacherUid}});
assert.deepEqual((await read({...req(),data:{kind:'profile'}})).profile,{
 teacherUid:'a',name:'講師A',totals:{slots:2,regular:2,seasonal:0,days:1,students:2},
 monthly:[{key:'2026-11',slots:2,regular:2,seasonal:0,days:1,students:2}]
});
assert.equal((await read(profile('o'))).profile,null);
await assert.rejects(()=>read(profile('x','a')),/FORBIDDEN/);
await assert.rejects(()=>read(profile('a','a/private')),/INVALID_RANKING_QUERY/);
await assert.rejects(()=>read({...profile(),data:{...profile().data,role:'owner'}}),/INVALID_RANKING_QUERY/);
await assert.rejects(()=>read(req('x')),/FORBIDDEN/);
await assert.rejects(()=>read({...req(),auth:null}),/UNAUTHENTICATED/);
await assert.rejects(()=>read({...req(),app:null}),/UNAUTHENTICATED/);
await assert.rejects(()=>read({...profile(),app:null}),/UNAUTHENTICATED/);
state.set('systemConfig/maintenance',{enabled:true});
await assert.rejects(()=>read(profile()),/UNAVAILABLE/);
state.delete('systemConfig/maintenance');
state.set('systemConfig/restoreJob',{active:true});
await assert.rejects(()=>read(req()),/UNAVAILABLE/);
state.delete('systemConfig/restoreJob');
state.set('rankingInternalConfig/runtime',{enabled:true,publicationEnabled:false,trackingStart:date});
await assert.rejects(()=>read(req()),/NOT_PUBLISHED/);
state.set('rankingInternalConfig/runtime',{enabled:true,publicationEnabled:true,trackingStart:'2026-11-24'});
const missing=await read(req());
assert.equal(missing.coverage.complete,false);
assert.equal(missing.rows.length,0);
assert.deepEqual((await read(profile())).profile,{teacherUid:'a',name:'講師A',totals:null,monthly:[]});
state.set('rankingInternalConfig/runtime',{enabled:true,publicationEnabled:true,trackingStart:date});
state.delete('users/b');
await assert.rejects(()=>read(req()),/HISTORICAL_ROSTER_REQUIRED/);
const original=state.get('rankingInternalDays/'+date);
state.set('rankingInternalDays/'+date,{...original,teacherRoster:[{uid:'b',role:'admin',name:'退職した講師B',email:'private-email'}]});
const retired=await read(profile('o','b'));
assert.equal(retired.profile.name,'退職した講師B');
assert.equal(retired.profile.totals.slots,1);
assert(!JSON.stringify(retired).includes('private'));
await assert.rejects(()=>read(req('b')),/FORBIDDEN/);
state.set('users/b',{role:'owner',name:'現在は運営'});
assert.equal((await read(profile('b'))).profile.name,'退職した講師B');
state.set('users/b',{role:'admin',name:'現在の講師B'});
assert.equal((await read(profile('b'))).profile.name,'現在の講師B');
state.set('users/c',{role:'employee',name:'未担当'});
assert.deepEqual((await read(profile('c'))).profile.totals,{slots:0,regular:0,seasonal:0,days:0,students:0});

const first='2026-11-30',last='2026-12-02';
state.set('rankingInternalConfig/runtime',{enabled:true,publicationEnabled:true,trackingStart:first});
for(const day of [first,'2026-12-01',last]){
 const facts=day===last?[]:[fact('private-same-student','a',day,day===first?'regular':'seasonal')];
 state.set('rankingInternalDays/'+day,{date:day,revision:1,facts});
}
const december=buildRankingRead({db,clock:()=> '2026-12-02T15:01:00.000Z'});
const cumulative=await december(req('a','cumulative',''));
assert.deepEqual(cumulative.coverage,{expected:3,recorded:3,complete:true,from:first,to:last});
assert.deepEqual(cumulative.rows,[{teacherUid:'a',name:'講師A',rank:1,slots:2,regular:1,seasonal:1,days:2,students:1}]);
const trends=(await december(profile())).profile;
assert.equal(trends.totals.students,1);
assert.deepEqual(trends.monthly,[
 {key:'2026-11',slots:1,regular:1,seasonal:0,days:1,students:1},
 {key:'2026-12',slots:1,regular:0,seasonal:1,days:1,students:1}
]);
assert(!JSON.stringify(trends).includes('private'));
const dayPath='rankingInternalDays/'+last;
const finalDay=state.get(dayPath);
state.set(dayPath,{...finalDay,facts:[fact('duplicate','a',last),fact('duplicate','b',last)]});
await assert.rejects(()=>december(profile()),/RANKING_INVALID_FACT/);
state.set(dayPath,finalDay);

const trackingStart='2025-12-01';
state.set('rankingInternalConfig/runtime',{enabled:true,publicationEnabled:true,trackingStart});
for(let time=Date.parse(trackingStart);time<Date.parse(first);time+=86400000){
 const day=new Date(time).toISOString().slice(0,10);
 state.set('rankingInternalDays/'+day,{date:day,revision:1,facts:[]});
}
const overYear=await december(req('a','cumulative',''));
assert.equal(overYear.coverage.expected,367);
assert.equal(overYear.coverage.complete,true);
assert.equal(overYear.rows[0].slots,2);
const lastAcademicYear=await december(req('a','year','2025'));
assert.equal(lastAcademicYear.coverage.to,'2026-03-31');
assert.equal(lastAcademicYear.rows.length,0);
assert.throws(()=>buildRankingRead({db:{...db,projectId:'shiftly-d02f6'}}),/TARGET_MISMATCH/);
console.log('SUCCESS RANKING READ ACCESS FIXTURE TESTS');
