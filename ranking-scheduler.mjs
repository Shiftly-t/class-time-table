import {createRequire} from 'node:module';
import {createRankingAutomation,createRankingSchedules} from './ranking-automation.mjs';

const require=createRequire(import.meta.url);
const QA_RUNTIME_ACCOUNT='qa-shiftly-runtime@shiftly-t-test.iam.gserviceaccount.com';

// Construct with the existing Admin Firestore instance and server resolver.
// Export only the two Scheduler functions from a verified QA Functions entry point.
export function createQaRankingScheduler({db,resolve,clock}){
 const runtimeProjects=[process.env.GCLOUD_PROJECT,process.env.GCP_PROJECT,process.env.GOOGLE_CLOUD_PROJECT].filter(Boolean);
 if(runtimeProjects.some(project=>project!=='shiftly-t-test'))throw Error('QA_RANKING_TARGET_MISMATCH');
 const run=createRankingAutomation({db,resolve,clock});
 const {onSchedule}=require('firebase-functions/v2/scheduler');
 const logger=require('firebase-functions/logger');
 const schedules=createRankingSchedules({onSchedule,logger,serviceAccount:QA_RUNTIME_ACCOUNT,run:(kind,event)=>{
  // The SDK substitutes the current instant for manual HTTP invocations without Scheduler headers.
  if(typeof event?.jobName!=='string'||!event.jobName.trim())throw Error('RANKING_SCHEDULE_JOB_REQUIRED');
  return run(kind,event);
 }});
 return {
  ...schedules,
  recoverFinalization:date=>run('recoverFinalization',{date})
 };
}
