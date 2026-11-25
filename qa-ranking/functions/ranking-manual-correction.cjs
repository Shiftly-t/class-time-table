'use strict';
const {hasRankingSourceLock}=require('./ranking-authority-lock.cjs');
function createManualCorrection({coor,core}){
 const {db,fail}=coor;
 async function prepare(ctx,d,courseId){
  if(d.correction===undefined)return;
  const c=d.correction;
  if(!['admin','owner'].includes(ctx.role)||ctx.domain!=='seasonal'||ctx.action!=='publishManualCourse')fail('permission-denied','Administrator required');
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).sort().join(',')!=='date,reason'||!core.dateOk(c.date)||typeof c.reason!=='string'||!c.reason.trim()||c.reason.length>300)fail('invalid-argument','Invalid ranking correction');
  const [runtime,coordination,authority,captured]=await Promise.all([
   coor.get('rankingInternalConfig/runtime'),coor.get('systemConfig/coordination'),coor.get('systemConfig/normalAuthority'),coor.get('rankingInternalSnapshots/'+c.date)
  ]);
  if(runtime.get('enabled')!==true||runtime.get('correctionIntegrationVerified')!==true||
     !hasRankingSourceLock(coordination.data(),authority.data())||captured.data()?.source?.schema!==1||
     captured.data()?.source?.course?.id!==courseId||captured.get('date')!==c.date)fail('failed-precondition','RANKING_CORRECTION_NOT_READY');
  ctx.rankingCorrection={date:c.date,reason:c.reason.trim()};
 }
 function checkRow(ctx,before,after){
  if(!ctx.rankingCorrection)return;
  for(const row of [before,after].filter(Boolean)){
   if(row.date!==ctx.rankingCorrection.date||typeof row.end!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.end)||!(Date.parse(row.date+'T'+row.end+':00+09:00')<=ctx.now))fail('failed-precondition','RANKING_CORRECTION_DATE_OR_TIME');
  }
 }
 return {prepare,checkRow};
}
module.exports={createManualCorrection};
