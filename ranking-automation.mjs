import {createQaRankingStore} from './ranking-qa-store.mjs';
// A scheduled event identifies a fixed Japanese business date, even on a retry.
const JST_OFFSET=9*3600000;
const DAY_MS=86400000;
const dateJst=ms=>new Date(ms+JST_OFFSET).toISOString().slice(0,10);
const timeJst=ms=>new Date(ms+JST_OFFSET).toISOString().slice(11,23);
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const scheduleInstant=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&iso(s.slice(0,10))?Date.parse(s):NaN;
export function createRankingAutomation({db,resolve,clock=()=>new Date().toISOString(),storeFactory=createQaRankingStore}){
 if(db?.projectId!=='shiftly-t-test'||db.databaseId!=='shiftly-qa-v1')throw Error('QA_RANKING_TARGET_MISMATCH');
 if(typeof resolve!=='function')throw Error('MISSING_RESOLVER');

 async function execute(kind,date,checkTiming){
  checkTiming();
  // The same transaction reads operational gates and all source data before writing.
  const scoped={
   projectId:db.projectId,databaseId:db.databaseId,
   collection:name=>db.collection(name),
   runTransaction:fn=>db.runTransaction(async tx=>{
    const [config,maintenance,restore]=await Promise.all([
     tx.get(db.doc('rankingInternalConfig/runtime')),
     tx.get(db.doc('systemConfig/maintenance')),
     tx.get(db.doc('systemConfig/restoreJob'))
    ]);
    const c=config.exists?config.data():null;
    if(c?.enabled!==true||c.automationEnabled!==true||c.correctionIntegrationVerified!==true)return {state:'disabled',date};
    if(!iso(c.trackingStart))throw Error('RANKING_INVALID_TRACKING_START');
    if(date<c.trackingStart)return {state:'beforeTrackingStart',date};
    if(restore.exists||maintenance.data()?.enabled===true)throw Error('RANKING_MAINTENANCE_OR_RESTORE');
    // Re-check within each Firestore retry and before committing buffered writes.
    checkTiming();
    const result=await fn(tx);
    checkTiming();
    return result;
   })
  };
  const store=storeFactory({db:scoped,projectId:db.projectId,databaseId:db.databaseId,clock});
  return kind==='capture'?store.capture(date,resolve):store.finalize(date);
 }

 return async function run(kind,event){
  if(kind==='recoverFinalization'){
   const date=event?.date;
   if(!iso(date))throw Error('INVALID_DATE');
   // This route only reads an existing same-day snapshot; it cannot call the resolver.
   const due=Date.parse(date+'T00:10:00+09:00')+DAY_MS;
   return execute('finalize',date,()=>{
    const now=Date.parse(clock());
    if(!Number.isFinite(now)||now<due)throw Error('RANKING_FINALIZATION_NOT_DUE');
   });
  }
  if(!['capture','finalize'].includes(kind))throw Error('INVALID_AUTOMATION_KIND');
  const scheduled=scheduleInstant(event?.scheduleTime);
  if(!Number.isFinite(scheduled))throw Error('RANKING_INVALID_SCHEDULE_TIME');
  if(timeJst(scheduled)!==(kind==='capture'?'23:55:00.000':'00:10:00.000'))throw Error('RANKING_UNEXPECTED_SCHEDULE_TIME');
  const runDay=dateJst(scheduled);
  const date=dateJst(scheduled-(kind==='finalize'?DAY_MS:0));
  return execute(kind,date,()=>{
   const actual=Date.parse(clock());
   if(!Number.isFinite(actual)||actual<scheduled||dateJst(actual)!==runDay)throw Error('RANKING_SCHEDULE_OUTSIDE_DAY');
  });
 };
}
export function createRankingSchedules({onSchedule,run,logger=console,serviceAccount}){
 const options={region:'asia-northeast1',timeZone:'Asia/Tokyo',retryCount:2,minBackoffSeconds:30,maxBackoffSeconds:60,timeoutSeconds:120,maxInstances:1};
 if(serviceAccount)options.serviceAccount=serviceAccount;
 const knownErrors=new Set(['RANKING_SCHEDULE_JOB_REQUIRED','RANKING_INVALID_SCHEDULE_TIME','RANKING_UNEXPECTED_SCHEDULE_TIME','RANKING_SCHEDULE_OUTSIDE_DAY','RANKING_INVALID_TRACKING_START','RANKING_MAINTENANCE_OR_RESTORE','MISSING_DAILY_SNAPSHOT','CAPTURE_NOT_SAME_DAY','INCOMPLETE_AUTHORITATIVE_SNAPSHOT','CAPTURE_VALIDATION_FAILED','RANKING_SOURCE_LIMIT','RANKING_AUTHORITY_NOT_READY','RANKING_SEASONAL_RESOLVER_NOT_READY','RANKING_DOCUMENT_SIZE_LIMIT']);
 const handler=(kind,label)=>async event=>{
  try{
   const {state,date}=await run(kind,event);
   logger.info(label,{state,date});
  }catch(error){
   const reason=knownErrors.has(error?.message)?error.message:'RANKING_JOB_FAILED';
   logger.error(label,{reason,scheduleTime:scheduleInstant(event?.scheduleTime)?event.scheduleTime:null});
   // Firebase Scheduler observes the failure and retries without exposing source details.
   throw Error(reason);
  }
 };
 return {
  qaRankingCaptureDaily:onSchedule({...options,schedule:'55 23 * * *'},handler('capture','RANKING_CAPTURE')),
  qaRankingFinalizeDaily:onSchedule({...options,schedule:'10 0 * * *'},handler('finalize','RANKING_FINALIZE'))
 };
}
