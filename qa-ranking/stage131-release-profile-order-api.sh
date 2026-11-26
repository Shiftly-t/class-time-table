#!/usr/bin/env bash
# QA only, source-only update. Never rerun after a PATCH without reconciliation.
set -euo pipefail
umask 077
P=shiftly-t-test
R=asia-northeast1
A=( "$HOME"/shiftly-ranking-stage130.* )
test "${#A[@]}" = 1
D="${A[0]}"
test -d "$D"
cd "$D"
API="https://cloudfunctions.googleapis.com/v2/projects/$P/locations/$R"
AUTH="Authorization: Bearer $(gcloud auth print-access-token)"
FNS=(qaRankingAchievementApi)
read_api(){ curl -fsS --max-time 60 -H "$AUTH" "$1"; }
all_functions(){ read_api "$API/functions?pageSize=1000" | jq -e 'select((.nextPageToken // "") == "")'; }
other_functions(){ jq -eS 'select((.functions|length)==10) | [.functions[] | select((.name|split("/")|last) != "qaRankingAchievementApi") | if .eventTrigger.eventFilters then .eventTrigger.eventFilters |= sort_by(.attribute,.operator,.value) else . end] | sort_by(.name)'; }
scheduler(){ gcloud scheduler jobs list --project="$P" --location="$R" --format=json; }
sched_config(){ jq -S 'map(del(.lastAttemptTime,.scheduleTime,.status,.userUpdateTime)) | sort_by(.name)'; }
settings(){ jq -S 'del(.updateTime,.state,.stateMessages,.buildConfig.build,.buildConfig.source,.buildConfig.sourceProvenance,.serviceConfig.revision)'; }
iam(){ jq -S 'del(.etag) | if .bindings then .bindings |= (map(.members |= sort) | sort_by(.role, (.condition // {} | tostring))) else . end'; }
zipcheck(){ python3 - "$@" <<'PY'
import sys, zipfile, hashlib
def files(p):
    with zipfile.ZipFile(p) as z:
        names=[x.filename for x in z.infolist() if not x.is_dir()]
        assert len(names)==len(set(names))
        return {n:z.read(n) for n in names}
def gitsha(b):
    return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
a,b=map(files,sys.argv[1:3])
assert a.keys()==b.keys()
expected={'ranking-achievement-store.mjs':'e723961d3aa9fb99d43864354a2fe5d688e33a63'}
if len(sys.argv)==4:
    assert {n for n in a if a[n]!=b[n]}==set(expected)
    assert all(gitsha(b[n])==h for n,h in expected.items())
else:
    assert a==b
PY
}
# Refuse partial deployment or reuse.
for F in "${FNS[@]}"; do test ! -e "$F-stage131-operation.json"; done
all_functions > stage131-functions-pre.json
other_functions < functions-before.json > stage131-other-before.json
other_functions < stage131-functions-pre.json > stage131-other-pre.json
diff stage131-other-before.json stage131-other-pre.json
scheduler > stage131-scheduler-pre.json
diff <(sched_config < scheduler-before.json) <(sched_config < stage131-scheduler-pre.json)
jq -e 'any(.[]; (.name|endswith("qaRankingProcessAchievements-asia-northeast1")) and .state=="ENABLED")' stage131-scheduler-pre.json >/dev/null
for F in "${FNS[@]}"; do
  zipcheck "$F-rollback.zip" "$F-candidate.zip" changed
  read_api "$API/functions/$F" > "$F-stage131-pre.json"
  diff <(jq -S . "$F-config.json") <(jq -S . "$F-stage131-pre.json")
  SERVICE=$(jq -er '.serviceConfig.service | split("/") | last' "$F-config.json")
  read_api "$API/functions/$F:getIamPolicy" > "$F-stage131-function-iam-pre.json"
  gcloud run services get-iam-policy "$SERVICE" --project="$P" --region="$R" --format=json > "$F-stage131-run-iam-pre.json"
  for K in function run; do diff <(iam < "$F-$K-iam.json") <(iam < "$F-stage131-$K-iam-pre.json"); done
  echo "PASS: PRECHECK $F"
done
# Deploy only the callable API. The processor and its scheduler remain untouched.
for F in "${FNS[@]}"; do
  # Require the target still equals the preflight version.
  diff <(jq -S . "$F-stage131-pre.json") <(read_api "$API/functions/$F" | jq -S .)
  U=$(curl -fsS --max-time 60 -H "$AUTH" -H 'Content-Type: application/json' -X POST -d '{"environment":"GEN_2"}' "$API/functions:generateUploadUrl")
  URL=$(jq -er '.uploadUrl' <<< "$U")
  curl -fsS --max-time 180 -X PUT -H 'Content-Type: application/zip' --upload-file "$F-candidate.zip" "$URL" >/dev/null
  jq -n --arg name "projects/$P/locations/$R/functions/$F" --argjson u "$U" '{name:$name,buildConfig:{source:{storageSource:$u.storageSource}}}' > "$F-stage131-patch.json"
  # Mark before submitting: even a lost HTTP response must not trigger an automatic retry.
  printf 'PATCH SUBMISSION STARTED\n' > "$F-stage131-operation.json"
  curl -fsS --max-time 90 -H "$AUTH" -H 'Content-Type: application/json' -X PATCH --data-binary @"$F-stage131-patch.json" "$API/functions/$F?updateMask=buildConfig.source" > "$F-stage131-operation-response.json"
  mv "$F-stage131-operation-response.json" "$F-stage131-operation.json"
  OP=$(jq -er '.name' "$F-stage131-operation.json")
  echo "DEPLOYMENT STARTED: $F"
  for ((i=0;i<120;i++)); do
    AUTH="Authorization: Bearer $(gcloud auth print-access-token)"
    read_api "https://cloudfunctions.googleapis.com/v2/$OP" > "$F-stage131-operation-status.json"
    if jq -e '.done == true' "$F-stage131-operation-status.json" >/dev/null; then break; fi
    sleep 5
  done
  jq -e '.done == true and (.error == null)' "$F-stage131-operation-status.json" >/dev/null
  read_api "$API/functions/$F" > "$F-stage131-after.json"
  jq -e '.state=="ACTIVE"' "$F-stage131-after.json" >/dev/null
  diff <(settings < "$F-config.json") <(settings < "$F-stage131-after.json")
  SERVICE=$(jq -er '.serviceConfig.service | split("/") | last' "$F-stage131-after.json")
  read_api "$API/functions/$F:getIamPolicy" > "$F-stage131-function-iam-after.json"
  gcloud run services get-iam-policy "$SERVICE" --project="$P" --region="$R" --format=json > "$F-stage131-run-iam-after.json"
  for K in function run; do diff <(iam < "$F-$K-iam.json") <(iam < "$F-stage131-$K-iam-after.json"); done
  SRC=$(jq -er '.buildConfig.sourceProvenance.resolvedStorageSource // .buildConfig.source.storageSource | "gs://"+.bucket+"/"+.object+"#"+(.generation|tostring)' "$F-stage131-after.json")
  gcloud storage cp "$SRC" "$F-stage131-deployed.zip"
  zipcheck "$F-candidate.zip" "$F-stage131-deployed.zip"
  echo "PASS: ACTIVE, CONFIG, IAM AND DEPLOYED SOURCE $F"
done
all_functions > stage131-functions-after.json
other_functions < stage131-functions-after.json > stage131-other-after.json
diff stage131-other-before.json stage131-other-after.json
scheduler > stage131-scheduler-after.json
diff <(sched_config < scheduler-before.json) <(sched_config < stage131-scheduler-after.json)
echo "PASS: OTHER FUNCTIONS AND SCHEDULER PRESERVED"
echo "SUCCESS STAGE131 PROFILE ORDER QA API RELEASE"
