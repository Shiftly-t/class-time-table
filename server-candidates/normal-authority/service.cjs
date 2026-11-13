'use strict';
// Public, dependency-injected Admin Firestore transaction candidate; NOT deployed.
const {createHash}=require('node:crypto');
const P=require('./policy.cjs');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function archive(value,sentinels=new WeakSet()){
  if(value==null)return null;
  if(typeof value?.toDate==='function')return {__shiftlyType:'timestamp',value:value.toDate().toISOString()};
  if(typeof value==='object'&&sentinels.has(value))return {__shiftlyType:'serverNow'};
  if(Array.isArray(value))return value.map(v=>archive(v,sentinels));
  if(typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k,v])=>k!=='id'&&v!==undefined).map(([k,v])=>[k,archive(v,sentinels)]));
  return value;
}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const digest=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const plain=s=>s.exists?s.data():null;
const allowed=['studentId','studentName','grade','school','teacherUid','teacherName','date','start','end','subject','status','memo','memoUpdatedAt','nextDates','regularId'];
function cleanEntry(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))P.fail('invalid-argument','Unknown lesson fields');
  for(const key of ['studentId','teacherUid'])if(!P.id(value[key]))P.fail('invalid-argument','Invalid identity');
  P.date(value.date);P.periods(value);
  for(const [key,max]of [['studentName',80],['grade',30],['school',80],['teacherName',100],['subject',80],['memo',2000]])if(typeof value[key]!=='string'||value[key].length>max)P.fail('invalid-argument','Invalid text');
  if(!['scheduled','done','cancelled'].includes(value.status)||!Array.isArray(value.nextDates)||value.nextDates.length>2)P.fail('invalid-argument','Invalid lesson');
  value.nextDates.forEach(P.date);if(own(value,'regularId')&&(!P.id(value.regularId)||value.regularId.length>50))P.fail('invalid-argument','Invalid weekly identity');
  // Timestamp is owned by the server; clients cannot forge memo history.
  if(value.memoUpdatedAt!=null)P.fail('invalid-argument','memoUpdatedAt must be omitted/null');
  return {...value,memoUpdatedAt:null};
}
function createNormalAuthority({db,serverTimestamp,todayKey}){
  if(!db||typeof serverTimestamp!=='function'||typeof todayKey!=='function')throw Error('Admin Firestore and a JST date clock are required');
  return async function execute(context,command){
    const uid=context?.auth?.uid;if(!P.id(uid))P.fail('unauthenticated','Staff authentication required');
    if(context.app?.appId==null)P.fail('failed-precondition','Verified App Check required');
    if(!command||!['day','work'].includes(command.kind)||(!P.id(command.requestId)||command.requestId.length>80))P.fail('invalid-argument','Invalid command');
    const input=JSON.parse(JSON.stringify(command));const hash=digest(canonical(input));
    const sentinels=new WeakSet();const stamp=()=>{const value=serverTimestamp();if(value&&typeof value==='object')sentinels.add(value);return value;};
    const auditJson=value=>{const json=JSON.stringify(archive(value,sentinels));if(json.length>300000)P.fail('resource-exhausted','History exceeds supported size');return json;};
    return db.runTransaction(async tx=>{
      const read=async path=>plain(await tx.get(db.doc(path)));
      const actor=await read('users/'+uid),maintenance=await read('systemConfig/maintenance'),config=await read('systemConfig/normalAuthority');
      if(!['owner','admin'].includes(actor?.role)||(maintenance?.enabled&&actor.role!=='owner'))P.fail('permission-denied','Administrator permission required');
      if(config?.enabled!==true||config?.schemaVersion!==1)P.fail('failed-precondition','Normal authority is not enabled');
      // Every normal write AND work update reads/writes this shared revision.
      // Do not replace with a client-side preflight or a counter outside this transaction.
      const lock=await read('normalAuthorityState/global');
      if(lock&&(!Number.isSafeInteger(lock.version)||lock.version<0))P.fail('failed-precondition','Invalid revision');
      const operationKey=digest([uid,input.requestId]);
      const receiptPath=`normalAuthorityRequests/${operationKey}`,receipt=await read(receiptPath);
      if(receipt){if(receipt.hash!==hash)P.fail('already-exists','Request id reused with different content');return receipt.result;}
      const writes=[],notices=new Map();
      if(input.kind==='work'){
        if(!P.id(input.teacherUid)||!['weekly','date','absence'].includes(input.type))P.fail('invalid-argument','Invalid work target');
        const teacher=await read('users/'+input.teacherUid);if(!['admin','employee'].includes(teacher?.role))P.fail('invalid-argument','Invalid teacher');
        const collection={weekly:'teacherWeeklyWork',date:'teacherDateWork',absence:'teacherDayAbsences'}[input.type];
        if(input.type!=='weekly')P.date(input.date);
        const path=collection+'/'+(input.type==='weekly'?input.teacherUid:input.date+'_'+input.teacherUid),before=await read(path);
        // Revision precondition protects against overwriting another administrator's work edit.
        if(!own(input,'expectedVersion')||input.expectedVersion!==(lock?.version||0))P.fail('aborted','Reload work settings and revision');
        const field={weekly:'weekdays',date:'availablePeriods',absence:'absentPeriods'}[input.type];
        if(own(input,'clear')&&typeof input.clear!=='boolean')P.fail('invalid-argument','Invalid clear flag');
        const values=input.clear?null:P.numbers(input.values,input.type==='weekly'?7:4);
        const after=input.clear?null:{[field]:values,...(input.type==='weekly'?{}:{date:input.date,teacherUid:input.teacherUid}),updatedBy:uid,updatedAt:stamp()};
        writes.push({path,before,after});
        // Work changes never rewrite student regularSlots or existing occurrences.
        notices.set(input.teacherUid,{message:'担当授業の予定が更新されました',date:input.type==='weekly'?todayKey():input.date});
      }else{
        P.date(input.date);
        const absenceChanges=input.absences||[];
        if(!Array.isArray(input.changes)||!Array.isArray(absenceChanges)||input.changes.length+absenceChanges.length<1||input.changes.length+absenceChanges.length>20||new Set(input.changes.map(c=>c.id)).size!==input.changes.length||new Set(absenceChanges.map(c=>c.teacherUid)).size!==absenceChanges.length)P.fail('invalid-argument','Use 1..20 distinct lesson/absence changes');
        const query=async(col,filter,max)=>{let q=db.collection(col);if(filter)q=q.where(...filter);const snap=await tx.get(q.limit(max+1));if(snap.docs.length>max)P.fail('resource-exhausted','Dataset exceeds validated transaction bound');return snap.docs.map(s=>({id:s.id,...s.data()}));};
        const courses=await query('specialCourses',null,200);
        // Same visibility policy as the UI, including archived course periods.
        if(courses.some(c=>c.startDate<=input.date&&input.date<=c.endDate))P.fail('failed-precondition','Use the independent course workflow');
        const [closed,open,exam]=await Promise.all(['schoolClosures/','schoolOpenDays/','schoolEvents/'].map(c=>read(c+input.date)));
        if(closed&&!open&&exam?.type!=='exam')P.fail('failed-precondition','School is closed');
        const students=await query('schoolStudents',null,1000),stored=await query('timetableEntries',['date','==',input.date],400);
        const today=todayKey();P.date(today);
        const initial=P.effectiveDay(input.date,stored,students,today);let final=[...initial];
        const work=new Map(),teachers=new Map(),absenceOverrides=new Map();
        for(const change of absenceChanges){
          if(!P.id(change.teacherUid))P.fail('invalid-argument','Invalid absent teacher');
          const teacher=await read('users/'+change.teacherUid);if(!['admin','employee'].includes(teacher?.role))P.fail('invalid-argument','Invalid absent teacher');
          teachers.set(change.teacherUid,teacher);
          const path='teacherDayAbsences/'+input.date+'_'+change.teacherUid,before=await read(path);
          if(!own(change,'expected')||change.expected!==(before?entryToken(before):null))P.fail('aborted','Absence changed; reload');
          const values=P.numbers(change.periods,4),after=values.length?{date:input.date,teacherUid:change.teacherUid,absentPeriods:values,updatedBy:uid,updatedAt:stamp()}:null;
          absenceOverrides.set(change.teacherUid,after);writes.push({path,before,after});
          notices.set(change.teacherUid,{message:'担当授業の予定が更新されました',date:input.date});
        }
        for(const change of input.changes){
          if(!P.id(change.id)||change.id.startsWith('b_'))P.fail('permission-denied','Protected lesson identity');
          const before=stored.find(e=>e.id===change.id)||null,visible=initial.find(e=>e.id===change.id)||null;
          if(before?.courseId)P.fail('permission-denied','Course lessons are independent');
          // Stored-document precondition, not the synthesized weekly occurrence.
          // Clients obtain the revision token through their trusted read adapter.
          if(!own(change,'expected')||change.expected!==(before?entryToken(before):null))P.fail('aborted','Lesson changed; reload');
          if(change.remove){
            if(!before)P.fail('failed-precondition','Cannot delete an unmaterialized weekly occurrence');
            if(before.regularId)P.fail('failed-precondition','Cancel a weekly occurrence instead of regenerating it');
            final=final.filter(e=>e.id!==change.id);writes.push({path:'timetableEntries/'+change.id,before,after:null});
          }else{
            const value=cleanEntry(change.value);
            if(value.date!==input.date)P.fail('invalid-argument','One date per command; use cancel and a new placement for another date');
            const student=students.find(s=>s.id===value.studentId);if(!student)P.fail('not-found','Student no longer exists');
            if(value.regularId){
              if(!visible||visible.regularId!==value.regularId||visible.studentId!==value.studentId||value.id)P.fail('failed-precondition','Unknown weekly occurrence');
              const expectedId=`rec_${value.studentId}_${value.regularId}_${input.date}`;
              if(change.id!==expectedId)P.fail('invalid-argument','Use canonical weekly occurrence id');
            }else if(change.id.startsWith('rec_')||visible?.regularId)P.fail('invalid-argument','Weekly occurrence identity cannot be removed');
            if(!teachers.has(value.teacherUid))teachers.set(value.teacherUid,await read('users/'+value.teacherUid));
            const teacher=teachers.get(value.teacherUid);if(!['admin','employee'].includes(teacher?.role))P.fail('invalid-argument','Invalid teacher');
            if(!work.has(value.teacherUid)){const key=input.date+'_'+value.teacherUid;const [weekly,daily,absence]=await Promise.all([read('teacherWeeklyWork/'+value.teacherUid),read('teacherDateWork/'+key),read('teacherDayAbsences/'+key)]);work.set(value.teacherUid,{weekly,daily,absence:absenceOverrides.has(value.teacherUid)?absenceOverrides.get(value.teacherUid):absence});}
            for(const [text,max]of [[student.name||'',80],[student.school||'',80],[teacher.name||'',100]])if(typeof text!=='string'||text.length>max)P.fail('failed-precondition','Invalid legacy student or teacher label');
            const after={...value,studentName:student.name||'',school:student.school||'',teacherName:teacher.name||'',memoUpdatedAt:before?.memo===value.memo?(before.memoUpdatedAt||null):stamp()};
            final=final.filter(e=>e.id!==change.id);final.push({id:change.id,...after});
            writes.push({path:'timetableEntries/'+change.id,before,after,placement:!P.sameAssignment(visible,after)});
          }
          for(const teacherUid of new Set([visible?.teacherUid,change.value?.teacherUid].filter(Boolean)))notices.set(teacherUid,{message:'担当授業の予定が更新されました',date:input.date});
        }
        // Removing a one-off can reveal a previously suppressed weekly occurrence.
        final=P.effectiveDay(input.date,final,students,today);
        for(const entry of final){
          if(P.sameAssignment(initial.find(e=>e.id===entry.id),entry)||entry.status==='cancelled')continue;
          if(!teachers.has(entry.teacherUid))teachers.set(entry.teacherUid,await read('users/'+entry.teacherUid));
          if(!['admin','employee'].includes(teachers.get(entry.teacherUid)?.role))P.fail('failed-precondition','Invalid generated teacher');
          if(!work.has(entry.teacherUid)){const key=input.date+'_'+entry.teacherUid;const [weekly,daily,absence]=await Promise.all([read('teacherWeeklyWork/'+entry.teacherUid),read('teacherDateWork/'+key),read('teacherDayAbsences/'+key)]);work.set(entry.teacherUid,{weekly,daily,absence:absenceOverrides.has(entry.teacherUid)?absenceOverrides.get(entry.teacherUid):absence});}
          P.validatePlacement(entry,final,work.get(entry.teacherUid));
        }
        for(const write of writes)if(write.after?.regularId&&!final.some(e=>e.id===write.path.split('/')[1]))P.fail('failed-precondition','Invisible weekly occurrence');
        // Also validate capacity after deletes/status changes; unchanged legacy work mismatch is retained.
        for(const entry of final.filter(e=>e.status!=='cancelled')){
          const peers=final.filter(e=>e.id!==entry.id&&e.status!=='cancelled'&&e.teacherUid===entry.teacherUid);
          // Ignore work policy here: changing a work setting must not erase existing lessons.
          P.validatePlacement(entry,[entry,...peers],{});
        }
      }
      const version=(lock?.version||0)+1;if(!Number.isSafeInteger(version))P.fail('resource-exhausted','Revision exhausted');
      const result={version,changed:writes.length};
      // All reads above precede every write; data, history, notifications and receipt commit atomically.
      for(let i=0;i<writes.length;i++){
        const w=writes[i],ref=db.doc(w.path);if(w.after)tx.set(ref,w.after);else tx.delete(ref);
        tx.set(db.doc(`auditLogs/normal_${operationKey}_${i}`),{path:w.path,action:w.after?(w.before?'変更':'追加'):'削除',summary:'通常授業・勤務設定のサーバー更新',actorUid:uid,actorName:String(actor.name||'').slice(0,90),beforeJson:auditJson(w.before),afterJson:auditJson(w.after),groupId:input.requestId,courseId:'',createdAt:stamp()});
      }
      for(const [teacherUid,n]of notices)tx.set(db.doc(`notifications/${teacherUid}/items/normal_${operationKey}`),{...n,read:false,createdAt:stamp()});
      tx.set(db.doc('normalAuthorityState/global'),{version,updatedBy:uid,updatedAt:stamp()});
      tx.set(db.doc(receiptPath),{hash,result,createdAt:stamp()});
      return result;
    });
  };
}
function entryToken(entry){const {id,...data}=entry;return digest(canonical(archive(data)));}
module.exports={createNormalAuthority,entryToken,cleanEntry};
