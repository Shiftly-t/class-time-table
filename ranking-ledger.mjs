// Trusted server-side ledger planner; not a client API. Caller must resolve authorization and source changes.
export function planRankingLedger({date,current,command,priorOperation,now}){
 const fail=code=>{throw Error(code);};
 const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 const validTime=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
 const id=s=>typeof s==='string'&&s.length>0&&s.length<=256;
 if(!validDate(date)||!Number.isFinite(Date.parse(now))||Date.parse(now)<Date.parse(date+'T00:00:00+09:00')+86400000)fail('DAY_NOT_FINISHED');
 if(!command||!id(command.operationId)||!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0||!['capture','correct'].includes(command.kind))fail('INVALID_COMMAND');
 function fact(f){
  if(!f||!id(f.studentId)||!id(f.teacherUid)||f.date!==date||f.status!=='done'||!['regular','seasonal'].includes(f.kind))fail('INVALID_FACT');
  let slot;try{slot=JSON.parse(f.slotId);}catch{fail('INVALID_SLOT_ID');}
  if(!Array.isArray(slot)||slot.length!==4||slot[0]!==f.studentId||slot[1]!==date||!validTime(slot[2])||!validTime(slot[3])||slot[2]>=slot[3]||JSON.stringify(slot)!==f.slotId||f.endedAt!==date+'T'+slot[3]+':00+09:00')fail('INVALID_SLOT_ID');
  return {slotId:f.slotId,teacherUid:f.teacherUid,studentId:f.studentId,date,endedAt:f.endedAt,kind:f.kind,status:'done'};
 }
 function facts(fs){
  if(!Array.isArray(fs)||fs.length>4000)fail('INVALID_FACTS');
  const sorted=fs.map(fact).sort((a,b)=>a.slotId<b.slotId?-1:a.slotId>b.slotId?1:0),seen=new Set(),students=new Map();
  for(const f of sorted){
   if(seen.has(f.slotId))fail('DUPLICATE_SLOT');seen.add(f.slotId);
   const [, ,start,end]=JSON.parse(f.slotId);
   const slots=students.get(f.studentId)||[];
   if(slots.some(p=>p.start<end&&p.end>start))fail('OVERLAPPING_STUDENT_SLOT');
   slots.push({start,end});students.set(f.studentId,slots);
  }
  return sorted;
 }
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 let payload;
 if(command.kind==='capture'){
  if(command.actor!=='system'||command.canPublish!==true)fail('UNVERIFIED_CAPTURE');
  payload={kind:'capture',expectedRevision:command.expectedRevision,actor:'system',facts:facts(command.facts)};
 }else{
  if(!id(command.actor)||command.actor==='system'||!['admin','owner'].includes(command.actorRole)||typeof command.reason!=='string'||!command.reason.trim()||command.reason.length>500||!Array.isArray(command.changes)||!command.changes.length||command.changes.length>400)fail('INVALID_CORRECTION');
  const changes=command.changes.map(c=>{
   if(!c||typeof c.slotId!=='string'||(!c.before&&!c.after))fail('INVALID_CHANGE');
   const before=c.before===null?null:fact(c.before),after=c.after===null?null:fact(c.after);
   if((before&&before.slotId!==c.slotId)||(after&&after.slotId!==c.slotId)||same(before,after))fail('INVALID_CHANGE');
   return {slotId:c.slotId,before,after};
  }).sort((a,b)=>a.slotId<b.slotId?-1:a.slotId>b.slotId?1:0);
  if(new Set(changes.map(c=>c.slotId)).size!==changes.length)fail('DUPLICATE_CHANGE');
  payload={kind:'correct',expectedRevision:command.expectedRevision,actor:command.actor,actorRole:command.actorRole,reason:command.reason.trim(),changes};
 }
 const signature=JSON.stringify(payload);
 if(priorOperation){
  if(priorOperation.operationId!==command.operationId||priorOperation.signature!==signature||priorOperation.date!==date)fail('OPERATION_ID_REUSED');
  return {replayed:true,revision:priorOperation.revision};
 }
 if(current&&(current.date!==date||!Number.isSafeInteger(current.revision)||current.revision<1))fail('INVALID_LEDGER');
 const rev=current?.revision||0;
 if(command.expectedRevision!==rev)fail('REVISION_CONFLICT');
 let before=current?facts(current.facts):[],after;
 if(payload.kind==='capture'){
  if(current)fail('DAY_ALREADY_CAPTURED');
  after=payload.facts;
 }else{
  if(!current)fail('DAY_NOT_CAPTURED');
  const map=new Map(before.map(f=>[f.slotId,f]));
  for(const c of payload.changes){
   if(!same(map.get(c.slotId)||null,c.before))fail('FACT_CONFLICT');
   if(c.after)map.set(c.slotId,c.after);else map.delete(c.slotId);
  }
  after=facts([...map.values()]);
 }
 const bm=new Map(before.map(f=>[f.slotId,f])),am=new Map(after.map(f=>[f.slotId,f])),changes=[];
 const delta=new Map();
 const add=(f,n)=>{if(!f)return;const row=delta.get(f.teacherUid)||{teacherUid:f.teacherUid,slots:0,regular:0,seasonal:0};row.slots+=n;row[f.kind]+=n;delta.set(f.teacherUid,row);};
 for(const k of new Set([...bm.keys(),...am.keys()])){
  const b=bm.get(k)||null,a=am.get(k)||null;if(same(b,a))continue;
  changes.push({slotId:k,before:b,after:a});add(b,-1);add(a,1);
 }
 const year=Number(date.slice(0,4))-(Number(date.slice(5,7))<4?1:0);
 const revision=rev+1;
 return {replayed:false,revision,day:{date,revision,facts:after,updatedAt:now},
 operation:{date,operationId:command.operationId,signature,revision},
 audit:{date,revision,operationId:command.operationId,kind:payload.kind,actor:payload.actor,reason:payload.reason||'日次自動集計',at:now,changes},
 refresh:{date,revision,month:date.slice(0,7),academicYear:String(year),teacherUids:[...new Set(changes.flatMap(c=>[c.before?.teacherUid,c.after?.teacherUid]).filter(Boolean))].sort(),delta:[...delta.values()].filter(d=>d.slots||d.regular||d.seasonal),recomputeDistinctCounts:true,recheckAutomaticBadges:true}};
}
