import {createQaRankingStore} from './ranking-qa-store.mjs';
// QA-only scheduled handler candidate. Never enable before correction/restore integration.
const dateJst=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
const timeJst=ms=>new Date(ms+9*3600000).toISOString().slice(11,16);
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function createRankingAutomation({db,resolve,clock=()=>new Date().toISOString(),storeFactory=createQaRankingStore}){
 if(db.projectId!=='shiftly-t-test'||db.databaseId!=='shiftly-qa-v1')throw Error('QA_RANKING_TARGET_MISMATCH');
 if(typeof resolve!=='function')throw Error('MISSING_RESOLVER');
 return async function run(kind,event){
  if(!['capture','finalize'].includes(kind))throw Error('INVALID_AUTOMATION_KIND');
  const scheduled=Date.parse(event?.scheduleTime),actual=Date.parse(clock());
  if(!Number.isFinite(scheduled)||!Number.isFinite(actual)||actual<scheduled||dateJst(actual)!==dateJst(scheduled))throw Error('RANKING_SCHEDULE_OUTSIDE_DAY');
  if(timeJst(scheduled)!==(kind==='capture'?'23:55':'00:10'))throw Error('RANKING_UNEXPECTED_SCHEDULE_TIME');
  const date=dateJst(scheduled-(kind==='finalize'?86400000:0));
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
    // Re-check on each retry before source resolution; reject a capture crossing midnight.
    if(dateJst(Date.parse(clock()))!==dateJst(scheduled))throw Error('RANKING_SCHEDULE_OUTSIDE_DAY');
    return fn(tx);
   })
  };
  const store=storeFactory({db:scoped,projectId:db.projectId,databaseId:db.databaseId,clock});
  return kind==='capture'?store.capture(date,resolve):store.finalize(date);
 };
}
export function createRankingSchedules({onSchedule,run}){
 const options={region:'asia-northeast1',timeZone:'Asia/Tokyo',retryCount:2,minBackoffSeconds:30,maxBackoffSeconds:60,timeoutSeconds:120,maxInstances:1};
 return {
  qaRankingCaptureDaily:onSchedule({...options,schedule:'55 23 * * *'},async event=>{const result=await run('capture',event);console.info('RANKING_CAPTURE',result.state,result.date);}),
  qaRankingFinalizeDaily:onSchedule({...options,schedule:'10 0 * * *'},async event=>{const result=await run('finalize',event);console.info('RANKING_FINALIZE',result.state,result.date);})
 };
}
