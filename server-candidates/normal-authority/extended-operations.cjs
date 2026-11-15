'use strict';
const P=require('./policy.cjs'),S=require('./student-policy.cjs');
const BOOKING=['bookingSettings','bookingSlots','bookingEntries','bookingAccess','bookingTeacherLoad','bookingTeacherLimits','bookingAudit'];
const withoutId=({id,...value})=>value;
async function bookingPresent(any){for(const col of BOOKING)if(await any(col))return true;return false;}
async function prepareStudent(c){
 const {input,read,query,entryToken,writes,notices,today}=c;
 if(!P.id(input.studentId))P.fail('invalid-argument','Invalid student id');
 const path='schoolStudents/'+input.studentId,before=await read(path);
 if(!Object.hasOwn(input,'expected')||input.expected!==(before?entryToken(before):null))P.fail('aborted','Student changed; reload');
 const clean=S.cleanStudent(input.value,today),after={...(before?withoutId(before):{}),...clean};
 const labelsChanged=before&&['name','grade','gradeYear','school'].some(k=>before[k]!==after[k]);
 // Current booking handlers do not share this lock. Never propagate half of a label change.
 // This is intentionally global until their private transaction bridge is implemented.
 if(!before||labelsChanged){await c.assertStudentIdentityBoundary(input.studentId);if(await bookingPresent(c.any))P.fail('failed-precondition','Booking/QR label coordination is not implemented');}
 const linked=labelsChanged?await query('timetableEntries',['studentId','==',input.studentId],120):[];
 if(linked.some(e=>e.id.startsWith('b_')))P.fail('failed-precondition','Booking-owned labels require booking coordination');
 const old=before?.regularSlots||{},next=after.regularSlots;
 const changed=[...new Set([...Object.keys(old),...Object.keys(next)])].filter(k=>S.assignment(old[k])!==S.assignment(next[k]));
 if(changed.length){
  const tables={};
  for(const [key,col,max]of [['students','schoolStudents',1000],['entries','timetableEntries',2000],['courses','specialCourses',200],['weekly','teacherWeeklyWork',300],['daily','teacherDateWork',1000],['absences','teacherDayAbsences',1000],['closures','schoolClosures',1000],['open','schoolOpenDays',1000],['exams','schoolEvents',1000],['users','users',300]])tables[key]=await query(col,null,max);
  const afterStudents=[...tables.students.filter(s=>s.id!==input.studentId),{...after,id:input.studentId}],users=new Map(tables.users.map(u=>[u.id,u])),weekly=new Map(tables.weekly.map(r=>[r.id,r]));
  const canonicalKeys=new Set();for(const s of afterStudents)for(const slot of Object.values(s.regularSlots||{})){const key=s.id+'_'+slot.id;if(canonicalKeys.has(key))P.fail('failed-precondition','Recurring occurrence identity collision');canonicalKeys.add(key);}
  for(const key of changed){const slot=next[key];if(!slot)continue;const teacher=users.get(slot.teacherUid);if(!['employee','admin'].includes(teacher?.role))P.fail('invalid-argument','Invalid weekly teacher');if(weekly.has(slot.teacherUid)&&!P.numbers(weekly.get(slot.teacherUid).weekdays,7).includes(slot.weekday))P.fail('failed-precondition','Weekly slot is outside teacher workdays');}
  const windows=changed.flatMap(k=>[old[k],next[k]].filter(Boolean));
  for(const date of S.verificationDates(tables.students,afterStudents,tables,windows)){
   if(tables.courses.some(course=>course.startDate<=date&&date<=course.endDate))continue;
   const initial=P.effectiveDay(date,tables.entries,tables.students,today),final=P.effectiveDay(date,tables.entries,afterStudents,today);
   for(const e of final){if(P.sameAssignment(initial.find(v=>v.id===e.id),e)||e.status==='cancelled')continue;
    if(!['employee','admin'].includes(users.get(e.teacherUid)?.role))P.fail('failed-precondition','Invalid generated teacher');
    P.validatePlacement(e,final,{weekly:weekly.get(e.teacherUid),daily:tables.daily.find(r=>r.id===date+'_'+e.teacherUid),absence:tables.absences.find(r=>r.id===date+'_'+e.teacherUid)});
   }
  }
 }
 writes.push({path,before,after});
 for(const e of linked){const prev=withoutId(e),value={...prev,studentName:after.name,school:after.school,grade:S.gradeAt(after,e.date)};if(['studentName','school','grade'].some(k=>prev[k]!==value[k]))writes.push({path:'timetableEntries/'+e.id,before:prev,after:value});}
 const recipients=new Set([...Object.values(old),...Object.values(next)].map(s=>s.teacherUid).concat(linked.filter(e=>e.date>=today).map(e=>e.teacherUid)));
 for(const uid of recipients){if(!P.id(uid))P.fail('failed-precondition','Invalid student notice recipient');notices.set(uid,{kind:'student',studentId:input.studentId,message:'担当生徒の情報・通常授業設定が更新されました。',date:today});}
}
async function prepareMove(c){
 const {input,read,query,entryToken,cleanEntry,writes,notices,today,automaticClosure}=c;
 P.date(input.fromDate);const value=cleanEntry(input.value);if(input.fromDate===value.date)P.fail('invalid-argument','Use the day command for a same-day edit');
 if(!P.id(input.id)||!P.id(input.targetId)||input.id.startsWith('b_')||/^(b_|rec_)/.test(input.targetId))P.fail('invalid-argument','Invalid move identity');
 const courses=await query('specialCourses',null,200);if(courses.some(course=>[input.fromDate,value.date].some(d=>course.startDate<=d&&d<=course.endDate)))P.fail('failed-precondition','Moving across course periods is unsupported');
 const students=await query('schoolStudents',null,1000),sourceStored=await query('timetableEntries',['date','==',input.fromDate],400),targetStored=await query('timetableEntries',['date','==',value.date],400);
 const before=await read('timetableEntries/'+input.id),target= input.id===input.targetId?null:await read('timetableEntries/'+input.targetId);
 if(input.expectedSource!==(before?entryToken(before):null)||input.expectedTarget!==(target?entryToken(target):null))P.fail('aborted','Move endpoint changed; reload');
 const initial=P.effectiveDay(input.fromDate,sourceStored,students,today),source=initial.find(e=>e.id===input.id);
 if(!source||source.courseId||source.status!=='scheduled'||source.studentId!==value.studentId||value.regularId||value.status!=='scheduled')P.fail('failed-precondition','Only a scheduled normal lesson can move');
 if(!before&&source.regularId&&input.expectedOccurrence!==entryToken(P.occurrenceValue(source)))P.fail('aborted','Weekly move source changed; reload');
 if(target)P.fail('already-exists','Move target id already exists');
 if(source.regularId){if(input.id!==`rec_${source.studentId}_${source.regularId}_${input.fromDate}`||input.targetId===input.id)P.fail('invalid-argument','Invalid recurring source id');}
 else if(input.targetId!==input.id)P.fail('invalid-argument','One-off lesson must retain its id');
 const student=students.find(s=>s.id===value.studentId),teacher=await read('users/'+value.teacherUid);if(!student||!['employee','admin'].includes(teacher?.role))P.fail('failed-precondition','Move student or teacher no longer exists');
 const key=value.date+'_'+value.teacherUid,[closed,open,exam,weekly,daily,absence]=await Promise.all([read('schoolClosures/'+value.date),read('schoolOpenDays/'+value.date),read('schoolEvents/'+value.date),read('teacherWeeklyWork/'+value.teacherUid),read('teacherDateWork/'+key),read('teacherDayAbsences/'+key)]);
 if((closed||automaticClosure(value.date))&&!open&&exam?.type!=='exam')P.fail('failed-precondition','Move target is closed');
 const moved={...value,studentName:student.name||'',school:student.school||'',teacherName:teacher.name||'',grade:S.gradeAt(student,value.date),memo:source.memo||'',memoUpdatedAt:source.memoUpdatedAt||null,nextDates:source.nextDates||[]};
 cleanEntry({...moved,memoUpdatedAt:null});
 const targetFinal=P.effectiveDay(value.date,[...targetStored.filter(e=>e.id!==input.targetId),{id:input.targetId,...moved}],students,today);
 P.validatePlacement({id:input.targetId,...moved},targetFinal,{weekly,daily,absence});
 if(source.regularId){const originalTeacher=await read('users/'+source.teacherUid);if(!['employee','admin'].includes(originalTeacher?.role))P.fail('failed-precondition','Source teacher no longer exists');const cancelled={...cleanEntry({...withoutId(source),studentName:student.name||'',school:student.school||'',teacherName:originalTeacher.name||'',grade:S.gradeAt(student,input.fromDate),memoUpdatedAt:null,status:'cancelled'}),memoUpdatedAt:source.memoUpdatedAt||null};writes.push({path:'timetableEntries/'+input.id,before,after:cancelled});}
 else{
  const exposed=P.effectiveDay(input.fromDate,sourceStored.filter(e=>e.id!==input.id),students,today).filter(e=>!initial.some(v=>P.sameAssignment(v,e)&&v.id===e.id));
  if(exposed.length)P.fail('failed-precondition','Move would reveal a weekly lesson; explicit cancellation planning is required');
 }
 writes.push({path:'timetableEntries/'+input.targetId,before:input.id===input.targetId?before:null,after:moved});
 for(const [uid,date]of [[source.teacherUid,input.fromDate],[value.teacherUid,value.date]])notices.set(uid+'_'+date,{recipient:uid,message:'担当授業の予定が更新されました',date});
}
async function planDeletion({input,read,query,any,entryToken,version}){
 if(!P.id(input.studentId))P.fail('invalid-argument','Invalid student id');const student=await read('schoolStudents/'+input.studentId);if(!student)P.fail('not-found','Student not found');
 const entries=await query('timetableEntries',['studentId','==',input.studentId],400),targets=await query('monthlyTargets',['studentId','==',input.studentId],400);
 return {protocolVersion:1,version,canApply:false,operation:'studentDelete',studentToken:entryToken(student),counts:{storedLessons:entries.length,weeklySlots:Object.keys(student.regularSlots||{}).length,monthlyTargets:targets.length},bookingBoundaryPresent:await bookingPresent(any),reasons:['Deletion apply API and QR revocation/booking-ledger transaction bridge are not implemented']};
}
async function planRestore({input,read,actor,maintenance,version}){
 if(actor.role!=='owner'||maintenance?.enabled!==true)P.fail('permission-denied','Restore planning requires owner and maintenance');if(!P.id(input.archiveId))P.fail('invalid-argument','Invalid archive id');
 const meta=await read('backupArchives/'+input.archiveId);if(!meta||meta.formatVersion!==1||!Number.isInteger(meta.partCount)||meta.partCount<0||meta.partCount>40||!Number.isInteger(meta.recordCount)||meta.recordCount<0||meta.recordCount>1000)P.fail('failed-precondition','Unsupported archive size or format');
 const records=[];let bytes=0;for(let i=0;i<meta.partCount;i++){const part=await read(`backupArchives/${input.archiveId}/parts/${String(i).padStart(5,'0')}`);if(typeof part?.json!=='string'||(bytes+=Buffer.byteLength(part.json))>2000000)P.fail('failed-precondition','Missing or oversized archive part');let rows;try{rows=JSON.parse(part.json)}catch{P.fail('invalid-argument','Invalid archive JSON')}if(!Array.isArray(rows))P.fail('invalid-argument','Invalid archive part');records.push(...rows);}
 const root='(?:schoolStudents|timetableEntries|monthlyTargets|specialCourses|schoolClosures|schoolOpenDays|schoolEvents|teacherDayAbsences|teacherWeeklyWork|teacherDateWork)';
 const path=new RegExp(`^(?:${root}/[A-Za-z0-9_-]+|specialCourses/[A-Za-z0-9_-]+/(?:teacherAvailability|scheduleMeta)/[A-Za-z0-9_-]+)$`);
 if(records.length!==meta.recordCount||new Set(records.map(r=>r?.path)).size!==records.length||records.some(r=>!r||!path.test(r.path)||!r.data||typeof r.data!=='object'||Array.isArray(r.data)))P.fail('failed-precondition','Archive is incomplete or contains invalid/duplicate paths');
 return {protocolVersion:1,version,canApply:false,operation:'restore',recordCount:records.length,containsBookingOwnedLessons:records.some(r=>/^timetableEntries\/b_/.test(r.path)),reasons:['Format 1 omits booking ledger, QR access state, server revisions and atomic snapshot proof','Validated restore apply API is not implemented']};
}
module.exports={prepareStudent,prepareMove,planDeletion,planRestore};
