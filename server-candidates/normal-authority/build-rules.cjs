'use strict';
// Produce a review artifact, never invoke Firebase CLI or deploy anything.
const fs=require('node:fs'),path=require('node:path');
function build(){
  let rules=fs.readFileSync(path.resolve(__dirname,'../../tests/fixtures/firestore.supplied.rules'),'utf8');
  const gate="  function normalAuthorityEnabled() { return exists(/databases/$(database)/documents/systemConfig/normalAuthority) && get(/databases/$(database)/documents/systemConfig/normalAuthority).data.get('enabled',false) == true; }\n";
  rules=rules.replace('  function signedIn()',gate+'  function signedIn()');
  function block(collection,transform){const start=rules.indexOf(`  match /${collection}/`);if(start<0)throw Error('Missing collection '+collection);const end=rules.indexOf('\n  }',start)+4;if(end<4)throw Error('Unrecognized rule block');rules=rules.slice(0,start)+transform(rules.slice(start,end))+rules.slice(end);}
  // When enabled, direct normal writes are denied, including memo and status edits.
  // A course cannot be disguised as normal on update or vice versa.
  block('timetableEntries',s=>s.replace('allow create: if isAdmin()','allow create: if (!normalAuthorityEnabled() || request.resource.data.get(\'courseId\',\'\') != \'\') && isAdmin()').replace('allow update: if isAdmin()','allow update: if (!normalAuthorityEnabled() || (resource.data.get(\'courseId\',\'\') != \'\' && request.resource.data.get(\'courseId\',\'\') != \'\')) && isAdmin()').replace('allow delete: if isAdmin()','allow delete: if (!normalAuthorityEnabled() || resource.data.get(\'courseId\',\'\') != \'\') && isAdmin()'));
  block('teacherDayAbsences',s=>s.replaceAll('if isAdmin()','if !normalAuthorityEnabled() && isAdmin()'));
  // Every source used to synthesize normal lessons must be frozen until its trusted adapter exists.
  // This intentionally blocks legacy student writes/restore in authority mode, rather than bypassing limits.
  block('schoolStudents',s=>s.replace('if isAdmin()','if !normalAuthorityEnabled() && isAdmin()'));
  for(const col of ['schoolClosures','schoolOpenDays','schoolEvents'])block(col,s=>s.replaceAll('if isAdmin()','if !normalAuthorityEnabled() && isAdmin()'));
  // Course metadata edits/archive remain independent; moving course periods across normal days does not.
  block('specialCourses',s=>s.replace('allow create, update: if isAdmin()','allow create, update: if (!normalAuthorityEnabled() || (resource != null && request.resource.data.startDate == resource.data.startDate && request.resource.data.endDate == resource.data.endDate && request.resource.data.periods == resource.data.periods)) && isAdmin()').replace('allow delete: if isAdmin()','allow delete: if !normalAuthorityEnabled() && isAdmin()'));
  const end=rules.lastIndexOf(' }\n}');if(end<0)throw Error('Unexpected rules ending');
  rules=rules.slice(0,end)+`  // New settings are read-only to staff. Validated Admin transactions own all writes.
  match /teacherWeeklyWork/{uid} { allow read: if isMember(); allow write: if false; }
  match /teacherDateWork/{id} { allow read: if isMember(); allow write: if false; }
  match /normalAuthorityState/{id} { allow read, write: if false; }
  match /normalAuthorityRequests/{id} { allow read, write: if false; }
`+rules.slice(end);
  return rules;
}
if(require.main===module){const target=process.argv[2];if(!target)throw Error('Explicit local output path required');fs.writeFileSync(target,build());}
module.exports={build};
