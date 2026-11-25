'use strict';
function resolveSeasonalDay({date,course,lessons,bookings,teachers,students,availability,periodFromSlot,allows,closed}){
 if(!course||!Array.isArray(course.periods)||!course.periods.length||course.periods.length>12||date<course.startDate||date>course.endDate)throw Error('RANKING_INVALID_COURSE');
 if(!course.periods.every((p,i)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end)&&p.start<p.end&&(!i||course.periods[i-1].end<=p.start)))throw Error('RANKING_INVALID_COURSE_PERIODS');
 const rows=lessons.filter(e=>e.date===date&&e.courseId===course.id);
 const matched=new Set(),teacherIds=new Set(teachers.map(t=>t.uid)),studentMap=new Map(students.map(s=>[s.id,s]));
 for(const b of bookings){
  if(b.courseId!==course.id||!Array.isArray(b.confirmed))throw Error('RANKING_INVALID_BOOKING');
  for(const item of b.confirmed){
   if(item.published!==true)continue;
   const p=periodFromSlot(course,item.slotId);
   if(p.date!==date)continue;
   const period=course.periods[p.index];
   if(!period)throw Error('RANKING_UNKNOWN_BOOKING_PERIOD');
   const hits=rows.filter(e=>e.id.startsWith('b_')&&e.studentId===b.studentId&&e.teacherUid===item.teacherUid&&e.start===period.start&&e.end===period.end);
   if(hits.length!==1||matched.has(hits[0].id))throw Error('RANKING_BOOKING_MATCH_FAILED');
   matched.add(hits[0].id);
  }
 }
 const out=[],unavailableSlots=[];
 for(const e of rows){
  if(e.id.startsWith('b_')&&!matched.has(e.id))throw Error('RANKING_UNMATCHED_BOOKING_LESSON');
  if(!['scheduled','done','cancelled'].includes(e.status))throw Error('RANKING_UNKNOWN_STATUS');
  if(e.status==='cancelled')continue;
  const i=course.periods.findIndex(p=>p.start===e.start&&p.end===e.end);
  if(i<0||!teacherIds.has(e.teacherUid)||!studentMap.has(e.studentId))throw Error('RANKING_INVALID_SEASONAL_ASSIGNMENT');
  if(!allows(studentMap.get(e.studentId),date))continue;
  if(closed)throw Error('RANKING_CLOSED_DAY_HAS_LESSON');
  if(course.archived===true)throw Error('RANKING_ARCHIVED_ACTIVE_COURSE');
  if(!availability.get(e.teacherUid)?.includes(date+'_'+i))throw Error('RANKING_SEASONAL_AVAILABILITY_CONFLICT');
  out.push({id:e.id,date:e.date,studentId:e.studentId,teacherUid:e.teacherUid,start:e.start,end:e.end,status:e.status,courseId:e.courseId});
 }
 return {entries:out,unavailableSlots};
}
module.exports={resolveSeasonalDay};
