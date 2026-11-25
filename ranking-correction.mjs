// Internal correction planner; not callable and not yet wired to the existing coordinator.
// Inputs must be trusted, validated before/after facts for the same explicit date-specific edit.
import {planRankingLedger} from './ranking-ledger.mjs';
export function planDateCorrection({date,current,beforeFacts,afterFacts,actor,actorRole,operationId,reason,now}){
 if(!current||current.date!==date||!Array.isArray(current.facts))throw Error('RANKING_DAY_NOT_CAPTURED');
 if(!['owner','admin'].includes(actorRole))throw Error('RANKING_CORRECTION_FORBIDDEN');
 function map(facts){
  if(!Array.isArray(facts)||facts.length>4000)throw Error('RANKING_INVALID_PROJECTION');
  const m=new Map();
  for(const f of facts){
   if(!f||f.date!==date||f.status!=='done'||typeof f.slotId!=='string'||m.has(f.slotId))throw Error('RANKING_INVALID_PROJECTION');
   // Restrict equality to the canonical fields; never carry labels or memos.
   m.set(f.slotId,{slotId:f.slotId,teacherUid:f.teacherUid,studentId:f.studentId,date:f.date,endedAt:f.endedAt,kind:f.kind,status:f.status});
  }
  return m;
 }
 const before=map(beforeFacts),after=map(afterFacts),ledger=map(current.facts);
 const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
 const changes=[];
 for(const key of new Set([...before.keys(),...after.keys()])){
  const b=before.get(key)??null,a=after.get(key)??null;
  if(equal(b,a))continue;
  if(!equal(ledger.get(key),b))throw Error('RANKING_CORRECTION_BASELINE_CONFLICT');
  changes.push({slotId:key,before:b,after:a});
 }
 if(!changes.length)return {state:'unchanged'};
 const result=planRankingLedger({date,current,now,command:{kind:'correct',actor,actorRole,operationId,expectedRevision:current.revision,reason,changes}});
 return {state:'planned',result};
}
