#!/usr/bin/env python3
"""Stage ONLY the normal authority emulator candidate; no cloud writes or deploy."""
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
        if f.is_dir() or p.parts[0] != 'qaNormalAuthorityApi':
            continue
        assert not p.is_absolute() and '..' not in p.parts
        out = dst.joinpath(*p.parts[1:])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(z.read(f))
assert len(list(dst.rglob('*.*'))) == 25, 'UNEXPECTED SOURCE FILE COUNT'
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
     "if(before?.status==='done'&&(!after||['date','start','end','teacherUid'].some(k=>before[k]!==after[k]))&&!(verifiedNormalLessons.has(path)&&!before.courseId&&(!after||!after.courseId)))")
], 'bb4511f92a5d05c1b6d6f21d9e15b2a44b2dd97f274e8e77c6cb64a5e2b19760')
(work / 'firebase.json').write_text(json.dumps({
    'emulators': {'firestore': {'host': '127.0.0.1', 'port': 8788}, 'ui': {'enabled': False}, 'singleProjectMode': True}
}, indent=2))
# No functions deployment config in this staging folder.
print('SUCCESS RANKING NORMAL LIVE BASELINE STAGED')
