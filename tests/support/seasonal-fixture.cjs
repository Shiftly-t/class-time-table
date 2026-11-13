// Browser contract fixture ONLY. No production SDK and no supplied private handlers.
// Real business authorization/concurrency is tested separately by the private adapter.
const crypto=require('node:crypto'),P=require('../../server-candidates/seasonal-authority/policy.cjs');
function create(initial){const records=new Map(Object.entries(structuredClone(initial))),snapshots=new Map();let version=0,sequence=0;const now=()=>({__shiftlyType:'timestamp',value:'2026-11-13T00:00:00.000Z'}),token=v=>v==null?null:crypto.createHash('sha256').update(JSON.stringify(P.canonical(v))).digest('hex'),snapshot=p=>({value:P.canonical(records.get(p)??null),token:token(records.get(p)??null)});
 const operations=['inspectCourse','saveCourse','patchCourse','deleteCourse','inspectAvailability','saveAvailability','publishManualCourse','saveCalendar','saveCourseMemo','planStudentDelete','deleteStudent','createSnapshot','listSnapshots','planSnapshotRestore','restoreSnapshot','inspectControl','setMaintenance','verifyIntegrity'];
 const put=(p,v)=>records.set(p,structuredClone(v)),expect=(p,t)=>{if(token(records.get(p)??null)!==t)throw Object.assign(Error('Source changed'),{code:'aborted'})};
 async function invoke(name,d,uid){
  if(name==='bookingAdminApi'){if(d.action==='teachers')return {maxTeacherCapacity:2,teachers:[...records].filter(([p,v])=>p.startsWith('users/')&&['admin','employee'].includes(v.role)).map(([p,v])=>({id:p.split('/')[1],...v,defaultCapacity:2,slots:records.get('specialCourses/'+d.courseId+'/teacherAvailability/'+p.split('/')[1])?.slots||[]}))};if(d.action==='getSettings')return {serverOwnsTimetable:true,course:records.get('specialCourses/'+d.courseId),settings:null};}
  if(name!=='seasonalAuthorityApi')throw Error('Unsupported fixture callable');const cp='specialCourses/'+d.courseId;
  if(d.action==='capabilities')return {protocolVersion:3,operations};
  if(d.action==='inspectCourse')return {protocolVersion:3,course:snapshot(cp),entries:Object.fromEntries([...records].filter(([p,v])=>p.startsWith('timetableEntries/')&&v.courseId===d.courseId).map(([p])=>[p.split('/')[1],snapshot(p)])),meta:snapshot(cp+'/scheduleMeta/state')};
  if(d.action==='inspectAvailability')return {protocolVersion:3,course:snapshot(cp),availability:snapshot(cp+'/teacherAvailability/'+d.teacherUid)};
  if(d.action==='verifyIntegrity')return {protocolVersion:3,ok:true,checks:['references','counts','capacity'],counts:{students:1,lessons:0,reservations:0,slots:0},workWarningsRequireReview:true};
  if(d.action==='inspectControl')return {protocolVersion:3,maintenance:snapshot('systemConfig/maintenance')};
  if(d.action==='requestStatus')return {protocolVersion:2,committed:true};
  if(d.action==='planStudentDelete'){const counts=Object.fromEntries(['timetableEntries','bookingEntries','bookingAccess','monthlyTargets'].map(c=>[c,[...records].filter(([p,v])=>p.startsWith(c+'/')&&v.studentId===d.studentId).length]));return {protocolVersion:3,canApply:true,revision:version,counts,expectedStudent:token(records.get('schoolStudents/'+d.studentId)),blockers:[]};}
  if(d.action==='listSnapshots')return {protocolVersion:3,archives:[...snapshots].map(([id,s])=>({id,formatVersion:2,recordCount:s.size,requiresQrReissue:true}))};
  if(d.action==='planSnapshotRestore')return {protocolVersion:3,canApply:true,revision:version,count:snapshots.get(d.archiveId).size,requiresQrReissue:true};
  const stamp={updatedBy:uid,updatedAt:now()};let extra={};
  if(d.action==='saveAvailability'){expect(cp,d.expectedCourse);expect(cp+'/teacherAvailability/'+d.teacherUid,d.expected);put(cp+'/teacherAvailability/'+d.teacherUid,{slots:d.slots,...stamp});}
  else if(['saveCourse','patchCourse'].includes(d.action)){expect(cp,d.expected);put(cp,{...(d.action==='patchCourse'?records.get(cp):{}),...(d.patch||d.value),...stamp});}
  else if(d.action==='deleteCourse'){expect(cp,d.expected);records.delete(cp);}
  else if(d.action==='publishManualCourse'){expect(cp,d.expectedCourse);expect(cp+'/scheduleMeta/state',d.expectedMeta);for(const x of d.changes){const p='timetableEntries/'+x.id;expect(p,x.expected);if(x.remove)records.delete(p);else put(p,x.value);}put(cp+'/scheduleMeta/state',{version:++sequence,...stamp});}
  else if(d.action==='saveCourseMemo'){const p='timetableEntries/'+d.lessonId;expect(p,d.expected);put(p,{...records.get(p),memo:d.memo,memoUpdatedAt:now()});}
  else if(d.action==='saveCalendar'){const p=d.collection+'/'+d.date;expect(p,token(d.expectedValue));if(d.remove)records.delete(p);else put(p,{...d.value,...stamp});}
  else if(d.action==='setMaintenance'){expect('systemConfig/maintenance',d.expected);put('systemConfig/maintenance',{...d.value,...stamp});}
  else if(d.action==='deleteStudent'){expect('schoolStudents/'+d.studentId,d.expectedStudent);for(const [p,v]of [...records])if(v.studentId===d.studentId){if(p.startsWith('bookingAccess/'))put(p,{...v,revoked:true,tokenCipher:'',tokenHash:''});else records.delete(p);}records.delete('schoolStudents/'+d.studentId);}
  else if(d.action==='createSnapshot'){const id='snapshot_'+(++sequence);snapshots.set(id,new Map(structuredClone([...records].filter(([p])=>!p.startsWith('users/')&&!p.startsWith('systemConfig/')))));extra={archiveId:id,count:snapshots.get(id).size,requiresQrReissue:true};}
  else if(d.action==='restoreSnapshot'){if(d.expectedRevision!==version)throw Object.assign(Error('stale restore'),{code:'aborted'});for(const [p]of [...records])if(!p.startsWith('users/')&&!p.startsWith('systemConfig/'))records.delete(p);for(const [p,v]of snapshots.get(d.archiveId))put(p,v);extra={requiresQrReissue:true};}
  else throw Error('Unsupported fixture action');return {protocolVersion:3,changed:1,version:++version,...extra};
 }
 return {invoke,records:()=>Object.fromEntries(records),prepareBooking:async({qrOnly=false}={})=>{const student=records.get('schoolStudents/s');put('bookingAccess/test',{studentId:'s',courseId:'c',revoked:false});if(!qrOnly)put('timetableEntries/b_mock',{...records.get('specialCourses/c').periods[0],courseId:'c',studentId:'s',studentName:student.name,grade:student.grade,school:student.school,teacherUid:'a',teacherName:'講師A',date:'2026-12-01',subject:'数学',status:'scheduled',memo:'',memoUpdatedAt:null,nextDates:[]});}};
}
module.exports={create};
