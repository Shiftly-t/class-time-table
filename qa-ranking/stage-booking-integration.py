#!/usr/bin/env python3
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import hashlib, shutil, sys, json
archive, repo, work = map(Path, sys.argv[1:])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == 'c436672adacb84fa7b28f819f16478714d27293e0c73d42625319015c8ed45c4'
dst = work / 'functions'
dst.mkdir(parents=True, exist_ok=False)
with ZipFile(archive) as z:
    for f in z.infolist():
        p = PurePosixPath(f.filename)
        if f.is_dir() or p.parts[0] != 'qaBookingAdminApi': continue
        assert not p.is_absolute() and '..' not in p.parts
        out = dst.joinpath(*p.parts[1:])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(z.read(f))
assert len(list(dst.rglob('*.*'))) == 26
for p in repo.glob('ranking-*.mjs'): shutil.copy2(p, dst / p.name)
for p in (repo / 'qa-ranking/functions').glob('*.cjs'): shutil.copy2(p, dst / p.name)
def patch(name,pairs):
    p=dst/name
    s=p.read_text()
    for old,new in pairs:
        assert s.count(old)==1, 'ANCHOR MISMATCH '+name+' '+old[:80]
        s=s.replace(old,new,1)
    p.write_text(s)
patch('stage2-bridge.cjs',[
    (" const normalModule=require('./normal-authority/service.cjs');",
     " const normalModule=require('./normal-authority/service.cjs');\n const ranking=require('./ranking-authority.cjs').createRankingAuthority({coor});\n const bookingCorrection=require('./ranking-booking-correction.cjs').createBookingCorrection({coor,core});"),
    ("  if(touched)await graph.validate({strict:ctx.action==='restoreSnapshot'});",
     "  const verifiedNormalLessons=await ranking.beforeCommit(ctx,{restorePlanning});\n  if(touched)await graph.validate({strict:ctx.action==='restoreSnapshot',verifiedNormalLessons});"),
    ("  const d=req.data||{};\n  if(['setCapacity'", "  const d=req.data||{};\n  await bookingCorrection.prepare(ctx,d);\n  if(d.action==='setPublishedAttendance')return bookingCorrection.attendance(ctx,d);\n  if(['setCapacity'")
])
patch('ranking-authority.cjs',[
    ("if (active && normal && ctx.action === 'day') {","if (active && ((normal && ctx.action === 'day') || ctx.rankingCorrection?.booking)) {"),
    ("entry.old && !entry.old.courseId &&\n              (!entry.next || !entry.next.courseId)",
     "entry.old && ((normal && !entry.old.courseId && (!entry.next || !entry.next.courseId)) || (!normal && ctx.rankingCorrection?.booking?.path === 'timetableEntries/' + entry.id && entry.old.courseId === ctx.rankingCorrection.booking.courseId && (!entry.next || entry.next.courseId === entry.old.courseId)))")
])
patch('booking-graph.cjs',[
    ("async function validate({strict=false,preserveExistingClosures=false}={})",
     "async function validate({strict=false,preserveExistingClosures=false,verifiedNormalLessons=new Set()}={})"),
    ("!['scheduled','done'].includes(lesson.get('status'))","!['scheduled','done','cancelled'].includes(lesson.get('status'))"),
    ("  for(const n of newPlacement){if(!strict&&n.period.date<core.jstToday())",
     "  const correction=coor.scope()?.rankingCorrection;\n  const correctedPlacement=n=>{const b=correction?.booking;return !!b&&verifiedNormalLessons.has(b.path)&&n.course.id===b.courseId&&n.entry.studentId===b.studentId&&n.period.date===correction.date&&core.slotId(n.course.id,n.period.date,n.period.index)===b.to&&(!n.item||n.item.published===true&&'timetableEntries/'+n.item.lessonId===b.path&&n.item.teacherUid===b.teacherUid);};\n  for(const n of newPlacement){if(!strict&&n.period.date<core.jstToday()&&!correctedPlacement(n))"),
    ("if(before?.status==='done'&&(!after||['date','start','end','teacherUid'].some(k=>before[k]!==after[k])))",
     "if(before?.status==='done'&&(!after||['date','start','end','teacherUid'].some(k=>before[k]!==after[k]))&&!(verifiedNormalLessons.has(path)&&(!after||(before.courseId??null)===(after.courseId??null))))")
])
(work/'firebase.json').write_text(json.dumps({'emulators':{'firestore':{'host':'127.0.0.1','port':8788},'ui':{'enabled':False},'singleProjectMode':True}},indent=2))
print('SUCCESS RANKING BOOKING LIVE BASELINE STAGED')
