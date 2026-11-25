'use strict';
const assert=require('node:assert/strict');
const {createRankingCallable}=require('./ranking-callable.cjs');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
let calls=0,options;
const handler=createRankingCallable({
 onCall:(opts,fn)=>{options=opts;return fn;},
 HttpsError,
 read:async req=>{calls++;if(req.data?.fail)throw Error(req.data.fail);return {rows:[{rank:1,slots:2}]};}
});
(async()=>{
 assert.equal(options.enforceAppCheck,true);
 assert.equal(options.region,'asia-northeast1');
 const valid={auth:{uid:'fixture'},app:{appId:'fixture'},data:{}};
 await assert.rejects(()=>handler({...valid,auth:null}),e=>e.code==='unauthenticated');
 await assert.rejects(()=>handler({...valid,app:null}),e=>e.code==='permission-denied');
 assert.equal(calls,0);
 assert.deepEqual(await handler(valid),{rows:[{rank:1,slots:2}]});
 for(const [fail,code] of [['RANKING_FORBIDDEN','permission-denied'],['RANKING_NOT_PUBLISHED','failed-precondition'],['RANKING_UNAVAILABLE','unavailable'],['INVALID_RANKING_QUERY','invalid-argument'],['private-student-id','internal']]){
  await assert.rejects(()=>handler({...valid,data:{fail}}),e=>e.code===code&&!e.message.includes(fail));
 }
 console.log('SUCCESS RANKING CALLABLE WRAPPER TEST');
})().catch(e=>{console.error(e);process.exitCode=1;});
