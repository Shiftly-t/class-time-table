// QA-only adapter candidate. Not a deployed callable. Never use client-provided facts.
import {createHash} from 'node:crypto';
import {deriveDailyRanking} from './ranking-daily.mjs';
import {planRankingLedger} from './ranking-ledger.mjs';
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
 // Called only inside a trusted scheduled server process. Resolver must read all source data through tx.
 async function capture(date,resolve){
  verifyDate(date);
  if(typeof resolve!=='function')throw Error('MISSING_AUTHORITATIVE_RESOLVER');
  const now=clock(),time=Date.parse(now),start=Date.parse(date+'T00:00:00+09:00');
  if(!Number.isFinite(time)||time<start||time>=start+86400000)throw Error('CAPTURE_NOT_SAME_DAY');
  const target=ref('rankingInternalSnapshots',date);
  return db.runTransaction(async tx=>{
   check(data(await tx.get(configRef)),date);
   const old=data(await tx.get(target));
   if(old)return {state:'alreadyCaptured',date};
   // Resolve only on the current day, from consistent transaction reads; never from a client body.
   const result=await resolve({tx,date,capturedAt:now});
   if(result?.snapshot?.date!==date||result.snapshot.capturedAt!==now||result.snapshot.complete!==true||!Array.isArray(result.teachers))throw Error('INCOMPLETE_AUTHORITATIVE_SNAPSHOT');
   // Validate completion and exclusions now using a hypothetical next-midnight cutoff.
   const validated=derive({snapshot:result.snapshot,teachers:result.teachers,trackingStart:date,cutoff:new Date(start+86400000).toISOString()});
   if(validated.canPublish!==true)throw Error('CAPTURE_VALIDATION_FAILED');
   const record={date,capturedAt:now,facts:validated.facts};
   sizeCheck(record);tx.create(target,record);return {state:'captured',date,slots:record.facts.length};
  });
 }
 async function apply(date,commandFactory){
  verifyDate(date);const now=clock(),time=Date.parse(now);
  if(!Number.isFinite(time)||time<Date.parse(date+'T00:00:00+09:00')+86400000)throw Error('DAY_NOT_FINISHED');
  return db.runTransaction(async tx=>{
   check(data(await tx.get(configRef)),date);
   const dayRef=ref('rankingInternalDays',date),current=data(await tx.get(dayRef));
   const command=await commandFactory({tx,current,now});
   if(!command||typeof command.operationId!=='string'||!command.operationId||command.operationId.length>256)throw Error('INVALID_OPERATION_ID');
   const opKey=digest(JSON.stringify([date,command.operationId]));
   if(!/^[a-f0-9]{64}$/.test(opKey))throw Error('INVALID_OPERATION_DIGEST');
   const opRef=ref('rankingInternalOperations',opKey);
   const priorOperation=data(await tx.get(opRef));
   const result=plan({date,current,command,priorOperation,now});
   if(result.replayed)return {state:'replayed',date,revision:result.revision};
   const revKey=date+'_'+result.revision;
   for(const d of [result.day,result.operation,result.audit,result.refresh])sizeCheck(d);
   tx.set(dayRef,result.day);
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
   return {kind:'capture',actor:'system',operationId:'capture-v1',expectedRevision:0,canPublish:true,facts:captured.facts};
  });
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
