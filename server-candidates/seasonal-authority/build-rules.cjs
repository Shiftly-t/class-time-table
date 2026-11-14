'use strict';
// Local candidate only. No Firebase SDK, credentials, deployment or network.
const fs=require('node:fs'),path=require('node:path');
const roots=['schoolStudents','monthlyTargets','timetableEntries','teacherDayAbsences','specialCourses','schoolEvents','schoolOpenDays','schoolClosures','auditLogs','backupArchives'];
function build(){let source=fs.readFileSync(path.resolve(__dirname,'../../tests/fixtures/firestore.supplied.rules'),'utf8');
 const marker='match /databases/{database}/documents {';if(!source.includes(marker))throw Error('Unexpected supplied rules');
 source=source.replace(marker,marker+`\n    // Independent of the API enabled gate: freezing APIs MUST NOT reopen legacy writes.\n    function serverAuthorityLocked() {\n      return exists(/databases/$(database)/documents/systemConfig/coordination)\n        && get(/databases/$(database)/documents/systemConfig/coordination).data.get('enforceDirectWriteDeny', false) == true;\n    }`);
 // Match public paths, including course subcollections and backup parts.
 const matches=[...source.matchAll(/match\s+\/([A-Za-z]+)\/[^{\n]*\{[^}\n]+\}[^\n{]*\{/g)];
 for(const match of matches.reverse()){
  const root=match[1],notice=root==='notifications';if(!roots.includes(root)&&!notice)continue;
  const start=match.index+match[0].length;let depth=1,end=start;for(;end<source.length&&depth;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}
  if(depth)throw Error('Unbalanced rule block');let block=source.slice(start,end-1);
  block=block.replace(/allow\s+([\w,\s]+):\s*if\s+([^;]+);/g,(all,methods,condition)=>{const names=methods.split(',').map(x=>x.trim()),write=names.filter(n=>['write','create','update','delete'].includes(n)&&(!notice||n==='create')),rest=names.filter(n=>!write.includes(n));if(!write.length)return all;return (rest.length?`allow ${rest.join(', ')}: if ${condition};\n`:'')+`allow ${write.join(', ')}: if !serverAuthorityLocked() && (${condition});`;});
  source=source.slice(0,start)+block+source.slice(end-1);
 }
 let end=source.indexOf(marker)+marker.length,depth=1;for(;end<source.length&&depth;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}if(depth)throw Error('Unexpected rules ending');end--;source=source.slice(0,end)+`\n    // New work settings and coordinator internals never accept browser writes.\n    match /teacherWeeklyWork/{uid} { allow read: if isMember(); allow write: if false; }\n    match /teacherDateWork/{id} { allow read: if isMember(); allow write: if false; }\n`+source.slice(end);
 return source;
}
if(require.main===module){const target=process.argv[2];if(!target||fs.existsSync(target))throw Error('Explicit new local output path required; never overwrite');fs.writeFileSync(target,build(),{flag:'wx'});}
module.exports={build,roots};
