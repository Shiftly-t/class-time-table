'use strict';
const policy=require('./normal-authority/policy.cjs');
const {automaticClosure}=require('./normal-authority/calendar.cjs');
const {resolveSeasonalDay}=require('./ranking-seasonal.cjs');
// Internal server resolver. Seasonal path is opt-in until QA verification.
function createRankingResolver(db,{enableSeasonal=false,periodFromSlot}={}){
 return async function resolve({tx,date,capturedAt}){
  policy.date(date);
  const jst=new Date(Date.parse(capturedAt)+9*3600000).toISOString().slice(0,10);
  if(jst!==date)throw Error('RANKING_SNAPSHOT_WRONG_DAY');
  const read=async path=>{const s=await tx.get(db.doc(path));return s.exists?s.data():null;};
  const query=async(col,filter,max)=>{let q=db.collection(col);if(filter)q=q.where(...filter);const s=await tx.get(q.limit(max+1));if(s.docs.length>max)throw Error('RANKING_SOURCE_LIMIT');return s.docs.map(d=>({...d.data(),id:d.id}));};
  const [maintenance,root,closed,open,exam,courses]=await Promise.all([
   read('systemConfig/maintenance'),read('normalAuthorityState/global'),read('schoolClosures/'+date),read('schoolOpenDays/'+date),read('schoolEvents/'+date),query('specialCourses',null,200)]);
  if(maintenance?.enabled||!root||!Number.isSafeInteger(root.version)||root.version<0)throw Error('RANKING_AUTHORITY_NOT_READY');
  const active=courses.filter(c=>c.startDate<=date&&date<=c.endDate);
  if(active.length>1)throw Error('RANKING_COURSE_CONFLICT');
  if(active.length&&!enableSeasonal)throw Error('RANKING_SEASONAL_RESOLVER_NOT_READY');
  const isClosed=!(open||exam?.type==='exam')&&Boolean(closed||automaticClosure(date));
  const snapshot={date,capturedAt,complete:true,closed:isClosed,entries:[],courses:[],unavailableSlots:[]};
  if(isClosed&&!active.length)return {snapshot,teachers:[]};
  const [students,stored,users]=await Promise.all([query('schoolStudents',null,1000),query('timetableEntries',['date','==',date],400),query('users',null,300)]);
  const teachers=users.filter(t=>['admin','employee'].includes(t.role)).map(t=>({uid:t.id,role:t.role}));
  const teacherIds=new Set(teachers.map(t=>t.uid));
  if(active.length){
   if(typeof periodFromSlot!=='function')throw Error('RANKING_BOOKING_CORE_REQUIRED');
   const course=active[0],settings=await read('bookingSettings/'+course.id);
   const bookings=await query('bookingEntries',['courseId','==',course.id],1000);
   const availability=new Map();
   for(const e of stored.filter(e=>e.courseId===course.id&&e.status!=='cancelled')){
    if(!policy.id(e.teacherUid))throw Error('RANKING_UNKNOWN_TEACHER');
    if(!availability.has(e.teacherUid)){
     const a=await read('specialCourses/'+course.id+'/teacherAvailability/'+e.teacherUid);
     availability.set(e.teacherUid,a?.slots||[]);
    }
   }
   snapshot.closed=isClosed||Boolean(settings?.excludedDates?.includes(date));
   const s=resolveSeasonalDay({date,course,lessons:stored,bookings,teachers,students,availability,periodFromSlot,allows:require('./enrollment.cjs').allows,closed:snapshot.closed});
   snapshot.courses=[{id:course.id,startDate:course.startDate,endDate:course.endDate,periods:course.periods.map(p=>({start:p.start,end:p.end}))}];
   snapshot.entries=s.entries;snapshot.unavailableSlots=s.unavailableSlots;
   return {snapshot,teachers};
  }
  const rows=policy.effectiveDay(date,stored,students,date);
  if(rows.length>400)throw Error('RANKING_EFFECTIVE_DAY_LIMIT');
  const work=new Map();
  for(const e of rows){
   if(e.status==='cancelled')continue;
   if(!teacherIds.has(e.teacherUid)||!policy.id(e.teacherUid))throw Error('RANKING_UNKNOWN_TEACHER');
   if(!work.has(e.teacherUid)){
    const uid=e.teacherUid,key=date+'_'+uid;
    const [weekly,daily,absence]=await Promise.all([read('teacherWeeklyWork/'+uid),read('teacherDateWork/'+key),read('teacherDayAbsences/'+key)]);
    work.set(uid,{weekly,daily,absence});
   }
  }
  for(const [teacherUid,w] of work)for(const [start,end] of policy.PERIODS){
   if(!policy.canAssign({date,start,end},w))snapshot.unavailableSlots.push({teacherUid,start,end});
  }
  // No names, memos, grades, schools or other personal information in the snapshot.
  snapshot.entries=rows.map(e=>({id:e.id,date:e.date,studentId:e.studentId,teacherUid:e.teacherUid,start:e.start,end:e.end,status:e.status}));
  return {snapshot,teachers};
 };
}
module.exports={createRankingResolver};
