import {normalizeRankingEntries} from './ranking-normalize.mjs';

// Pure closed-day candidate. Only authoritative server snapshots may be supplied.
export function deriveDailyRanking({snapshot,trackingStart,cutoff,teachers,normalize=normalizeRankingEntries}){
 const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 const instant=s=>typeof s==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s));
 if(!iso(trackingStart)||!iso(snapshot?.date)||!instant(cutoff))throw Error('Invalid tracking date or cutoff');
 const date=snapshot.date;
 const incomplete=code=>({facts:[],issues:[{code}],canPublish:false});
 if(date<trackingStart)return incomplete('BEFORE_TRACKING_START');
 // Input must come from trusted server-side resolution, not a client request.
 if(snapshot.complete!==true||!instant(snapshot.capturedAt)||Date.parse(snapshot.capturedAt)>Date.parse(cutoff)||typeof snapshot.closed!=='boolean'||!Array.isArray(snapshot.entries)||!Array.isArray(snapshot.courses)||!Array.isArray(snapshot.unavailableSlots))return incomplete('INCOMPLETE_SNAPSHOT');
 const dayStart=Date.parse(date+'T00:00:00+09:00'),dayEnd=dayStart+86400000;
 if(Date.parse(snapshot.capturedAt)<dayStart||Date.parse(snapshot.capturedAt)>=dayEnd)return incomplete('NOT_SAME_DAY_CAPTURE');
 // A full-day award/ledger must not be committed from a partial day snapshot.
 if(Date.parse(cutoff)<dayEnd)return incomplete('DAY_NOT_FINISHED');
 // Closing snapshot must be captured after the last resolved scheduled lesson.
 if(snapshot.closed)return {facts:[],issues:[],canPublish:true};
 const slots=[{start:'17:30',end:'18:25',number:1},{start:'18:30',end:'19:25',number:2},{start:'19:30',end:'20:25',number:3},{start:'20:30',end:'21:25',number:4}];
 const courses=snapshot.courses.filter(c=>c.startDate<=date&&date<=c.endDate);
 if(courses.length>1)return incomplete('COURSE_CONFLICT');
 const unavailable=new Set(snapshot.unavailableSlots.map(x=>JSON.stringify([x.teacherUid,x.start,x.end])));
 const entries=[],issues=[],occupied=new Map();
 for(const e of snapshot.entries){
  if(e.date!==date){issues.push({code:'WRONG_DATE',entryId:e.id});continue;}
  if(!['scheduled','done','cancelled'].includes(e.status)){issues.push({code:'UNKNOWN_STATUS',entryId:e.id});continue;}
  if(e.status==='cancelled')continue;
  if(typeof e.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.end)||Date.parse(date+'T'+e.end+':00+09:00')>Date.parse(snapshot.capturedAt)){issues.push({code:'CAPTURE_BEFORE_LESSON_END',entryId:e.id});continue;}
  if((courses.length&&e.courseId!==courses[0].id)||(!courses.length&&e.courseId)){issues.push({code:'COURSE_MISMATCH',entryId:e.id});continue;}
  let parts;
  if(e.courseId){parts=courses[0].periods?.filter(p=>p.start===e.start&&p.end===e.end);if(parts?.length!==1){issues.push({code:'UNKNOWN_COURSE_PERIOD',entryId:e.id});continue;}}
  else {
   if(typeof e.start!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.start)||e.start>=e.end){issues.push({code:'INVALID_TIME',entryId:e.id});continue;}
   const first=slots.findIndex(p=>p.start===e.start),last=slots.findIndex(p=>p.end===e.end);
   if(first>=0&&last>=first)parts=slots.slice(first,last+1);
   else {
    // The existing timetable displays a non-standard lesson as one card.
    if(snapshot.unavailableSlots.some(slot=>slot.teacherUid===e.teacherUid&&slot.start<e.end&&e.start<slot.end)||
       snapshot.unavailableEntries?.includes(e.id))continue;
    parts=[e];
   }
  }
  for(const p of parts){
   if(unavailable.has(JSON.stringify([e.teacherUid,p.start,p.end])))continue;
   const studentSlots=occupied.get(e.studentId)||[];
   if(studentSlots.some(slot=>slot.start<p.end&&p.start<slot.end)){issues.push({code:'DUPLICATE_OR_CONFLICTING_SLOT',entryId:e.id});continue;}
   studentSlots.push({start:p.start,end:p.end});occupied.set(e.studentId,studentSlots);
   entries.push({...e,id:e.id,start:p.start,end:p.end,virtual:false,status:'done'});
  }
 }
 const result=normalize({entries,courses:snapshot.courses,teachers,from:date,to:date,cutoff});
 const all=[...issues,...result.issues];
 return {facts:all.length?[]:result.facts,issues:all,canPublish:all.length===0};
}
