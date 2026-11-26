#!/usr/bin/env python3
"""QA-only maintenance: revoke explicitly named test awards without deleting history."""
import datetime, hashlib, json, os, subprocess, tempfile, urllib.request
from pathlib import Path
P = "projects/shiftly-t-test/databases/shiftly-qa-v1/documents"
API = "https://firestore.googleapis.com/v1/" + P
RECORDS = "rankingInternalAchievements"
CATALOG = "rankingInternalAchievementCatalog"
HISTORY = "rankingInternalAchievementHistory"
OUTBOX = "rankingInternalAchievementOutbox"
ALLOWED = {"QA並替試験"+str(i) for i in range(1,8)} | {"QA通知試験140","QA自動付与試験117"}
def require(ok, msg):
    if not ok: raise RuntimeError(msg)
require(not os.environ.get("FIRESTORE_EMULATOR_HOST"), "Unexpected emulator environment")
token = subprocess.check_output(["gcloud","auth","print-access-token"], text=True).strip()
def request(path, body=None):
    req = urllib.request.Request(API+path, data=None if body is None else json.dumps(body,ensure_ascii=False).encode(),
        headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=60) as response: return json.load(response)
def sv(x): return {"stringValue":x}
def bv(x): return {"booleanValue":x}
def iv(x): return {"integerValue":str(x)}
def val(fields,k,typ="stringValue"): return fields.get(k,{}).get(typ)
def digest(*parts):
    return hashlib.sha256(json.dumps(parts,ensure_ascii=False,separators=(",",":")).encode()).hexdigest()
def active_qa(collection,field):
    query={"structuredQuery":{"from":[{"collectionId":collection}],"where":{"compositeFilter":{"op":"AND","filters":[{"fieldFilter":{"field":{"fieldPath":field},"op":op,"value":sv(v)}} for op,v in [("GREATER_THAN_OR_EQUAL","QA"),("LESS_THAN","QB")]]}}}}
    data=request(":runQuery",query)
    require(isinstance(data,list) and all("error" not in x for x in data),"Query error")
    return [x["document"] for x in data if "document" in x and val(x["document"]["fields"],"active","booleanValue") is True]
require(not active_qa(CATALOG,"name"),"Active QA definitions remain; stop")
records=active_qa(RECORDS,"content.name")
require(len(records)<=9,"Unexpected active QA record count")
names=set()
writes=[]
definitions={}
expected=[]
now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")
for doc in records:
    f=doc["fields"]; c=f["content"]["mapValue"]["fields"]
    name=val(c,"name"); uid=val(c,"teacherUid"); source=val(c,"source"); scope=val(c,"scope")
    require(name in ALLOWED and name not in names,"Unknown or duplicate QA record name")
    names.add(name)
    require(val(c,"category")=="badge" and uid and uid==val(f,"teacherUid") and scope==val(f,"scope"),"Record shape mismatch")
    if name=="QA自動付与試験117":
        rule=val(c,"ruleId")
        require(source=="automatic" and rule and val(c,"badgeId")==rule,"Unexpected automatic record")
        def_id="rule_"+rule
        record_id=digest("automatic",scope,"badge",rule,uid)
    else:
        badge=val(c,"badgeId")
        require(source=="manual" and scope=="manual" and badge,"Unexpected manual record")
        def_id="manual_"+badge
        record_id=digest("manual",badge,uid)
    require(doc["name"]==P+"/"+RECORDS+"/"+record_id,"Record ID mismatch")
    definition=request("/"+CATALOG+"/"+def_id)
    df=definition["fields"]
    require(val(df,"name")==name and val(df,"archived","booleanValue") is True and val(df,"active","booleanValue") is False,"Definition not archived")
    require(val(df,"type")==("rule" if source=="automatic" else "manual"),"Definition type mismatch")
    definitions[definition["name"]]=definition
    generation=int(val(f,"generation","integerValue"))
    require(generation>=1,"Unexpected generation")
    eid=digest(record_id,generation+1)
    history_name=P+"/"+HISTORY+"/"+eid
    outbox_name=P+"/"+OUTBOX+"/"+eid
    history={**c,"at":sv(now),"action":sv("revoked"),"actor":sv("system"),"trigger":sv("qa-cleanup-stage152"),"reason":sv("QA最終整理（試験データのみ）"),"eventId":sv(eid)}
    outbox={"eventId":sv(eid),"teacherUid":sv(uid),"category":sv("badge"),"name":sv(name),"kind":c["kind"],"key":c["key"],"rank":{"nullValue":None},"action":sv("revoked"),"at":sv(now),"status":sv("suppressed")}
    writes.extend([
        {"update":{"name":doc["name"],"fields":{"active":bv(False),"generation":iv(generation+1)}},"updateMask":{"fieldPaths":["active","generation"]},"currentDocument":{"updateTime":doc["updateTime"]}},
        {"update":{"name":history_name,"fields":history},"currentDocument":{"exists":False}},
        {"update":{"name":outbox_name,"fields":outbox},"currentDocument":{"exists":False}}])
    expected.append((doc["name"],history_name,outbox_name,generation+1,name))
for d in definitions.values():
    writes.append({"verify":d["name"],"currentDocument":{"updateTime":d["updateTime"]}})
os.umask(0o077)
backup=Path(tempfile.mkdtemp(prefix="shiftly-ranking-stage152.",dir=Path.home()))
(backup/"before.json").write_text(json.dumps({"records":records,"definitions":list(definitions.values()),"writes":writes},ensure_ascii=False,indent=2))
print("BACKUP:",backup,flush=True)
if writes:
    response=request(":commit",{"writes":writes})
    (backup/"commit.json").write_text(json.dumps(response,indent=2))
    require(len(response.get("writeResults",[]))==len(writes),"Commit result mismatch")
for rec,hist,out,gen,name in expected:
    f=request(rec[len(P):])["fields"]
    h=request(hist[len(P):])["fields"]
    o=request(out[len(P):])["fields"]
    require(val(f,"active","booleanValue") is False and int(val(f,"generation","integerValue"))==gen,"Record verification failed")
    require(val(h,"action")=="revoked" and val(o,"status")=="suppressed","Audit verification failed")
    print("PASS:",name)
require(not active_qa(RECORDS,"content.name") and not active_qa(CATALOG,"name"),"QA active records remain")
print("REVOKED:",len(records))
print("SUCCESS STAGE152 QA TEST ACHIEVEMENTS CLEANED")
