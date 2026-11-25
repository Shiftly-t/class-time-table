// Server-side candidate: explicit completed lessons only; no Firebase writes.
export function normalizeRankingEntries({entries,courses,teachers,from,to,cutoff}){
 const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 const validTime=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
 if(!validDate(from)||!validDate(to)||from>to||!Number.isFinite(Date.parse(cutoff)))throw Error('Invalid ranking window');
 const teacherMap=new Map(teachers.map(t=>[t.uid,t]));
 const courseMap=new Map(courses.map(c=>[c.id,c]));
 const regular=[{start:'17:30',end:'18:25'},{start:'18:30',end:'19:25'},{start:'19:30',end:'20:25'},{start:'20:30',end:'21:25'}];
 const facts=[],issues=[],seen=new Map(),invalidKeys=new Set();
 const issue=(e,code)=>issues.push({entryId:typeof e.id==='string'?e.id:'',code});
 for(const e of entries){
  if(e.status!=='done'||e.virtual===true)continue;
  if(!validDate(e.date)){issue(e,'INVALID_DATE');continue;}
  if(e.date<from||e.date>to)continue;
  if(!validTime(e.start)||!validTime(e.end)||e.end<=e.start){issue(e,'INVALID_TIME');continue;}
  if(Date.parse(e.date+'T'+e.end+':00+09:00')>Date.parse(cutoff))continue;
  if(!e.id||!e.studentId||!e.teacherUid){issue(e,'MISSING_ID');continue;}
  if(!['employee','admin'].includes(teacherMap.get(e.teacherUid)?.role)){issue(e,'UNVERIFIED_TEACHER');continue;}
  let parts;
  if(e.courseId){
   const c=courseMap.get(e.courseId);
   if(!c||!validDate(c.startDate)||!validDate(c.endDate)||e.date<c.startDate||e.date>c.endDate||!Array.isArray(c.periods)){issue(e,'UNVERIFIED_COURSE');continue;}
   const matches=c.periods.filter(p=>p.start===e.start&&p.end===e.end);
   if(matches.length!==1){issue(e,'UNKNOWN_COURSE_PERIOD');continue;}parts=matches;
  }else{
   if(courses.some(c=>c.startDate<=e.date&&e.date<=c.endDate)){issue(e,'REGULAR_DURING_COURSE');continue;}
   const first=regular.findIndex(p=>p.start===e.start),last=regular.findIndex(p=>p.end===e.end);
   if(first<0||last<first){issue(e,'NONSTANDARD_REGULAR_PERIOD');continue;}
   parts=regular.slice(first,last+1);
  }
  for(const p of parts){
   const slotId=JSON.stringify([e.studentId,e.date,p.start,p.end]);
   const f={slotId,teacherUid:e.teacherUid,studentId:e.studentId,date:e.date,endedAt:e.date+'T'+p.end+':00+09:00',kind:e.courseId?'seasonal':'regular',status:'done'};
   if(seen.has(slotId)){
    if(JSON.stringify(seen.get(slotId))!==JSON.stringify(f)){invalidKeys.add(slotId);issue(e,'CONFLICTING_ASSIGNMENT');}
    else issue(e,'DUPLICATE_SLOT');
   }else{seen.set(slotId,f);facts.push(f);}
  }
 }
 return {facts:facts.filter(f=>!invalidKeys.has(f.slotId)),issues,canPublish:issues.length===0};
}
