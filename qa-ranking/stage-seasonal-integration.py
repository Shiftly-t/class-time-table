#!/usr/bin/env python3
"""Stage ONLY the seasonal authority emulator candidate; no cloud writes or deploy."""
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import hashlib, shutil, sys, json

archive, repo, work = map(Path, sys.argv[1:])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == 'c436672adacb84fa7b28f819f16478714d27293e0c73d42625319015c8ed45c4', 'LIVE SOURCE ARCHIVE MISMATCH'
dst = work / 'functions'
dst.mkdir(parents=True, exist_ok=False)
with ZipFile(archive) as z:
    for f in z.infolist():
        p = PurePosixPath(f.filename)
        if f.is_dir() or p.parts[0] != 'qaSeasonalAuthorityApi':
            continue
        assert not p.is_absolute() and '..' not in p.parts
        out = dst.joinpath(*p.parts[1:])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(z.read(f))
assert len(list(dst.rglob('*.*'))) == 26, 'UNEXPECTED SOURCE FILE COUNT'
for path in repo.glob('ranking-*.mjs'):
    shutil.copy2(path, dst / path.name)
for path in (repo / 'qa-ranking/functions').glob('*.cjs'):
    shutil.copy2(path, dst / path.name)

def patch(name, pairs, digest):
    path = dst / name
    original = path.read_bytes()
    assert hashlib.sha256(original).hexdigest() == digest, 'SOURCE MISMATCH: '+name
    text = original.decode()
    for old, new in pairs:
        assert text.count(old) == 1, 'ANCHOR MISMATCH: '+name
        text = text.replace(old, new, 1)
    path.write_text(text)

patch('stage2-bridge.cjs', [
    (" const normalModule=require('./normal-authority/service.cjs');",
     " const normalModule=require('./normal-authority/service.cjs');\n const ranking=require('./ranking-authority.cjs').createRankingAuthority({coor});"),
    ("  if(touched)await graph.validate({strict:ctx.action==='restoreSnapshot'});",
     "  const verifiedNormalLessons=await ranking.beforeCommit(ctx,{restorePlanning});\n  if(touched)await graph.validate({strict:ctx.action==='restoreSnapshot',verifiedNormalLessons});")
], 'c52b4e378073fc90b4adb218e810a4570b8fe6abe0152d1ebe3264ea9c08373a')
patch('booking-graph.cjs', [
    ("async function validate({strict=false,preserveExistingClosures=false}={})",
     "async function validate({strict=false,preserveExistingClosures=false,verifiedNormalLessons=new Set()}={})"),
    ("if(before?.status==='done'&&(!after||['date','start','end','teacherUid'].some(k=>before[k]!==after[k])))",
     "if(before?.status==='done'&&(!after||['date','start','end','teacherUid'].some(k=>before[k]!==after[k]))&&!(verifiedNormalLessons.has(path)&&(!after||(before.courseId??null)===(after.courseId??null))))")
], 'bb4511f92a5d05c1b6d6f21d9e15b2a44b2dd97f274e8e77c6cb64a5e2b19760')
patch('seasonal-operations.cjs', [
    (" const {db,F,fail}=coor;", " const {db,F,fail}=coor;\n const correction=require('./ranking-manual-correction.cjs').createManualCorrection({coor,core});"),
    ("  const touched=[];for(const x of d.changes)", "  await correction.prepare(ctx,d,c.id);\n  const touched=[];for(const x of d.changes)"),
    ("check(before,x.expected);if(before.exists&&before.get('courseId')!==c.id)", "check(before,x.expected);correction.checkRow(ctx,before.exists?before.data():null,x.remove?null:x.value);if(before.exists&&before.get('courseId')!==c.id)"),
    ("if(before.get('status')==='done')fail('failed-precondition','Completed history cannot be deleted');", "if(before.get('status')==='done'&&!ctx.rankingCorrection)fail('failed-precondition','Completed history cannot be deleted');"),
    ("if(before.exists&&before.get('status')==='done'&&['studentId','teacherUid','date','start','end','status'].some(k=>before.get(k)!==after[k]))", "if(before.exists&&before.get('status')==='done'&&!ctx.rankingCorrection&&['studentId','teacherUid','date','start','end','status'].some(k=>before.get(k)!==after[k]))"),
    ("courseValue.archived||n.date<core.jstToday()||await closed", "courseValue.archived||(n.date<core.jstToday()&&!ctx.rankingCorrection)||await closed"),
    ("publishManualCourse:['expectedCourse','expectedMeta','changes']", "publishManualCourse:['expectedCourse','expectedMeta','changes','correction']")
], '169aa4787c6bf8d8456722d71881e1bc876b42c39d473751f032b7e211a7d7c8')
# Only the verified manual correction context may extend the graph's completed-row exception.
p = dst / 'ranking-authority.cjs'
s = p.read_text()
anchor = 'if (active && normal && ctx.action === '
assert s.count(anchor) == 1
s = s.replace("if (active && normal && ctx.action === 'day') {", "if (active && ((normal && ctx.action === 'day') || (ctx.domain === 'seasonal' && ctx.action === 'publishManualCourse' && ctx.rankingCorrection?.date === date))) {")
old = "entry.old && !entry.old.courseId &&\n              (!entry.next || !entry.next.courseId)"
new = "entry.old && ((normal && !entry.old.courseId && (!entry.next || !entry.next.courseId)) || (!normal && entry.old.courseId && !entry.id.startsWith('b_') && (!entry.next || entry.next.courseId === entry.old.courseId)))"
assert s.count(old) == 1
p.write_text(s.replace(old, new, 1))

(work / 'firebase.json').write_text(json.dumps({
    'emulators': {'firestore': {'host': '127.0.0.1', 'port': 8788}, 'ui': {'enabled': False}, 'singleProjectMode': True}
}, indent=2))
# No functions deployment config in this staging folder.
print('SUCCESS RANKING SEASONAL LIVE BASELINE STAGED')
