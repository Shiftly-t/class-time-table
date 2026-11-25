import {planRankingLedger} from '../ranking-ledger.mjs';
function testLedger(){
 const date='2026-11-25',now='2026-11-26T00:01:00+09:00';
 const mk=(studentId,teacherUid='a',start='17:30',end='18:25')=>({slotId:JSON.stringify([studentId,date,start,end]),studentId,teacherUid,date,endedAt:date+'T'+end+':00+09:00',kind:'regular',status:'done'});
 const f=mk('s1'),g=mk('s2'),moved={...f,teacherUid:'b'};
 const capture={kind:'capture',operationId:'cap',expectedRevision:0,actor:'system',canPublish:true,facts:[f,g]};
 const run=(current,command,priorOperation)=>planRankingLedger({date,current,command,priorOperation,now});
 const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Assertion failed: '+JSON.stringify(a));};
 const rejects=(fn,code)=>{let msg;try{fn();}catch(e){msg=e.message;}eq(msg,code);};
 const a=run(null,capture);eq(a.day.facts.length,2);eq(a.refresh.delta[0].slots,2);eq(a.refresh.academicYear,'2026');
 eq(run(a.day,capture,a.operation),{replayed:true,revision:1});
 rejects(()=>run(a.day,{...capture,operationId:'cap2',expectedRevision:1}),'DAY_ALREADY_CAPTURED');
 const correct={kind:'correct',operationId:'fix1',expectedRevision:1,actor:'manager',actorRole:'admin',reason:'担当変更・欠席訂正',changes:[{slotId:f.slotId,before:f,after:moved},{slotId:g.slotId,before:g,after:null}]};
 const b=run(a.day,correct);eq(b.day.facts.length,1);eq(b.day.facts[0].teacherUid,'b');eq(b.refresh.delta.map(x=>[x.teacherUid,x.slots]),[['a',-2],['b',1]]);eq(b.refresh.recheckAutomaticBadges,true);
 eq(run(b.day,correct,b.operation).replayed,true);
 rejects(()=>run(b.day,{...correct,reason:'different'},b.operation),'OPERATION_ID_REUSED');
 rejects(()=>run(b.day,{...correct,operationId:'stale'}),'REVISION_CONFLICT');
 rejects(()=>run(a.day,{...correct,actorRole:'employee'}),'INVALID_CORRECTION');
 rejects(()=>run(a.day,{...correct,changes:[{slotId:f.slotId,before:moved,after:null}]}),'FACT_CONFLICT');
 const add={kind:'correct',operationId:'fix2',expectedRevision:2,actor:'owner',actorRole:'owner',reason:'欠席解除',changes:[{slotId:g.slotId,before:null,after:g}]};
 const c=run(b.day,add);eq(c.day.facts.length,2);eq(c.refresh.delta[0].slots,1);eq(c.audit.changes[0].before,null);
 rejects(()=>run(null,{...capture,facts:[f,mk('s1','b','18:00','19:00')]}),'OVERLAPPING_STUDENT_SLOT');
 eq(a.day.facts.length,2);eq(a.day.facts[0].teacherUid,'a');
 return 'SUCCESS RANKING LEDGER CORRECTION FIXTURE TESTS';
}
console.log(testLedger());
