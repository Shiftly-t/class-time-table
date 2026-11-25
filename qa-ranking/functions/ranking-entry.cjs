'use strict';
const {initializeApp} = require('firebase-admin/app');
const {getFirestore,FieldValue} = require('firebase-admin/firestore');
const {onCall,HttpsError} = require('firebase-functions/v2/https');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const {createRankingCallable} = require('./ranking-callable.cjs');
const {createRankingAchievementCallable} = require('./ranking-achievement-callable.cjs');
const {createRankingResolver} = require('./ranking-resolver.cjs');
const {buildRankingRead} = require('./ranking-read.mjs');
const {createRankingAchievements} = require('./ranking-achievement-store.mjs');
const {createQaRankingScheduler} = require('./ranking-scheduler.mjs');
const {withRankingSourceLock} = require('./ranking-authority-lock.cjs');
const {periodFromSlot} = require('./booking-core.cjs');

const projectId = 'shiftly-t-test';
const runtimeProjects = [process.env.GCLOUD_PROJECT,process.env.GOOGLE_CLOUD_PROJECT,process.env.GCP_PROJECT].filter(Boolean);
if (!runtimeProjects.length || runtimeProjects.some(project => project !== projectId)) throw Error('QA_RANKING_TARGET_MISMATCH');
const db = withRankingSourceLock(getFirestore(initializeApp({projectId}),'shiftly-qa-v1'));
const serviceAccount = 'qa-shiftly-runtime@shiftly-t-test.iam.gserviceaccount.com';
const qaCallable = (options,handler) => onCall({...options,serviceAccount},handler);
const resolve = createRankingResolver(db,{enableSeasonal:true,periodFromSlot,archiveDateSource:true});
const {qaRankingCaptureDaily,qaRankingFinalizeDaily} = createQaRankingScheduler({db,resolve});
const achievements = createRankingAchievements({db,notificationTimestamp:FieldValue.serverTimestamp});
const qaRankingReadApi = createRankingCallable({onCall:qaCallable,HttpsError,read:buildRankingRead({db})});
const qaRankingAchievementApi = createRankingAchievementCallable({onCall:qaCallable,HttpsError,handle:achievements.handle});
const qaRankingProcessAchievements = onSchedule({
  region:'asia-northeast1',timeZone:'Asia/Tokyo',schedule:'*/10 * * * *',
  timeoutSeconds:120,maxInstances:1,retryCount:2,minBackoffSeconds:30,maxBackoffSeconds:60,serviceAccount
}, async event => {
  if (!event?.jobName) throw Error('RANKING_SCHEDULE_JOB_REQUIRED');
  const output = await achievements.runPending({limit:5});
  if (output.some(item => item.state === 'failed')) {
    logger.error('RANKING_ACHIEVEMENT_WORK_INCOMPLETE',{failures:output.filter(item=>item.state==='failed').length});
    throw Error('RANKING_ACHIEVEMENT_WORK_INCOMPLETE');
  }
  logger.info('RANKING_ACHIEVEMENT_WORK',{state:output.length?'processed':'idle',processed:output.length});
});
module.exports = {qaRankingReadApi,qaRankingAchievementApi,qaRankingCaptureDaily,qaRankingFinalizeDaily,qaRankingProcessAchievements};
