#!/usr/bin/env python3
"""Local, read-only source comparison report; never uploads source or reads application data."""
import difflib, json, os, re
from pathlib import Path
from zipfile import ZipFile
os.umask(0o077)
def one(pattern):
    paths=list(Path.home().glob(pattern))
    if len(paths)!=1: raise RuntimeError("Expected one directory: "+pattern)
    return paths[0]
p=one("shiftly-ranking-stage155.*")
q=one("shiftly-ranking-stage157.*")
comparison=json.loads((q/"comparison.json").read_text())
output=Path.home()/"ranking-stage158-review.txt"
if output.exists(): raise RuntimeError("Report already exists; review existing report")
sensitive=re.compile(r"secret|password|private.?key|credential|api.?key|access.?token|refresh.?token|authorization|bearer|qr.?key|encrypt|decrypt|BEGIN .*KEY",re.I)
def clean(line):
    if sensitive.search(line) or len(line)>350:
        return line[:1]+" [REDACTED: potentially sensitive or long line]"
    return line.rstrip("\n")
with output.open("x",encoding="utf-8") as out:
    for prod,qa in [("normalAuthorityApi","qaNormalAuthorityApi"),("seasonalAuthorityApi","qaSeasonalAuthorityApi"),("bookingAdminApi","qaBookingAdminApi")]:
        info=comparison[prod]
        print("\n=== "+prod+" ===",file=out)
        for key in ("production_only","qa_only","changed_common"):
            print(key+": "+", ".join(info[key]),file=out)
        with ZipFile(p/(prod+"-rollback.zip")) as a, ZipFile(q/"qa"/(qa+".zip")) as b:
            for name in info["changed_common"]:
                if name not in {"index.js","booking-graph.cjs","seasonal-operations.cjs","stage2-bridge.cjs"}: raise RuntimeError("Unexpected changed file "+name)
                left=a.read(name).decode().splitlines(keepends=True)
                right=b.read(name).decode().splitlines(keepends=True)
                diff=list(difflib.unified_diff(left,right,fromfile="production/"+name,tofile="qa/"+name,n=2))
                if name=="index.js":
                    # Only include ranking/target-related hunks; leave other business differences local.
                    hunks=[]; h=[]
                    for line in diff[2:]:
                        if line.startswith("@@"):
                            if h: hunks.append(h)
                            h=[]
                        h.append(line)
                    if h: hunks.append(h)
                    diff=diff[:2]+[line for h in hunks if any(re.search(r"ranking|initializeApp|getFirestore|projectId|databaseId|exports\\.",l,re.I) for l in h) for line in h]
                print("\n".join(clean(line) for line in diff),file=out)
print("REPORT:",output)
print("SUCCESS STAGE158 INTEGRATION DIFF REPORT")
