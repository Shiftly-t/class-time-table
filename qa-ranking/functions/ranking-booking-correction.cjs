'use strict';
const {hasRankingSourceLock}=require('./ranking-authority-lock.cjs');
const validId=s=>typeof s==='string'&&/^[\w-]{1,150}$/.test(s);
function createBookingCorrection({coor,core}){
 const {db,F,fail}=coor;
 async function prepare(ctx,d){
  if(d.correction===undefined&&ctx.action!=='setPublishedAttendance')return;
  const c=d.correction;
  if(ctx.domain!=='admin'||!['admin','owner'].includes(ctx.role)||!['changePublished','cancelConfirmed','setPublishedAttendance'].includes(ctx.action))fail('permission-denied','Administrator required');
  if(!c||Object.keys(c).sort().join(',')!=='date,reason'||!core.dateOk(c.date)||typeof c.reason!=='string'||!c.reason.trim()||c.reason.length>300||!validId(d.courseId)||!validId(d.studentId)||!Number.isSafeInteger(d.expectedRevision)||d.expectedRevision<0)fail('invalid-argument','Invalid ranking correction');
  const from=ctx.action==='changePublished'?d.from:d.slotId,to=ctx.action==='changePublished'?d.to:from;
  const [course,entry,runtime,coord,authority,snapshot]=await Promise.all([
   coor.get('specialCourses/'+d.courseId),coor.get('bookingEntries/'+d.courseId+'__'+d.studentId),
   coor.get('rankingInternalConfig/runtime'),coor.get('systemConfig/coordination'),coor.get('systemConfig/normalAuthority'),coor.get('rankingInternalSnapshots/'+c.date)
  ]);
  const archive=snapshot.data()?.source;
  if(runtime.get('enabled')!==true||runtime.get('correctionIntegrationVerified')!==true||!hasRankingSourceLock(coord.data(),authority.data())||archive?.schema!==1||archive.date!==c.date||archive.course?.id!==d.courseId||!course.exists||course.get('archived')===true)fail('failed-precondition','RANKING_CORRECTION_NOT_READY');
  if(!entry.exists||entry.get('revision')!==d.expectedRevision)fail('aborted','Booking changed; reload');
  const item=(entry.get('confirmed')||[]).find(v=>v.slotId===from&&v.published===true);
  if(!item||!validId(item.lessonId)||!item.lessonId.startsWith('b_'))fail('failed-precondition','RANKING_PUBLISHED_LESSON_REQUIRED');
  const cv={id:course.id,...course.data()};
  for(const slot of [from,to]){
   const p=core.periodFromSlot(cv,slot),frozen=archive.course.periods[p.index];
   if(p.date!==c.date||!frozen||frozen.start!==p.start||frozen.end!==p.end||!(Date.parse(p.date+'T'+p.end+':00+09:00')<=ctx.now))fail('failed-precondition','RANKING_CORRECTION_DATE_OR_TIME');
  }
  const ref='timetableEntries/'+item.lessonId,lesson=await coor.get(ref),p=core.periodFromSlot(cv,from);
  if(!lesson.exists||lesson.get('courseId')!==d.courseId||lesson.get('studentId')!==d.studentId||lesson.get('teacherUid')!==item.teacherUid||lesson.get('date')!==p.date||lesson.get('start')!==p.start||lesson.get('end')!==p.end)fail('failed-precondition','RANKING_BOOKING_BASELINE_CONFLICT');
  ctx.rankingCorrection={date:c.date,reason:c.reason.trim(),booking:{path:ref,courseId:d.courseId,studentId:d.studentId,to,from,teacherUid:d.teacherUid||item.teacherUid}};
 }
 async function attendance(ctx,d){
  const b=ctx.rankingCorrection?.booking;
  if(!b||!['scheduled','done','cancelled'].includes(d.status))fail('invalid-argument','Invalid attendance correction');
  const lesson=await coor.get(b.path);
  if(lesson.get('status')===d.status)return {ok:true,unchanged:true};
  await lesson.ref.update({status:d.status});
  await db.doc('specialCourses/'+b.courseId+'/scheduleMeta/state').set({version:F.increment(1),updatedBy:ctx.actor,updatedAt:F.serverTimestamp()},{merge:true});
  await db.doc('bookingEntries/'+b.courseId+'__'+b.studentId).update({revision:F.increment(1),updatedAt:F.serverTimestamp()});
  await db.collection('bookingAudit').doc().create({courseId:b.courseId,studentId:b.studentId,actor:ctx.actor,action:'公開授業出欠訂正',detail:JSON.stringify({slotId:b.from,status:d.status,reason:ctx.rankingCorrection.reason}),createdAt:F.serverTimestamp()});
  return {ok:true};
 }
 return {prepare,attendance};
}
module.exports={createBookingCorrection};
