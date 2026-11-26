#!/usr/bin/env bash
# Approved production rollout: validate local assets, add scoped runtime IAM,
# publish tested Rules, then create five PRIVATE HTTP functions. No Scheduler jobs,
# runtime enablement, existing function updates, Hosting deployment or main changes.
set -euo pipefail
umask 077
P=shiftly-d02f6
R=asia-northeast1
SA=shiftly-ranking-runtime@$P.iam.gserviceaccount.com
ROOT="$HOME"
one(){ local a=("$ROOT"/$1); test "${#a[@]}" -eq 1 && test -d "${a[0]}"; printf '%s\n' "${a[0]}"; }
B=$(one 'shiftly-ranking-stage155.*')
E=$(one 'shiftly-ranking-stage156.*')
Q=$(one 'shiftly-ranking-stage153.*')
C=$(one 'shiftly-ranking-stage163.*')
RULE=$(one 'shiftly-ranking-stage165.*')
H=$(one 'shiftly-ranking-stage166.*')
I=$(one 'shiftly-ranking-stage167.*')
for x in "$ROOT"/shiftly-ranking-stage168.*/MUTATION_STARTED; do
  if [ -e "$x" ]; then echo "REVIEW REQUIRED: prior mutation $x"; exit 1; fi
done
D=$(mktemp -d "$ROOT/shiftly-ranking-stage168.XXXXXX")
echo "REPORT: $D"
(cd "$B"; sha256sum -c SHA256SUMS >/dev/null)
jq -e '.done==true and .error==null and .metadata.operationState=="SUCCESSFUL"' "$E/operation-status.json" >/dev/null
grep -Fxq cloudscheduler.googleapis.com "$I/services-after.txt"
api(){ curl -fsS --max-time 60 -H "Authorization: Bearer $(gcloud auth print-access-token)" "$@"; }
G=https://cloudfunctions.googleapis.com/v2
FAPI="$G/projects/$P/locations/$R"
RULEAPI="https://firebaserules.googleapis.com/v1"
FR="projects/$P/releases/cloud.firestore"
DB="https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents"
norm(){ jq -eS 'select((.nextPageToken // "")=="" and (.functions|length)==5 and all(.functions[];.state=="ACTIVE"))|[.functions[]|if .eventTrigger.eventFilters then .eventTrigger.eventFilters|=sort_by(.attribute,.operator,.value) else . end]|sort_by(.name)' "$1"; }
api "$FAPI/functions?pageSize=1000" > "$D/functions-before.json"
diff <(norm "$B/functions.json") <(norm "$D/functions-before.json")
api "$RULEAPI/$FR" > "$D/rules-before.json"
test "$(jq -er '.rulesetName' "$D/rules-before.json")" = "$(jq -er --arg n "$FR" '.releases[]|select(.name==$n)|.rulesetName' "$B/rules-releases.json")"
api "https://firebasehosting.googleapis.com/v1beta1/sites/shiftly-t/channels/live/releases?pageSize=1" > "$D/hosting-before.json"
test "$(jq -er '.releases[0].version.name' "$D/hosting-before.json")" = "$(jq -er '.releases[0].version.name' "$B/hosting-release.json")"
code=$(curl -sS --max-time 60 -o "$D/runtime-before.json" -w '%{http_code}' -H "Authorization: Bearer $(gcloud auth print-access-token)" "$DB/rankingInternalConfig/runtime")
test "$code" = 404
gcloud scheduler jobs list --project="$P" --location="$R" --format=json > "$D/scheduler-before.json"
jq -e 'length==0' "$D/scheduler-before.json" >/dev/null
gcloud iam service-accounts list --project="$P" --format=json > "$D/accounts-before.json"
jq -e --arg sa "$SA" 'all(.[];.email!=$sa)' "$D/accounts-before.json" >/dev/null
gcloud projects get-iam-policy "$P" --format=json > "$D/iam-before.json"
jq -e --arg m "serviceAccount:$SA" 'all(.bindings[]?.members[]?;. != $m)' "$D/iam-before.json" >/dev/null
python3 - "$B" "$Q" "$C" "$RULE" "$H" "$D" "$SA" <<'PY'
import hashlib,json,sys
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
b,q,c,r,h,d=map(Path,sys.argv[1:7]); sa=sys.argv[7]
def require(v,m):
    if not v: raise RuntimeError(m)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def check(root,manifest):
    actual={x.relative_to(root).as_posix():sha(x) for x in root.rglob("*") if x.is_file()}
    require(actual==manifest,"Candidate manifest mismatch: "+root.name)
hr=json.loads((h/"candidate-report.json").read_text())
check(h/"public",hr["files"])
require(hr["baseline"]=="7820726eff314ed693e0c76d331093ea1f4e049b","Hosting baseline mismatch")
releases=json.loads((b/"rules-releases.json").read_text())["releases"]
rs=[x["rulesetName"] for x in releases if x["name"]=="projects/shiftly-d02f6/releases/cloud.firestore"]
require(len(rs)==1,"Missing rules backup")
files=json.loads((b/("ruleset-"+rs[0].split("/")[-1]+".json")).read_text())["source"]["files"]
require(len(files)==1 and files[0]["content"]==(r/"before.rules").read_text(),"Rules backup mismatch")
base=(r/"before.rules").read_text()
rules=(r/"firestore.rules").read_text()
import re
anchor=list(re.finditer(r"match\s+/databases/\{\w+\}/documents\s*\{",base))
require(len(anchor)==1,"Rules insertion anchor")
names=["rankingInternalConfig","rankingInternalSnapshots","rankingInternalDays","rankingInternalOperations","rankingInternalAudit","rankingInternalRefresh","rankingInternalAchievementCatalog","rankingInternalAchievements","rankingInternalAchievementHistory","rankingInternalAchievementOutbox"]
patch="\n"+''.join(f"\n    match /{n}/{{document=**}} {{\n      allow read, write: if false;\n    }}\n" for n in names)
i=anchor[0].end()
require(rules==base[:i]+patch+base[i:],"Rules change scope mismatch")
(d/"firestore.rules").write_text(rules)
report=json.loads((c/"candidate-report.json").read_text())
suffixes=["ReadApi","AchievementApi","CaptureDaily","FinalizeDaily","ProcessAchievements"]
require(set(report)=={"ranking"+x for x in suffixes},"Function set mismatch")
qa=json.loads((q/"functions.json").read_text())["functions"]
for suffix in suffixes:
    name="ranking"+suffix; info=report[name]; src=c/name
    check(src,info["files"])
    require(info["runtime"]=="nodejs22" and info["entryPoint"]==name,"Entry mismatch")
    f=[x for x in qa if x["name"]=="projects/shiftly-t-test/locations/asia-northeast1/functions/qaRanking"+suffix]
    require(len(f)==1 and f[0]["state"]=="ACTIVE" and not f[0].get("eventTrigger"),"QA HTTP function mismatch")
    f=f[0]; cfg=f["serviceConfig"]
    require(not cfg.get("secretEnvironmentVariables") and not cfg.get("secretVolumes") and not cfg.get("vpcConnector"),"Unexpected secret or network configuration")
    # Copy only known resource settings. No QA service accounts or secrets.
    keep=("timeoutSeconds","availableMemory","availableCpu","maxInstanceCount","minInstanceCount","maxInstanceRequestConcurrency","ingressSettings")
    sc={k:cfg[k] for k in keep if k in cfg}
    require(sc.get("ingressSettings","ALLOW_ALL")=="ALLOW_ALL","Unexpected ingress")
    sc.update(serviceAccountEmail=sa,allTrafficOnLatestRevision=True)
    # Explicit project identity, as in the Firebase deployment environment.
    sc["environmentVariables"]={"GCLOUD_PROJECT":"shiftly-d02f6","FIREBASE_CONFIG":json.dumps({"projectId":"shiftly-d02f6"},separators=(",",":"))}
    bc={"runtime":"nodejs22","entryPoint":name}
    be=f["buildConfig"].get("environmentVariables",{})
    require(set(be)<= {"GOOGLE_NODE_RUN_SCRIPTS"},"Unexpected QA build environment")
    if be: bc["environmentVariables"]=be
    payload={"name":"projects/shiftly-d02f6/locations/asia-northeast1/functions/"+name,"environment":"GEN_2","buildConfig":bc,"serviceConfig":sc}
    (d/(name+"-create-base.json")).write_text(json.dumps(payload))
    with ZipFile(d/(name+"-candidate.zip"),"w",ZIP_DEFLATED) as z:
        for n in sorted(info["files"]):
            z.write(src/n,n)
print("PASS: LOCAL CANDIDATE MANIFESTS, RULES SCOPE, DEPLOY SETTINGS")
PY
# Repeat the Rules test locally before touching production (165 was user-reported).
cp "$RULE/test.cjs" "$D/test.cjs"
cmp "$RULE/firestore.rules" "$D/firestore.rules"
printf '%s\n' '{"firestore":{"rules":"firestore.rules"},"emulators":{"firestore":{"host":"127.0.0.1","port":8787},"ui":{"enabled":false}}}' > "$D/firebase.json"
cd "$D"
timeout 300s firebase emulators:exec --only firestore --project demo-shiftly-ranking-stage165 --config "$D/firebase.json" 'timeout 180s node test.cjs firestore.rules' | tee rules-test.log
grep -Fq 'SUCCESS RANKING EMULATOR RULES (250 client denials on (default))' rules-test.log
grep -Fq 'SUCCESS RANKING EMULATOR NOTIFICATION RULES' rules-test.log
echo "PASS: PRODUCTION RULES REGRESSION"
# Recheck release and function baseline before first mutation.
api "$RULEAPI/$FR" > rules-pre-mutation.json
test "$(jq -er '.rulesetName' rules-pre-mutation.json)" = "$(jq -er '.rulesetName' rules-before.json)"
api "$FAPI/functions?pageSize=1000" > functions-pre-mutation.json
diff <(norm functions-before.json) <(norm functions-pre-mutation.json)
touch MUTATION_STARTED
gcloud iam service-accounts create shiftly-ranking-runtime --display-name="Shiftly ranking runtime" --project="$P" --quiet
gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SA" --role=roles/datastore.user --condition='expression=resource.name=="projects/shiftly-d02f6/databases/(default)",title=ShiftlyRankingProductionOnly,description=Production Firestore database only' --quiet > iam-binding-result.txt
gcloud projects get-iam-policy "$P" --format=json > iam-after.json
jq -e --arg m "serviceAccount:$SA" '[.bindings[]|select(.members|index($m))]|length==1 and .[0].role=="roles/datastore.user" and .[0].condition.expression=="resource.name==\"projects/shiftly-d02f6/databases/(default)\""' iam-after.json >/dev/null
echo "PASS: SCOPED RUNTIME IAM"
# Publish ONLY Firestore Rules. Do not touch indexes, functions or Hosting.
firebase deploy --only firestore:rules --project "$P" --config "$D/firebase.json" --non-interactive
api "$RULEAPI/$FR" > rules-after.json
RS=$(jq -er '.rulesetName' rules-after.json)
[[ "$RS" == projects/$P/rulesets/* ]]
api "$RULEAPI/$RS" > ruleset-after.json
python3 - <<'PY'
import json
from pathlib import Path
a=json.loads(Path("ruleset-after.json").read_text())["source"]["files"]
assert len(a)==1 and a[0]["content"]==Path("firestore.rules").read_text()
PY
echo "PASS: PRODUCTION RULES DEPLOYED AND VERIFIED"
for F in rankingReadApi rankingAchievementApi rankingCaptureDaily rankingFinalizeDaily rankingProcessAchievements; do
  U=$(api -H 'Content-Type: application/json' -X POST -d '{"environment":"GEN_2"}' "$FAPI/functions:generateUploadUrl")
  URL=$(jq -er '.uploadUrl' <<< "$U")
  curl -fsS --max-time 180 -X PUT -H 'Content-Type: application/zip' --upload-file "$F-candidate.zip" "$URL" >/dev/null
  jq --argjson u "$U" '.buildConfig.source={storageSource:$u.storageSource}' "$F-create-base.json" > "$F-create.json"
  printf 'CREATE SUBMISSION STARTED\n' > "$F-submission.txt"
  api -H 'Content-Type: application/json' -X POST --data-binary @"$F-create.json" "$FAPI/functions?functionId=$F" > "$F-operation.json"
  OP=$(jq -er '.name' "$F-operation.json")
  [[ "$OP" == projects/$P/locations/$R/operations/* ]]
  echo "DEPLOYMENT STARTED: $F"
  for ((i=0;i<180;i++)); do
    api "$G/$OP" > "$F-operation-status.json"
    if jq -e '.done==true' "$F-operation-status.json" >/dev/null; then break; fi
    sleep 5
  done
  jq -e '.done==true and .error==null' "$F-operation-status.json" >/dev/null
  api "$FAPI/functions/$F" > "$F-after.json"
  jq -e --arg f "$F" --arg sa "$SA" '.state=="ACTIVE" and .environment=="GEN_2" and .buildConfig.entryPoint==$f and .buildConfig.runtime=="nodejs22" and .serviceConfig.serviceAccountEmail==$sa and .eventTrigger==null and .serviceConfig.environmentVariables.GCLOUD_PROJECT=="shiftly-d02f6"' "$F-after.json" >/dev/null
  S=$(jq -er '.serviceConfig.service' "$F-after.json")
  [[ "$S" == projects/$P/locations/$R/services/* ]]
  api "https://run.googleapis.com/v2/$S" > "$F-run.json"
  jq -e '(.invokerIamDisabled // false)==false' "$F-run.json" >/dev/null
  api "https://run.googleapis.com/v2/$S:getIamPolicy" > "$F-run-iam.json"
  api "$FAPI/functions/$F:getIamPolicy" > "$F-function-iam.json"
  for K in run function; do
    jq -e 'all(.bindings[]?.members[]?;.!="allUsers" and .!="allAuthenticatedUsers")' "$F-$K-iam.json" >/dev/null
  done
  # An unauthenticated request must be rejected before reaching the function.
  URI=$(jq -er '.serviceConfig.uri' "$F-after.json")
  status=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"data":{}}' "$URI")
  [[ "$status" == 401 || "$status" == 403 ]]
  SRC=$(jq -er '.buildConfig.sourceProvenance.resolvedStorageSource // .buildConfig.source.storageSource | "gs://"+.bucket+"/"+.object+"#"+(.generation|tostring)' "$F-after.json")
  [[ "$SRC" == gs://gcf-v2-sources-85446950632-asia-northeast1/* ]]
  gcloud storage cp "$SRC" "$F-deployed.zip" --project="$P" --quiet
  python3 - "$F-candidate.zip" "$F-deployed.zip" <<'PY'
import sys
from zipfile import ZipFile
def files(path):
    with ZipFile(path) as z:
        ns=[i.filename for i in z.infolist() if not i.is_dir()]
        assert len(ns)==len(set(ns))
        return {n:z.read(n) for n in ns}
assert files(sys.argv[1])==files(sys.argv[2]),"Deployed source differs"
PY
  echo "PASS: ACTIVE, PRIVATE, IAM, SOURCE $F"
done
api "$FAPI/functions?pageSize=1000" > functions-after.json
jq -e '(.nextPageToken // "")=="" and (.functions|length)==10 and all(.functions[];.state=="ACTIVE")' functions-after.json >/dev/null
jq -S '{functions:[.functions[]|select((.name|split("/")|last|startswith("ranking"))|not)]}' functions-after.json > existing-after.json
diff <(norm functions-before.json) <(norm existing-after.json)
gcloud scheduler jobs list --project="$P" --location="$R" --format=json > scheduler-after.json
jq -e 'length==0' scheduler-after.json >/dev/null
code=$(curl -sS --max-time 60 -o runtime-after.json -w '%{http_code}' -H "Authorization: Bearer $(gcloud auth print-access-token)" "$DB/rankingInternalConfig/runtime")
test "$code" = 404
echo "PASS: FIVE EXISTING FUNCTIONS PRESERVED; SCHEDULER AND PUBLICATION NOT ENABLED"
echo "SUCCESS STAGE168 PRODUCTION RANKING PRIVATE RELEASE"
