'use strict';
// Independently authored public candidate. No production Functions source is included.
const PERIODS=[['17:30','18:25'],['18:30','19:25'],['19:30','20:25'],['20:30','21:25']];
class PolicyError extends Error { constructor(code,message){super(message);this.code=code;} }
const fail=(code,message)=>{throw new PolicyError(code,message)};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('invalid-argument','Invalid date');const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)fail('invalid-argument','Invalid date');return d;}
function time(value){if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))fail('invalid-argument','Invalid time');return value;}
const overlap=(a,b)=>a.start<b.end&&a.end>b.start;
function numbers(values,max){if(!Array.isArray(values)||values.length>max||new Set(values).size!==values.length||values.some(n=>!Number.isInteger(n)||n< (max===7?0:1)||n>(max===7?6:4)))fail('invalid-argument','Invalid work periods');return [...values].sort((a,b)=>a-b);}
function periods(entry){time(entry.start);time(entry.end);if(entry.start>=entry.end)fail('invalid-argument','Invalid interval');return PERIODS.flatMap(([start,end],i)=>overlap(entry,{start,end})?[i+1]:[]);}
function canAssign(entry,{weekly,daily,absence}){
  const d=date(entry.date),ps=periods(entry);
  // Absence > explicit date attendance > weekly attendance > legacy all-days default.
  if(absence){const absent=numbers(absence.absentPeriods,4);if(ps.some(p=>absent.includes(p)))return false;}
  if(daily){const available=numbers(daily.availablePeriods,4);return ps.length>0&&ps.every(p=>available.includes(p));}
  return !weekly||numbers(weekly.weekdays,7).includes(d.getUTCDay());
}
function currentOccurrence(entry,students,today){
  if(!entry.regularId||entry.date<today)return true;
  const slot=students.find(s=>s.id===entry.studentId)?.regularSlots?.[entry.regularId];
  return Boolean(slot&&Number(slot.weekday)===date(entry.date).getUTCDay()&&(!slot.activeFrom||entry.date>=slot.activeFrom)&&(!slot.activeUntil||entry.date<=slot.activeUntil));
}
function effectiveDay(day,stored,students,today){
  date(day);const rows=stored.filter(e=>e.date===day&&!e.courseId&&currentOccurrence(e,students,today));
  for(const student of students)for(const slot of Object.values(student.regularSlots||{})){
    if(!slot||Number(slot.weekday)!==date(day).getUTCDay()||(slot.activeFrom&&day<slot.activeFrom)||(slot.activeUntil&&day>slot.activeUntil))continue;
    if(!id(slot.id)||!id(slot.teacherUid)||!id(student.id))fail('failed-precondition','Invalid legacy weekly slot');periods(slot);
    const key=`rec_${student.id}_${slot.id}_${day}`;
    if(rows.some(e=>e.id===key||(e.studentId===student.id&&e.start===slot.start&&e.end===slot.end)))continue;
    rows.push({id:key,regularId:slot.id,studentId:student.id,studentName:student.name||'',grade:student.grade||'',school:student.school||'',teacherUid:slot.teacherUid,teacherName:'',date:day,start:slot.start,end:slot.end,subject:slot.subject||'',status:'scheduled',memo:'',memoUpdatedAt:null,nextDates:[]});
  }
  return rows;
}
function sameAssignment(a,b){return a&&b&&['studentId','teacherUid','date','start','end','regularId'].every(k=>(a[k]||'')===(b[k]||''))&&(a.status!=='cancelled'||b.status==='cancelled');}
function validatePlacement(entry,rows,work){
  if(entry.status==='cancelled')return;
  if(!canAssign(entry,work))fail('failed-precondition','Teacher cannot work at this time');
  const peers=rows.filter(e=>e.id!==entry.id&&e.status!=='cancelled'&&overlap(e,entry));
  if(peers.some(e=>e.studentId===entry.studentId))fail('already-exists','Student already has an overlapping lesson');
  // Match the editor: at most two lessons touching each standard period.
  // Non-standard times use a sweep so interval changes cannot bypass the cap.
  const teacherPeers=peers.filter(e=>e.teacherUid===entry.teacherUid);
  for(const p of periods(entry)){const [start,end]=PERIODS[p-1];if(rows.filter(e=>e.status!=='cancelled'&&e.teacherUid===entry.teacherUid&&overlap(e,{start,end})).length>2)fail('resource-exhausted','Teacher capacity exceeded');}
  const events=[entry,...teacherPeers].flatMap(e=>[[e.start,1],[e.end,-1]]).sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);let count=0;for(const [,delta]of events){count+=delta;if(count>2)fail('resource-exhausted','Teacher capacity exceeded');}
}
module.exports={PERIODS,PolicyError,fail,id,date,time,numbers,periods,canAssign,effectiveDay,sameAssignment,validatePlacement};
