'use strict';
// Public, pure validation of public Web schemas. No credentials or booking handlers.
class SeasonalPolicyError extends Error{constructor(code,message){super(message);this.code=code}}
const fail=(code,message)=>{throw new SeasonalPolicyError(code,message)};
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(s);
function date(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))fail('invalid-argument','Invalid date');const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)fail('invalid-argument','Invalid calendar date');return d;}
const time=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const overlap=(a,b)=>a.date===b.date&&a.start<b.end&&b.start<a.end;
function keys(v,allowed,required=allowed){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail('invalid-argument','Unexpected or missing fields');}
function text(v,max,empty=true){if(typeof v!=='string'||v.length>max||(!empty&&!v.trim()))fail('invalid-argument','Invalid text');return v;}
function course(value){
 keys(value,['name','type','startDate','endDate','periods','availabilityDeadline','archived'],['name','type','startDate','endDate','periods']);
 text(value.name,30,false);if(!['spring','summer','winter'].includes(value.type))fail('invalid-argument','Invalid course type');
 const start=date(value.startDate),end=date(value.endDate);if(end<start||(end-start)/86400000>=120)fail('invalid-argument','Course must span 1 to 120 days');
 if(!Array.isArray(value.periods)||value.periods.length<1||value.periods.length>12)fail('invalid-argument','Invalid periods');
 const periods=value.periods.map(p=>{keys(p,['start','end']);if(!time(p.start)||!time(p.end)||p.start>=p.end)fail('invalid-argument','Invalid period');return {start:p.start,end:p.end};});
 if(periods.some((p,i)=>i>0&&periods[i-1].end>p.start))fail('invalid-argument','Periods must be ordered without overlap');
 if(value.archived!==undefined&&typeof value.archived!=='boolean')fail('invalid-argument','Invalid archive flag');
 const deadline=value.availabilityDeadline??null;if(deadline!==null){keys(deadline,['__shiftlyType','value']);if(deadline.__shiftlyType!=='timestamp'||typeof deadline.value!=='string'||!Number.isFinite(Date.parse(deadline.value))||new Date(deadline.value).toISOString()!==deadline.value)fail('invalid-argument','Invalid deadline');}
 return {...value,periods,archived:value.archived??false,availabilityDeadline:deadline};
}
function availability(value,c){if(!Array.isArray(value)||value.length>1200||new Set(value).size!==value.length)fail('invalid-argument','Invalid availability slots');for(const slot of value){const m=typeof slot==='string'&&/^(\d{4}-\d{2}-\d{2})_(0|[1-9]|1[01])$/.exec(slot);if(!m)fail('invalid-argument','Noncanonical availability');date(m[1]);if(m[1]<c.startDate||m[1]>c.endDate||Number(m[2])>=c.periods.length)fail('invalid-argument','Availability outside course');}return [...value].sort();}
function manualLesson(value,c){
 keys(value,['studentId','studentName','grade','school','teacherUid','teacherName','date','start','end','subject','status','memo','memoUpdatedAt','nextDates','courseId'],['studentId','teacherUid','date','start','end','subject','status','memo','nextDates','courseId']);
 if(!id(value.studentId)||!id(value.teacherUid)||!id(value.courseId))fail('invalid-argument','Invalid lesson identity');date(value.date);
 if(value.date<c.startDate||value.date>c.endDate||!c.periods.some(p=>p.start===value.start&&p.end===value.end))fail('failed-precondition','Lesson outside course periods');
 text(value.subject,80);text(value.memo,2000);if(!['scheduled','done','cancelled'].includes(value.status)||!Array.isArray(value.nextDates)||value.nextDates.length>2)fail('invalid-argument','Invalid lesson state');for(const d of value.nextDates)date(d);
 if(value.memoUpdatedAt!==undefined&&value.memoUpdatedAt!==null&&!(value.memoUpdatedAt.__shiftlyType==='timestamp'&&Number.isFinite(Date.parse(value.memoUpdatedAt.value))))fail('invalid-argument','Invalid memo timestamp');
 return {...value};
}
function capacity(entry,lessons,reservations=[],max=2){
 if(entry.status==='cancelled')return;const peers=lessons.filter(e=>e.status!=='cancelled'&&e.id!==entry.id&&overlap(e,entry));
 if(peers.some(e=>e.studentId===entry.studentId)||reservations.some(e=>e.studentId===entry.studentId&&overlap(e,entry)))fail('already-exists','Student has overlapping lessons or reservations');
 // Half-open intervals prevent adjoining periods from sharing a seat.
 const events=[entry,...peers.filter(e=>e.teacherUid===entry.teacherUid),...reservations.filter(e=>e.teacherUid===entry.teacherUid&&overlap(e,entry))].flatMap(e=>[[e.start,1],[e.end,-1]]).sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);
 let count=0;for(const [,delta]of events){count+=delta;if(count>max)fail('resource-exhausted','Teacher capacity exceeded');}
}
function canonical(value){if(value==null)return null;if(typeof value?.toDate==='function')return {__shiftlyType:'timestamp',value:value.toDate().toISOString()};if(value instanceof Date)return {__shiftlyType:'timestamp',value:value.toISOString()};if(Array.isArray(value))return value.map(canonical);if(typeof value==='object')return Object.fromEntries(Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>[k,canonical(value[k])]));return value;}
module.exports={SeasonalPolicyError,fail,id,date,time,overlap,keys,text,course,availability,manualLesson,capacity,canonical};
