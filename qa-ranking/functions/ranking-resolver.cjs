'use strict';
const policy=require('./normal-authority/policy.cjs');
const {automaticClosure}=require('./normal-authority/calendar.cjs');
// Internal server resolver, normal days only until seasonal publication is verified.
function createRankingResolver(db){
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
  if(active.length)throw Error('RANKING_SEASONAL_RESOLVER_NOT_READY');
  const isClosed=!(open||exam?.type==='exam')&&Boolean(closed||automaticClosure(date));
  const snapshot={date,capturedAt,complete:true,closed:isClosed,entries:[],courses:[],unavailableSlots:[]};
  if(isClosed)return {snapshot,teachers:[]};
  const [students,stored,users]=await Promise.all([query('schoolStudents',null,1000),query('timetableEntries',['date','==',date],400),query('users',null,300)]);
  const teachers=users.filter(t=>['admin','employee'].includes(t.role)).map(t=>({uid:t.id,role:t.role}));
  const teacherIds=new Set(teachers.map(t=>t.uid));
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
