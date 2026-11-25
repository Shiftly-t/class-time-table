// QA-only adapter candidate. Not a deployed callable. Never use client-provided facts.
import {createHash} from 'node:crypto';
import {deriveDailyRanking} from './ranking-daily.mjs';
import {planRankingLedger} from './ranking-ledger.mjs';
import {archiveRankingTeachers,isRankingTeacherUid,readArchivedRankingTeachers} from './ranking-roster.mjs';
const CAPTURE_OPERATION='capture-v1';
const DAY_MILLIS=86400000;
const sameCaptureDate=(date,instant)=>{
 if(typeof instant!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(instant))return false;
 const start=Date.parse(date+'T00:00:00+09:00'),time=Date.parse(instant);
 return time>=start&&time<start+DAY_MILLIS;
};
const captureCommand=(facts,capturedRoster)=>({kind:'capture',actor:'system',operationId:CAPTURE_OPERATION,expectedRevision:0,canPublish:true,facts,capturedRoster});
export function createQaRankingStore({db,projectId,databaseId,derive=deriveDailyRanking,plan=planRankingLedger,clock=()=>new Date().toISOString(),digest=s=>createHash('sha256').update(s).digest('hex'),byteLength=s=>Buffer.byteLength(s,'utf8')}){
 if(projectId!=='shiftly-t-test'||databaseId!=='shiftly-qa-v1'||db.projectId!==projectId||db.databaseId!==databaseId)throw Error('QA_RANKING_TARGET_MISMATCH');
 if(typeof derive!=='function'||typeof plan!=='function'||typeof digest!=='function'||typeof byteLength!=='function')throw Error('MISSING_SERVER_DEPENDENCY');
 const dateOk=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 const ref=(collection,id)=>db.collection(collection).doc(id);
 const data=s=>s.exists?s.data():null;
 const sizeCheck=value=>{if(byteLength(JSON.stringify(value))>400000)throw Error('RANKING_DOCUMENT_SIZE_LIMIT');};
 const configRef=ref('rankingInternalConfig','runtime');
 const check=(config,date)=>{if(config?.enabled!==true||!dateOk(config.trackingStart)||date<config.trackingStart)throw Error('RANKING_DISABLED_OR_BEFORE_START');};
 function verifyDate(date){if(!dateOk(date))throw Error('INVALID_DATE');}
 function operationRef(date,operationId){
  if(typeof operationId!=='string'||!operationId||operationId.length>256)throw Error('INVALID_OPERATION_ID');
  const opKey=digest(JSON.stringify([date,operationId]));
  if(!/^[a-f0-9]{64}$/.test(opKey))throw Error('INVALID_OPERATION_DIGEST');
  return ref('rankingInternalOperations',opKey);
 }
 async function fillRoster(tx,facts,previous){
  const archived=readArchivedRankingTeachers(previous);
  const missing=[...new Set(facts.map(f=>f.teacherUid))].filter(uid=>!archived.has(uid));
  if(missing.length>300||missing.some(uid=>!isRankingTeacherUid(uid)))throw Error('RANKING_INVALID_ROSTER');
  const teachers=await Promise.all(missing.map(async uid=>{
   const user=data(await tx.get(ref('users',uid)));
   if(!user)throw Error('RANKING_HISTORICAL_ROSTER_REQUIRED');
   return {uid,role:user.role,name:user.name};
  }));
  return archiveRankingTeachers({facts,teachers,previous});
 }
 // Called only inside a trusted scheduled server process. Resolver must read all source data through tx.
 async function capture(date,resolve){
  verifyDate(date);
  if(typeof resolve!=='function')throw Error('MISSING_AUTHORITATIVE_RESOLVER');
  const now=clock(),start=Date.parse(date+'T00:00:00+09:00');
  if(!sameCaptureDate(date,now))throw Error('CAPTURE_NOT_SAME_DAY');
  const target=ref('rankingInternalSnapshots',date);
  return db.runTransaction(async tx=>{
   check(data(await tx.get(configRef)),date);
   const old=data(await tx.get(target));
   if(old)return {state:'alreadyCaptured',date};
   // Resolve only on the current day, from consistent transaction reads; never from a client body.
   const result=await resolve({tx,date,capturedAt:now});
   if(result?.snapshot?.date!==date||result.snapshot.capturedAt!==now||result.snapshot.complete!==true||!Array.isArray(result.teachers))throw Error('INCOMPLETE_AUTHORITATIVE_SNAPSHOT');
   // Validate completion and exclusions now using a hypothetical next-midnight cutoff.
   const validated=derive({snapshot:result.snapshot,teachers:result.teachers,trackingStart:date,cutoff:new Date(start+DAY_MILLIS).toISOString()});
   if(validated.canPublish!==true)throw Error('CAPTURE_VALIDATION_FAILED');
   const teacherRoster=archiveRankingTeachers({facts:validated.facts,teachers:result.teachers});
   const record={date,capturedAt:now,facts:validated.facts,teacherRoster};
   if(result.source!==undefined)record.source=result.source;
   sizeCheck(record);tx.create(target,record);return {state:'captured',date,slots:record.facts.length};
  });
 }
 async function apply(date,commandFactory,{finalization=false}={}){
  verifyDate(date);const now=clock(),time=Date.parse(now);
  if(!Number.isFinite(time)||time<Date.parse(date+'T00:00:00+09:00')+DAY_MILLIS)throw Error('DAY_NOT_FINISHED');
  return db.runTransaction(async tx=>{
   check(data(await tx.get(configRef)),date);
   const dayRef=ref('rankingInternalDays',date),current=data(await tx.get(dayRef));
   let opRef,priorOperation;
   if(finalization){
    opRef=operationRef(date,CAPTURE_OPERATION);
    priorOperation=data(await tx.get(opRef));
    if(priorOperation){
     if(current?.date!==date||!Number.isSafeInteger(current.revision)||current.revision<1||!Array.isArray(current.facts)||priorOperation.revision!==1)throw Error('INVALID_CAPTURE_RECEIPT');
     // The receipt identifies the closed-day capture. Later corrections legitimately replace snapshot facts.
     let facts;
     try{facts=JSON.parse(priorOperation.signature).facts;}catch{throw Error('INVALID_CAPTURE_RECEIPT');}
     const replay=plan({date,current,command:captureCommand(facts),priorOperation,now});
     if(!replay.replayed||replay.revision!==1)throw Error('INVALID_CAPTURE_RECEIPT');
     return {state:'replayed',date,revision:replay.revision};
    }
   }
   const command=await commandFactory({tx,current,now});
   if(!opRef){
    opRef=operationRef(date,command?.operationId);
    priorOperation=data(await tx.get(opRef));
   }
   const result=plan({date,current,command,priorOperation,now});
   if(result.replayed)return {state:'replayed',date,revision:result.revision};
   const teacherRoster=await fillRoster(tx,result.day.facts,current?.teacherRoster??command.capturedRoster);
   const day={...result.day,teacherRoster};
   const revKey=date+'_'+result.revision;
   for(const d of [day,result.operation,result.audit,result.refresh])sizeCheck(d);
   tx.set(dayRef,day);
   tx.create(opRef,result.operation);
   tx.create(ref('rankingInternalAudit',revKey),result.audit);
   tx.create(ref('rankingInternalRefresh',revKey),{...result.refresh,status:'pending',createdAt:now});
   return {state:'committed',date,revision:result.revision};
  });
 }
 async function finalize(date){
  return apply(date,async({tx})=>{
   const captured=data(await tx.get(ref('rankingInternalSnapshots',date)));
   if(!captured||captured.date!==date||!Array.isArray(captured.facts))throw Error('MISSING_DAILY_SNAPSHOT');
   if(!sameCaptureDate(date,captured.capturedAt))throw Error('INVALID_DAILY_SNAPSHOT_CAPTURE_TIME');
   return captureCommand(captured.facts,captured.teacherRoster);
  },{finalization:true});
 }
 // Not an exported callable. A future trusted authority adapter must verify source mutation,
 // actor identity/role and old/new facts in this same transaction, never take facts from client.
 async function correct(date,resolveCorrection){
  if(typeof resolveCorrection!=='function')throw Error('MISSING_CORRECTION_AUTHORITY');
  return apply(date,async context=>{
   const c=await resolveCorrection(context);
   if(c?.kind!=='correct'||!['owner','admin'].includes(c.actorRole))throw Error('UNAUTHORIZED_CORRECTION');
   return c;
  });
 }
 return {capture,finalize,correct};
}
