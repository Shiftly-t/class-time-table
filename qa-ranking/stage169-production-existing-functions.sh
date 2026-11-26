#!/usr/bin/env bash
# Approved production source-only update. No IAM, Rules, Scheduler, Hosting or main mutations.
set -euo pipefail
umask 077
P=shiftly-d02f6
R=asia-northeast1
one(){ local a=("$HOME"/$1); test "${#a[@]}" -eq 1 && test -d "${a[0]}"; printf '%s\n' "${a[0]}"; }
B=$(one 'shiftly-ranking-stage155.*')
A=$(one 'shiftly-ranking-stage159.*')
Q=$(one 'shiftly-ranking-stage157.*')
N=$(one 'shiftly-ranking-stage168.*')
H=$(one 'shiftly-ranking-stage166.*')
for x in "$HOME"/shiftly-ranking-stage169.*/MUTATION_STARTED; do
  if [ -e "$x" ]; then echo "REVIEW REQUIRED: prior mutation $x"; exit 1; fi
done
D=$(mktemp -d "$HOME/shiftly-ranking-stage169.XXXXXX")
echo "REPORT: $D"
(cd "$B"; sha256sum -c SHA256SUMS >/dev/null)
api(){ curl -fsS --max-time 90 -H "Authorization: Bearer $(gcloud auth print-access-token)" "$@"; }
G=https://cloudfunctions.googleapis.com/v2
FAPI="$G/projects/$P/locations/$R"
DB="https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents"
FNS=(bookingPublicApi bookingStudentDeleted bookingAdminApi seasonalAuthorityApi normalAuthorityApi)
norm(){ jq -eS 'select((.nextPageToken // "")=="" and (.functions|length)==10 and all(.functions[];.state=="ACTIVE"))|[.functions[]|if .eventTrigger.eventFilters then .eventTrigger.eventFilters|=sort_by(.attribute,.operator,.value) else . end]|sort_by(.name)' "$1"; }
settings(){ jq -S 'del(.updateTime,.state,.stateMessages,.buildConfig.build,.buildConfig.source,.buildConfig.sourceProvenance,.serviceConfig.revision)|if .eventTrigger.eventFilters then .eventTrigger.eventFilters|=sort_by(.attribute,.operator,.value) else . end' "$1"; }
iam(){ jq -S 'del(.etag)|if .bindings then .bindings|=(map(.members|=sort)|sort_by(.role,(.condition//{}|tostring))) else . end' "$1"; }
api "$FAPI/functions?pageSize=1000" > "$D/functions-before.json"
norm "$N/functions-after.json" > "$D/expected.json"
norm "$D/functions-before.json" > "$D/actual.json"
diff "$D/expected.json" "$D/actual.json"
api "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore" > "$D/rules-before.json"
test "$(jq -er .rulesetName "$D/rules-before.json")" = "$(jq -er .rulesetName "$N/rules-after.json")"
api "https://firebasehosting.googleapis.com/v1beta1/sites/shiftly-t/channels/live/releases?pageSize=1" > "$D/hosting-before.json"
test "$(jq -er '.releases[0].version.name' "$D/hosting-before.json")" = "$(jq -er '.releases[0].version.name' "$B/hosting-release.json")"
gcloud scheduler jobs list --project="$P" --location="$R" --format=json > "$D/scheduler-before.json"
jq -e 'length==0' "$D/scheduler-before.json" >/dev/null
code=$(curl -sS --max-time 60 -o "$D/runtime-before.json" -w '%{http_code}' -H "Authorization: Bearer $(gcloud auth print-access-token)" "$DB/rankingInternalConfig/runtime")
test "$code" = 404
# Reconstruct expected candidates from immutable local archives, not from arbitrary directory contents.
python3 - "$B" "$A" "$Q" "$H" "$D" <<'PY'
import hashlib,json,re,stat,sys
from pathlib import Path,PurePosixPath
from zipfile import ZipFile,ZIP_DEFLATED
b,a,q,h,d=map(Path,sys.argv[1:])
def archive(p):
    with ZipFile(p) as z:
        files={}
        for i in z.infolist():
            if i.is_dir(): continue
            n=i.filename
            assert not PurePosixPath(n).is_absolute() and '..' not in PurePosixPath(n).parts and n not in files and not stat.S_ISLNK(i.external_attr>>16)
            files[n]=z.read(i)
        return files
def sha(x): return hashlib.sha256(x).hexdigest()
hr=json.loads((h/'candidate-report.json').read_text())
assert hr['baseline']=='7820726eff314ed693e0c76d331093ea1f4e049b'
assert {f.relative_to(h/'public').as_posix():sha(f.read_bytes()) for f in (h/'public').rglob('*') if f.is_file()}==hr['files']
targets={'normalAuthorityApi':{'booking-graph.cjs','stage2-bridge.cjs','seasonal-operations.cjs'},'seasonalAuthorityApi':{'booking-graph.cjs','stage2-bridge.cjs','seasonal-operations.cjs'},'bookingAdminApi':{'booking-graph.cjs','stage2-bridge.cjs'},'bookingPublicApi':{'booking-graph.cjs'},'bookingStudentDeleted':{'booking-graph.cjs'}}
for name,allowed in targets.items():
    prod=archive(b/(name+'-rollback.zip'))
    qa='qa'+name[0].upper()+name[1:]
    source=(q/'qa' if len(allowed)>1 else a)/(qa+'.zip')
    test=archive(source)
    expected=dict(prod)
    for n in allowed: expected[n]=test[n]
    if len(allowed)>1:
        for n in test.keys()-prod.keys():
            assert re.fullmatch(r'ranking-[a-z-]+\.(cjs|mjs)',n)
            if n in {'ranking-entry.cjs','ranking-scheduler.mjs'}: continue
            expected[n]=test[n].replace(b"'shiftly-t-test'",b"'shiftly-d02f6'").replace(b"'shiftly-qa-v1'",b"'(default)'")
    root=a/name
    actual={f.relative_to(root).as_posix():f.read_bytes() for f in root.rglob('*') if f.is_file()}
    assert actual==expected,'Candidate mismatch '+name
    assert actual['index.js']==prod['index.js']
    for n in actual.keys()-prod.keys()|allowed:
        assert all(x not in actual[n] for x in (b'shiftly-t-test',b'shiftly-qa-v1',b'qa-shiftly-runtime@')), 'QA target remains '+name+'/'+n
    with ZipFile(d/(name+'-candidate.zip'),'w',ZIP_DEFLATED) as z:
        for n in sorted(actual): z.write(root/n,n)
    print('PASS: VERIFIED CANDIDATE',name,flush=True)
PY
cd "$D"
for F in "${FNS[@]}"; do
  api "$FAPI/functions/$F" > "$F-pre.json"
  diff <(settings "$B/$F-config.json") <(settings "$F-pre.json")
  diff <(jq -S '.buildConfig.sourceProvenance' "$B/$F-config.json") <(jq -S '.buildConfig.sourceProvenance' "$F-pre.json")
  S=$(jq -er '.serviceConfig.service' "$F-pre.json")
  [[ "$S" == projects/$P/locations/$R/services/* ]]
  api "$FAPI/functions/$F:getIamPolicy" > "$F-function-iam-pre.json"
  api "https://run.googleapis.com/v2/$S:getIamPolicy" > "$F-run-iam-pre.json"
  for K in function run; do diff <(iam "$B/$F-$K-iam.json") <(iam "$F-$K-iam-pre.json"); done
  echo "PASS: PRECHECK $F"
done
touch MUTATION_STARTED
for F in "${FNS[@]}"; do
  api "$FAPI/functions/$F" > "$F-current.json"
  diff <(jq -S . "$F-pre.json") <(jq -S . "$F-current.json")
  U=$(api -H 'Content-Type: application/json' -X POST -d '{"environment":"GEN_2"}' "$FAPI/functions:generateUploadUrl")
  URL=$(jq -er .uploadUrl <<< "$U")
  curl -fsS --max-time 180 -X PUT -H 'Content-Type: application/zip' --upload-file "$F-candidate.zip" "$URL" >/dev/null
  jq -n --arg name "projects/$P/locations/$R/functions/$F" --argjson u "$U" '{name:$name,buildConfig:{source:{storageSource:$u.storageSource}}}' > "$F-patch.json"
  touch "$F-submission-started"
  api -H 'Content-Type: application/json' -X PATCH --data-binary @"$F-patch.json" "$FAPI/functions/$F?updateMask=buildConfig.source" > "$F-operation.json"
  OP=$(jq -er .name "$F-operation.json")
  [[ "$OP" == projects/$P/locations/$R/operations/* ]]
  echo "DEPLOYMENT STARTED: $F"
  for ((i=0;i<180;i++)); do
    api "$G/$OP" > "$F-operation-status.json"
    if jq -e '.done==true' "$F-operation-status.json" >/dev/null; then break; fi
    sleep 5
  done
  jq -e '.done==true and .error==null' "$F-operation-status.json" >/dev/null
  api "$FAPI/functions/$F" > "$F-after.json"
  jq -e '.state=="ACTIVE"' "$F-after.json" >/dev/null
  diff <(settings "$F-pre.json") <(settings "$F-after.json")
  S=$(jq -er '.serviceConfig.service' "$F-after.json")
  api "$FAPI/functions/$F:getIamPolicy" > "$F-function-iam-after.json"
  api "https://run.googleapis.com/v2/$S:getIamPolicy" > "$F-run-iam-after.json"
  for K in function run; do diff <(iam "$F-$K-iam-pre.json") <(iam "$F-$K-iam-after.json"); done
  SRC=$(jq -er '.buildConfig.sourceProvenance.resolvedStorageSource // .buildConfig.source.storageSource | "gs://"+.bucket+"/"+.object+"#"+(.generation|tostring)' "$F-after.json")
  [[ "$SRC" == gs://gcf-v2-sources-85446950632-asia-northeast1/* ]]
  gcloud storage cp "$SRC" "$F-deployed.zip" --project="$P" --quiet
  python3 - "$F-candidate.zip" "$F-deployed.zip" <<'PY'
import sys
from zipfile import ZipFile
def files(p):
    with ZipFile(p) as z:
        ns=[i.filename for i in z.infolist() if not i.is_dir()]
        assert len(ns)==len(set(ns))
        return {n:z.read(n) for n in ns}
assert files(sys.argv[1])==files(sys.argv[2])
PY
  echo "PASS: ACTIVE, CONFIG, IAM AND SOURCE $F"
done
api "$FAPI/functions?pageSize=1000" > functions-after.json
norm functions-after.json > normalized-after.json
diff <(jq -S '[.[]|select(.name|split("/")|last|startswith("ranking"))]' expected.json) <(jq -S '[.[]|select(.name|split("/")|last|startswith("ranking"))]' normalized-after.json)
gcloud scheduler jobs list --project="$P" --location="$R" --format=json > scheduler-after.json
jq -e 'length==0' scheduler-after.json >/dev/null
code=$(curl -sS --max-time 60 -o runtime-after.json -w '%{http_code}' -H "Authorization: Bearer $(gcloud auth print-access-token)" "$DB/rankingInternalConfig/runtime")
test "$code" = 404
api "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore" > rules-after.json
test "$(jq -er .rulesetName rules-after.json)" = "$(jq -er .rulesetName rules-before.json)"
api "https://firebasehosting.googleapis.com/v1beta1/sites/shiftly-t/channels/live/releases?pageSize=1" > hosting-after.json
test "$(jq -er '.releases[0].version.name' hosting-after.json)" = "$(jq -er '.releases[0].version.name' hosting-before.json)"
echo "PASS: TEN FUNCTIONS ACTIVE; RANKING PRIVATE; RULES AND HOSTING PRESERVED"
echo "SUCCESS STAGE169 PRODUCTION EXISTING FUNCTIONS RELEASE"
