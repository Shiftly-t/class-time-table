#!/usr/bin/env python3
"""Stage independently tested QA candidates for shared booking-graph compatibility.
No deployment configuration, credentials, or real Firestore writes.
"""
import hashlib, json, shutil, sys
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

archive, normal, seasonal, booking, work = map(Path, sys.argv[1:])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == 'c436672adacb84fa7b28f819f16478714d27293e0c73d42625319015c8ed45c4', 'ARCHIVE MISMATCH'
modules = booking/'functions/node_modules'
assert modules.is_dir()
roots = {
    'qaBookingAdminApi': booking,
    'qaNormalAuthorityApi': normal,
    'qaSeasonalAuthorityApi': seasonal,
    'qaBookingPublicApi': None,
    'qaBookingStudentDeleted': None,
}
base = work/'variants'
base.mkdir(parents=True, exist_ok=False)
old = "!['scheduled','done'].includes(lesson.get('status'))"
previous = "!['scheduled','done','cancelled'].includes(lesson.get('status'))"
new = "(!['scheduled','done'].includes(lesson.get('status'))&&!(lesson.get('status')==='cancelled'&&Date.parse(p.date+'T'+p.end+':00+09:00')<=(coor.scope()?.now??Date.now())))"

for name, source in roots.items():
    dst = base/name
    if source:
        shutil.copytree(source/'functions', dst, ignore=shutil.ignore_patterns('node_modules'))
    else:
        dst.mkdir()
        with ZipFile(archive) as z:
            for f in z.infolist():
                p = PurePosixPath(f.filename)
                if f.is_dir() or p.parts[0]!=name:
                    continue
                assert not p.is_absolute() and '..' not in p.parts
                out=dst.joinpath(*p.parts[1:])
                out.parent.mkdir(parents=True,exist_ok=True)
                out.write_bytes(z.read(f))
    (dst/'node_modules').symlink_to(modules.resolve(),target_is_directory=True)
    path=dst/'booking-graph.cjs'
    s=path.read_text()
    anchor=previous if name=='qaBookingAdminApi' else old
    assert s.count(anchor)==1, 'GRAPH ANCHOR MISMATCH: '+name
    path.write_text(s.replace(anchor,new,1))
    print('PASS: GRAPH COMPATIBILITY STAGED',name)

test=base/'qaBookingAdminApi/test-ranking-booking-correction-emulator.cjs'
s=test.read_text()
anchor="  assert.equal((await db.doc(entry).get()).get('confirmed').length,1);"
assert s.count(anchor)==1
s=s.replace(anchor,anchor+"""
  const {FieldValue,Timestamp}=require('firebase-admin/firestore');
  const {HttpsError}=require('firebase-functions/v2/https');
  const path=require('node:path');
  const variants=['qaBookingAdminApi','qaNormalAuthorityApi','qaSeasonalAuthorityApi','qaBookingPublicApi','qaBookingStudentDeleted'];
  const adapters=variants.map(name=>{
    const dir=path.resolve(__dirname,'..',name);
    const localCore=require(path.join(dir,'booking-core.cjs'));
    const coor=require(path.join(dir,'coordination.cjs')).createCoordinator({rawDb:db,FieldValue,Timestamp,core:localCore,HttpsError,key:()=> 'ad'.repeat(32)});
    const graph=require(path.join(dir,'booking-graph.cjs')).createBookingGraph({coor,core:localCore,reservedDate:()=>false});
    const bridge=require(path.join(dir,'stage2-bridge.cjs')).createStage2Bridge({coor,core:localCore,Timestamp,reservedDate:()=>false,legacyAdmin:()=>{throw Error('UNEXPECTED LEGACY ADMIN');},legacyPublic:()=>{throw Error('UNEXPECTED LEGACY PUBLIC');}});
    const validate=()=>coor.run('admin',{auth:{uid:'admin'},app:{appId:'fixture'},data:{action:'capabilities'}},()=>graph.validate({strict:true}).then(()=>({ok:true})));
    return {name,validate,bridge};
  });
  for(const adapter of adapters){
    assert.equal((await adapter.validate()).ok,true);
    console.log('PASS: ABSENCE COMPATIBLE',adapter.name);
  }
  // A genuine unrelated calendar update runs the seasonal candidate's existing
  // beforeCommit, not merely the new booking handler.
  const calendarDate='2027-01-12';
  const calendar=await adapters.find(a=>a.name==='qaSeasonalAuthorityApi').bridge.seasonalApi({
    auth:{uid:'admin'},app:{appId:'fixture'},data:{action:'saveCalendar',requestId:'cross_calendar',collection:'schoolOpenDays',date:calendarDate,expectedValue:null,remove:false,value:{date:calendarDate,note:'fixture'}}
  });
  assert.equal(calendar.changed,1);
  assert.equal((await db.doc('schoolOpenDays/'+calendarDate).get()).exists,true);
  assert.equal((await day.get()).get('revision'),2);
  assert.equal((await db.doc('bookingSlots/'+slot).get()).get('used'),1);
  const lessonRef=db.doc('timetableEntries/'+id);
  // Invalid statuses and mismatched display fields must still be denied.
  await lessonRef.update({status:'invalid'});
  for(const adapter of adapters)await assert.rejects(adapter.validate(),/Published assignment display.state mismatch/);
  await lessonRef.update({status:'cancelled',teacherName:'wrong'});
  for(const adapter of adapters)await assert.rejects(adapter.validate(),/Published assignment display.state mismatch/);
  await lessonRef.update({teacherName:'A'});
  console.log('PASS: CROSS FUNCTION VALIDATION AND NEGATIVE TESTS');
""",1)
test.write_text(s)
(work/'firebase.json').write_text(json.dumps({'emulators':{'firestore':{'host':'127.0.0.1','port':8788},'hub':{'host':'127.0.0.1','port':4400},'logging':{'host':'127.0.0.1','port':4500},'ui':{'enabled':False},'singleProjectMode':True}},indent=2))
print('SUCCESS RANKING CROSS FUNCTION CANDIDATES STAGED')
