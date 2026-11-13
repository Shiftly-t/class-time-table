// Static source-contract assertions only. These DO NOT compile/evaluate Firestore
// rules, authorize any network request, or count as Emulator test passes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const rules=read('tests/fixtures/firestore.supplied.rules'),app=read('app.js'),booking=read('course-booking-admin.js'),normal=read('normal-editor.js');
function block(source,marker){
 const at=source.indexOf(marker);assert.ok(at>=0,'missing '+marker);
 const start=marker.endsWith('{')?at+marker.length-1:source.indexOf('{',at+marker.length);
 let depth=0,quote='',lineComment=false;
 for(let i=start;i<source.length;i++){
  const c=source[i];if(lineComment){if(c==='\n')lineComment=false;continue}
  if(quote){if(c==='\\'){i++;continue}if(c===quote)quote='';continue}
  if(c==='/'&&source[i+1]==='/'){lineComment=true;i++;continue}
  if("'\"`".includes(c)){quote=c;continue}
  if(c==='{')depth++;if(c==='}'&&--depth===0)return source.slice(start+1,i);
 }
 throw Error('unclosed '+marker);
}
const compact=s=>s.replace(/\s+/g,'');
const matches=(s,re)=>assert.match(compact(s),re);
const fn=name=>block(rules,'function '+name+'('),entry=block(rules,'match /timetableEntries/{id} {');
const results=[];function check(name,f){f();results.push(name);console.log('STATIC PASS '+name)}
check('registered role and maintenance gates are present',()=>{matches(fn('registeredStaff'),/signedIn\(\).*exists\(userPath\(request.auth.uid\)\).*\['owner','admin','employee'\]/);matches(fn('isMember'),/registeredStaff\(\).*==\s*'owner'\|\|!isMaintenanceEnabled\(\)/);matches(block(rules,'match /teacherDayAbsences/{absenceId} {'),/allowread:ifisMember\(\)/)});
check('client role escalation is denied',()=>matches(block(rules,'match /users/{uid} {'),/allowcreate,update,delete:iffalse/));
check('all seven booking collections deny client read/write',()=>{for(const name of ['bookingSettings','bookingSlots','bookingEntries','bookingAccess','bookingTeacherLoad','bookingTeacherLimits','bookingAudit'])matches(block(rules,`match /${name}/{id} {`),/allowread,write:iffalse/)});
check('reserved b_ IDs are denied in create/update/delete',()=>assert.equal((entry.match(/!id\.matches\('\^b_\.\*'\)/g)||[]).length,3));
check('booking active protection covers create/update/delete, including memo-only writes',()=>{matches(entry,/allowcreate:.*!bookingActiveForEntry\(request.resource.data\)/);matches(entry,/allowupdate:.*!bookingActiveForEntry\(resource.data\)&&!bookingActiveForEntry\(request.resource.data\)/);matches(entry,/allowdelete:.*!bookingActiveForEntry\(resource.data\)/);assert.ok(!entry.includes('isOwner()'));matches(fn('bookingActiveForEntry'),/data.get\('enabled',false\)==true/)});
check('memo form writes the protected timetable document directly',()=>{const body=block(app,"$('memoForm').addEventListener('submit',async event=>");assert.match(body,/runTransaction/);assert.match(body,/doc\(db,'timetableEntries',lesson.id\)/);assert.ok(!body.includes('bookingEditorCall'))});
check('lesson form and course editor also write timetable directly',()=>{assert.match(block(app,"$('lessonForm').addEventListener('submit',async event=>"),/tx.set\(ref,next\)/);const body=block(app,'async function publishCourseEditor(');assert.match(body,/tx.update\(doc\(db,'timetableEntries',change.id\)/);assert.match(body,/tx.delete\(doc\(db,'timetableEntries',change.id\)/)});
check('booking management UI uses protected callable API actions',()=>{assert.match(booking,/httpsCallable\(getFunctions\(app,'asia-northeast1'\),'bookingAdminApi'\)/);for(const action of ['reassign','publish','changePublished','moveUnpublished','cancelConfirmed'])assert.ok(booking.includes(action))});
check('student label propagation directly updates all linked entries in batches',()=>{const body=block(app,'async function updateStudentEntryLabels(');assert.match(body,/where\('studentId','==',studentId\)/);assert.match(body,/batch.update\(snapshot.ref,change\)/);assert.ok(!body.includes('bookingEditorCall'))});
check('linked student deletion is a direct batch path too',()=>{const body=block(app,"$('confirmStudentDeletion').addEventListener('click', async () =>");assert.match(body,/batch.delete\(snapshot.ref\)/);assert.ok(!body.includes('bookingEditorCall'))});
check('normal assignment uses post-commit teacher absence document',()=>{matches(fn('regularAssignmentAllowed'),/!existsAfter\(path\)/);assert.equal((fn('regularAssignmentAllowed').match(/getAfter\(path\)/g)||[]).length,4)});
check('normal teacher absence and course assignment checks are separate',()=>{matches(fn('regularAssignmentAllowed'),/d.get\('courseId',''\)!=''/);matches(fn('assignedAvailable'),/!\('courseId'ind\)\|\|/)});
check('course periods have only list/count validation in supplied rules',()=>{const body=block(rules,'match /specialCourses/{id} {');matches(body,/periodsislist.*periods.size\(\)>=1.*periods.size\(\)<=12/);assert.ok(!body.includes('periods[0]'))});
check('availability slots have only list/count validation, not element/calendar validation',()=>{const body=block(rules,'match /specialCourses/{courseId}/teacherAvailability/{uid} {');matches(body,/slotsislist.*slots.size\(\)<=1200/);assert.ok(!body.includes('slots['));assert.ok(!body.includes('schoolClosures'))});
check('owner is not exempted from archived availability write rejection',()=>matches(block(rules,'match /specialCourses/{courseId}/teacherAvailability/{uid} {'),/allowcreate,update:ifisMember\(\)&&exists\(coursePath\(courseId\)\)&&get\(coursePath\(courseId\)\).data.get\('archived',false\)!=true/));
check('student write policy has no schema validation function',()=>matches(block(rules,'match /schoolStudents/{id} {'),/allowcreate,update,delete:ifisAdmin\(\);/));
check('revision counter accepts any positive int, not exact previous+1',()=>{const body=block(rules,'match /specialCourses/{courseId}/scheduleMeta/{metaId} {');matches(body,/versionisint.*version>=1/);assert.ok(!body.includes('resource.data.version + 1'))});
check('entry allow conditions require neither audit nor capacity/revision shared state',()=>{assert.ok(!entry.includes('auditLogs'));assert.ok(!entry.includes('scheduleMeta'));assert.ok(!fn('validEntry').includes('bookingTeacherLoad'));assert.ok(!fn('regularAssignmentAllowed').includes('schoolStudents'))});
check('app-sized batches must be tested against rules read-call limits separately',()=>{assert.match(normal,/moves.length\+absences.length>100/);assert.match(app,/changes.length>90/);assert.match(app,/offset\+=180/)});
check('backup includes archived availability and directly restores it',()=>{const gather=block(app,'async function gatherOwnerRecords(');assert.match(gather,/\['teacherAvailability','scheduleMeta'\]/);assert.doesNotMatch(gather,/\.archived\b/);const restore=block(app,'async function restoreOwnerArchive(');assert.match(restore,/batch.set\(doc\(db,record.path\)/)});
const out={kind:'static-source-contract',rulesEvaluation:'UNVERIFIED',passed:results.length,checks:results};
const dir=path.join(root,'audit-evidence/20261113');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'static-results.json'),JSON.stringify(out,null,2)+'\n');
console.log(`STATIC RESULT ${results.length} source assertions passed; Firestore evaluation UNVERIFIED`);
