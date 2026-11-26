#!/usr/bin/env bash
# Read-only QA final regression and deployment-state verification.
set -euo pipefail
umask 077
P=shiftly-t-test
R=asia-northeast1
SHA=0ede550ade8e810eb619eb64ee8049a7763b35f8
D=$(mktemp -d "$HOME/shiftly-ranking-stage153.XXXXXX")
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
echo "REPORT: $D"
curl -fsSL --max-time 120 "https://codeload.github.com/Shiftly-t/class-time-table/tar.gz/$SHA" | tar -xz --strip-components=1 -C "$T"
cd "$T"
for f in tests/ranking-*.test.mjs; do
  echo "=== $f ==="
  timeout 120s node "$f"
done
echo "PASS: RANKING UNIT REGRESSIONS"
AUTH="Authorization: Bearer $(gcloud auth print-access-token)"
API="https://firestore.googleapis.com/v1/projects/$P/databases/shiftly-qa-v1/documents"
api(){ curl -fsS --max-time 60 -H "$AUTH" "$1"; }
query(){ curl -fsS --max-time 60 -H "$AUTH" -H 'Content-Type: application/json' -d "$1" "$API:runQuery"; }
api "$API/rankingInternalConfig/runtime" > "$D/runtime.json"
jq -e '.fields | (.trackingStart.stringValue=="2026-11-25") and ([.enabled,.automationEnabled,.publicationEnabled,.achievementsEnabled,.correctionIntegrationVerified,.achievementNotificationsEnabled,.notificationIntegrationVerified]|all(.booleanValue==true))' "$D/runtime.json" >/dev/null
for C in rankingInternalAchievementCatalog rankingInternalAchievements; do
  F=name
  [ "$C" != rankingInternalAchievements ] || F=content.name
  Q=$(jq -n --arg c "$C" --arg f "$F" '{structuredQuery:{from:[{collectionId:$c}],where:{compositeFilter:{op:"AND",filters:[{fieldFilter:{field:{fieldPath:$f},op:"GREATER_THAN_OR_EQUAL",value:{stringValue:"QA"}}},{fieldFilter:{field:{fieldPath:$f},op:"LESS_THAN",value:{stringValue:"QB"}}}]}}}}')
  query "$Q" | jq -e 'type=="array" and all(.[];.error==null and .document.fields.active.booleanValue!=true)' >/dev/null
done
echo "PASS: NO ACTIVE QA TEST BADGES OR DEFINITIONS"
for C in rankingInternalRefresh rankingInternalAchievementOutbox; do
  Q=$(jq -n --arg c "$C" '{structuredQuery:{from:[{collectionId:$c}],where:{fieldFilter:{field:{fieldPath:"status"},op:"EQUAL",value:{stringValue:"pending"}}}}}')
  N=$(query "$Q" | jq -er 'select(type=="array" and all(.[];.error==null))|[.[]|select(.document!=null)]|length')
  echo "$C pending: $N"
  test "$N" -eq 0
done
gcloud scheduler jobs list --project="$P" --location="$R" --format=json > "$D/scheduler.json"
jq -e 'def job($n;$s): [.[]|select((.name|endswith($n)) and .schedule==$s and .timeZone=="Asia/Tokyo" and .state=="ENABLED")]|length==1; job("qaRankingCaptureDaily-asia-northeast1";"55 23 * * *") and job("qaRankingFinalizeDaily-asia-northeast1";"10 0 * * *") and job("qaRankingProcessAchievements-asia-northeast1";"*/10 * * * *")' "$D/scheduler.json" >/dev/null
echo "PASS: QA RUNTIME AND SCHEDULER"
FAPI="https://cloudfunctions.googleapis.com/v2/projects/$P/locations/$R"
api "$FAPI/functions?pageSize=1000" > "$D/functions.json"
B=( "$HOME"/shiftly-ranking-stage130.*/stage131-functions-after.json )
test "${#B[@]}" -eq 1 && test -s "${B[0]}"
norm(){ jq -eS 'select((.nextPageToken // "")=="" and (.functions|length)==10 and all(.functions[];.state=="ACTIVE"))|[.functions[]|if .eventTrigger.eventFilters then .eventTrigger.eventFilters|=sort_by(.attribute,.operator,.value) else . end]|sort_by(.name)' "$1"; }
norm "${B[0]}" > "$D/functions-expected.json"
norm "$D/functions.json" > "$D/functions-current.json"
diff "$D/functions-expected.json" "$D/functions-current.json"
echo "PASS: TEN QA FUNCTIONS ACTIVE AND MATCHED"
H=( "$HOME"/shiftly-ranking-stage132.* )
test "${#H[@]}" -eq 1
H="${H[0]}"
HAPI=https://firebasehosting.googleapis.com/v1beta1
V=$(api "$HAPI/sites/$P/channels/live/releases?pageSize=1" | jq -er '.releases[0].version.name')
test "$V" = "$(jq -er '.releases[0].version.name' "$H/after-release.json")"
api "$HAPI/$V/files?pageSize=1000" > "$D/hosting-files.json"
manifest(){ jq -eS 'select((.nextPageToken // "")=="")|[.files[]|{path,hash}]|sort_by(.path)' "$1"; }
manifest "$H/after-files.json" > "$D/hosting-expected.json"
manifest "$D/hosting-files.json" > "$D/hosting-current.json"
diff "$D/hosting-expected.json" "$D/hosting-current.json"
for f in ranking-live.js ranking-live.css app.js index.html; do
  curl -fsSL --max-time 30 -H 'Cache-Control: no-cache' "https://$P.web.app/$f?stage153=$(date +%s%N)" -o "$T/live-check"
  cmp "$H/public/$f" "$T/live-check"
done
echo "PASS: QA HOSTING MATCHED"
echo "SUCCESS STAGE153 QA FINAL REGRESSION"
