#!/usr/bin/env python3
"""Prepare local NON-DEPLOYABLE production authority candidates from verified source archives."""
import hashlib,json,os,re,subprocess,tempfile
from pathlib import Path,PurePosixPath
from zipfile import ZipFile
os.umask(0o077)
def require(ok,msg):
    if not ok: raise RuntimeError(msg)
def one(pattern):
    p=list(Path.home().glob(pattern))
    require(len(p)==1,"Expected one "+pattern)
    return p[0]
p=one("shiftly-ranking-stage155.*")
q=one("shiftly-ranking-stage157.*")
state=one("shiftly-ranking-stage153.*")
subprocess.run(["sha256sum","-c","SHA256SUMS"],cwd=p,check=True,stdout=subprocess.DEVNULL)
d=Path(tempfile.mkdtemp(prefix="shiftly-ranking-stage159.",dir=Path.home()))
print("WORKDIR:",d,flush=True)
(d/"NOT_DEPLOYABLE.txt").write_text("Local review candidate only. Do not deploy.\n")
def sha(b): return hashlib.sha256(b).hexdigest()
def archive(path):
    with ZipFile(path) as z:
        data={}
        for i in z.infolist():
            if i.is_dir(): continue
            n=i.filename
            require(not PurePosixPath(n).is_absolute() and ".." not in PurePosixPath(n).parts and n not in data,"Unsafe ZIP")
            data[n]=z.read(i)
        return data
def qa_archive(name):
    path=q/"qa"/(name+".zip")
    if path.exists(): return archive(path)
    fs=json.loads((state/"functions.json").read_text())["functions"]
    f=[f for f in fs if f["name"]=="projects/shiftly-t-test/locations/asia-northeast1/functions/"+name]
    require(len(f)==1 and f[0]["state"]=="ACTIVE","QA function missing")
    b=f[0]["buildConfig"]
    s=b.get("sourceProvenance",{}).get("resolvedStorageSource") or b["source"]["storageSource"]
    require(s["bucket"]=="gcf-v2-sources-592978959203-asia-northeast1" and str(s["generation"]).isdigit(),"QA source mismatch")
    path=d/(name+".zip")
    subprocess.run(["gcloud","storage","cp","gs://"+s["bucket"]+"/"+s["object"]+"#"+str(s["generation"]),str(path),"--project=shiftly-t-test","--quiet"],check=True)
    return archive(path)
base={
 "booking-graph.cjs":"bb4511f92a5d05c1b6d6f21d9e15b2a44b2dd97f274e8e77c6cb64a5e2b19760",
 "stage2-bridge.cjs":"c52b4e378073fc90b4adb218e810a4570b8fe6abe0152d1ebe3264ea9c08373a",
 "seasonal-operations.cjs":"169aa4787c6bf8d8456722d71881e1bc876b42c39d473751f032b7e211a7d7c8"}
targets={
 "normalAuthorityApi":("qaNormalAuthorityApi",{"booking-graph.cjs","stage2-bridge.cjs","seasonal-operations.cjs"}),
 "seasonalAuthorityApi":("qaSeasonalAuthorityApi",{"booking-graph.cjs","stage2-bridge.cjs","seasonal-operations.cjs"}),
 "bookingAdminApi":("qaBookingAdminApi",{"booking-graph.cjs","stage2-bridge.cjs"}),
 "bookingPublicApi":("qaBookingPublicApi",{"booking-graph.cjs"}),
 "bookingStudentDeleted":("qaBookingStudentDeleted",{"booking-graph.cjs"})}
report={}
old=b"!['scheduled','done'].includes(lesson.get('status'))"
new=b"(!['scheduled','done'].includes(lesson.get('status'))&&!(lesson.get('status')==='cancelled'&&Date.parse(p.date+'T'+p.end+':00+09:00')<=(coor.scope()?.now??Date.now())))"
for prod,(qa,allowed) in targets.items():
    a=archive(p/(prod+"-rollback.zip")); b=qa_archive(qa)
    common={n for n in a.keys()&b.keys() if a[n]!=b[n]}
    require(common<=allowed|{"index.js"},"Unexpected common differences "+prod+": "+",".join(sorted(common-allowed-{"index.js"})))
    require("index.js" in a and b"shiftly-d02f6" in a["index.js"] and b"shiftly-t-test" not in a["index.js"],"Production entry mismatch "+prod)
    candidate=dict(a)
    for name in sorted(allowed):
        require(name in a and name in b,"Missing integration file "+prod+"/"+name)
        require(sha(a[name])==base[name],"Production baseline differs "+prod+"/"+name+" SHA256 "+sha(a[name]))
        if len(allowed)==1:
            require(a[name].count(old)==1 and a[name].replace(old,new,1)==b[name],"Public/student graph not exact tested patch "+prod)
        candidate[name]=b[name]
    if len(allowed)>1:
        for name in sorted(b.keys()-a.keys()):
            require(re.fullmatch(r"ranking-[a-z-]+\.(?:cjs|mjs)",name)!=None,"Unexpected QA-only source "+prod+"/"+name)
            # Only existing authority dependencies: standalone entry/scheduler are handled separately.
            if name in {"ranking-entry.cjs","ranking-scheduler.mjs"}: continue
            data=b[name]
            data=data.replace(b"'shiftly-t-test'",b"'shiftly-d02f6'").replace(b"'shiftly-qa-v1'",b"'(default)'")
            require(b"shiftly-t-test" not in data and b"shiftly-qa-v1" not in data and b"qa-shiftly-runtime@" not in data,"Unresolved QA target "+prod+"/"+name)
            candidate[name]=data
    require(all(candidate[n]==a[n] for n in a if n not in allowed),"Existing source overwritten "+prod)
    require(candidate["index.js"]==a["index.js"],"Production entry changed")
    dst=d/prod
    dst.mkdir()
    for n,data in candidate.items():
        f=dst/n
        f.parent.mkdir(parents=True,exist_ok=True)
        f.write_bytes(data)
    for n in sorted(allowed|{n for n in candidate.keys()-a.keys()}):
        subprocess.run(["node","--check",str(dst/n)],check=True)
    report[prod]={"changed":sorted(n for n in a if a[n]!=candidate[n]),"added":sorted(candidate.keys()-a.keys()),"productionEntryPreserved":True,"qaEntryRankingReference":bool(re.search(rb"ranking",b.get("index.js",b""),re.I))}
    print("PASS:",prod,"BASELINE, LOCAL CANDIDATE, SYNTAX",flush=True)
    print("  changed:",len(report[prod]["changed"]),"added:",len(report[prod]["added"]),"QA index ranking reference:",report[prod]["qaEntryRankingReference"])
(d/"candidate-report.json").write_text(json.dumps(report,indent=2))
print("SUCCESS STAGE159 LOCAL PRODUCTION AUTHORITY CANDIDATES")
