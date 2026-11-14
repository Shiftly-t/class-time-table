'use strict';
// Independently authored public pure contract. No Functions implementation, SDK or writes.
const {date:validDate}=require('./policy.cjs');
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(v);
const CAPACITY_POLICY='teacher-count-times-two-v1';
function fixedCapacity({teachers,availability,date,index,open=true}){
 if(!open)return 0;
 validDate(date);if(!Number.isInteger(index)||index<0||index>11||!Array.isArray(teachers)||!Array.isArray(availability)||teachers.some(t=>!validId(t.id))||availability.some(a=>!validId(a.teacherUid)||!Array.isArray(a.slots)))throw Error('Invalid slot/staff metadata');
 const eligible=new Set(teachers.filter(t=>['employee','admin'].includes(t.role)).map(t=>t.id)),uids=new Set();
 for(const a of availability)if(eligible.has(a.teacherUid)&&Array.isArray(a.slots)&&a.slots.includes(date+'_'+index))uids.add(a.teacherUid);
 return uids.size*2;
}
function migrationBlockers({limits=[],slots=[]}){
 const blockers=[];for(const t of limits)if((t.defaultCapacity??2)!==2||Object.values(t.perSlot||{}).some(n=>n!==2))blockers.push('individual-limit:'+t.id);
 for(const s of slots)if(s.capacityOverride===true)blockers.push('slot-override:'+s.id);
 return blockers;
}
function withdrawalBlockers({studentId,today,lessons=[],bookings=[]}){
 validDate(today);if(!validId(studentId))throw Error('Invalid student');
 const blockers=[];
 if(lessons.some(e=>e.studentId===studentId&&e.date>=today&&e.status!=='cancelled'))blockers.push('future-lessons');
 for(const b of bookings.filter(b=>b.studentId===studentId)){
  const keys=[...(b.wishes||[]),...(b.confirmed||[]).map(c=>c.slotId)];
  if(keys.some(k=>{const m=typeof k==='string'&&/^[A-Za-z0-9_-]{1,150}__([0-9]{4}-[0-9]{2}-[0-9]{2})__(0|[1-9]|10|11)$/.exec(k);if(!m)return true;try{validDate(m[1]);}catch{return true;}return m[1]>=today;})){blockers.push('future-or-unknown-booking-holds');break;}
 }
 return blockers;
}
module.exports={CAPACITY_POLICY,fixedCapacity,migrationBlockers,withdrawalBlockers};
