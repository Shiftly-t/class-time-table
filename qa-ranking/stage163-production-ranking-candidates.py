#!/usr/bin/env python3
"""Create local production ranking candidates. No cloud mutations, no deploy."""
import hashlib,json,os,re,stat,subprocess,tempfile
from pathlib import Path,PurePosixPath
from zipfile import ZipFile
os.umask(0o077)
def require(ok,msg):
    if not ok: raise RuntimeError(msg)
def one(pattern):
    a=list(Path.home().glob(pattern))
    require(len(a)==1,"Expected one "+pattern)
    return a[0]
source=one("shiftly-ranking-stage157.*")/"qa"
state=one("shiftly-ranking-stage153.*")
backup=one("shiftly-ranking-stage155.*")
subprocess.run(["sha256sum","-c","SHA256SUMS"],cwd=backup,check=True,stdout=subprocess.DEVNULL)
d=Path(tempfile.mkdtemp(prefix="shiftly-ranking-stage163.",dir=Path.home()))
print("WORKDIR:",d,flush=True)
(d/"NOT_DEPLOYABLE.txt").write_text("Local candidates. IAM, runtime, Rules and integration tests required before release.\n")
suffixes=["ReadApi","AchievementApi","CaptureDaily","FinalizeDaily","ProcessAchievements"]
mapping={"qaRanking"+s:"ranking"+s for s in suffixes}
account="shiftly-ranking-runtime@shiftly-d02f6.iam.gserviceaccount.com"
oldaccount="qa-shiftly-runtime@shiftly-t-test.iam.gserviceaccount.com"
allowed={"ranking-achievement-store.mjs","ranking-authority.cjs","ranking-automation.mjs","ranking-entry.cjs","ranking-qa-store.mjs","ranking-read.mjs","ranking-scheduler.mjs"}
fs=json.loads((state/"functions.json").read_text())["functions"]
report={}
def digest(b): return hashlib.sha256(b).hexdigest()
for qa,prod in mapping.items():
    records=[x for x in fs if x["name"]=="projects/shiftly-t-test/locations/asia-northeast1/functions/"+qa]
    require(len(records)==1 and records[0]["state"]=="ACTIVE","QA function mismatch: "+qa)
    config=records[0]["buildConfig"]
    require(config["entryPoint"]==qa and config["runtime"]=="nodejs22","Unexpected runtime or entry: "+qa)
    zpath=source/(qa+".zip")
    dst=d/prod
    dst.mkdir()
    changed=[]
    manifest={}
    with ZipFile(zpath) as z:
        require(z.testzip() is None,"Corrupt archive: "+qa)
        seen=set()
        require(json.loads(z.read("package.json")).get("main")=="ranking-entry.cjs","Unexpected package entry")
        for i in z.infolist():
            n=i.filename
            pp=PurePosixPath(n)
            require(not pp.is_absolute() and ".." not in pp.parts and not stat.S_ISLNK(i.external_attr>>16) and n not in seen,"Unsafe archive member")
            seen.add(n)
            if i.is_dir(): continue
            before=z.read(i)
            after=before
            if n.endswith((".js",".cjs",".mjs",".json")):
                s=before.decode()
                for a,b in [(oldaccount,account),("shiftly-t-test","shiftly-d02f6"),("shiftly-qa-v1","(default)"),("QA_RUNTIME_ACCOUNT","PROD_RUNTIME_ACCOUNT"),("QA_RANKING_TARGET_MISMATCH","PROD_RANKING_TARGET_MISMATCH")]+list(mapping.items()):
                    s=s.replace(a,b)
                require(not any(x in s for x in ("shiftly-t-test","shiftly-qa-v1","qa-shiftly-runtime",*mapping)),"QA reference remains: "+n)
                after=s.encode()
            if after!=before:
                require(n in allowed,"Unexpected changed file: "+n)
                changed.append(n)
            f=dst/n
            f.parent.mkdir(parents=True,exist_ok=True)
            f.write_bytes(after)
            manifest[n]=digest(after)
    require(set(changed)==allowed,"Unexpected target file set: "+prod+" "+str(changed))
    entry=(dst/"ranking-entry.cjs").read_text()
    for n in mapping.values():
        require(re.search(r"\b"+n+r"\b",entry) is not None,"Missing function reference: "+n)
    require(account in entry and "'shiftly-d02f6'" in entry and "'(default)'" in entry,"Production target mismatch")
    require(account in (dst/"ranking-scheduler.mjs").read_text(),"Scheduler account mismatch")
    for n in changed:
        subprocess.run(["node","--check",str(dst/n)],check=True)
    report[prod]={"qaArchiveSha256":digest(zpath.read_bytes()),"entryPoint":prod,"runtime":"nodejs22","changed":sorted(changed),"files":manifest}
    print("PASS:",prod,"TARGET, ENTRY, CHANGE SCOPE, SYNTAX",flush=True)
(d/"candidate-report.json").write_text(json.dumps(report,indent=2))
print("PLANNED RUNTIME ACCOUNT:",account)
print("SUCCESS STAGE163 PRODUCTION RANKING CANDIDATES")
