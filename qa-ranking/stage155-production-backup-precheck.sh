#!/usr/bin/env bash
# Read-only production cloud access. Store private local rollback assets and inventory export destinations.
set -euo pipefail
umask 077
P=shiftly-d02f6
R=asia-northeast1
I=( "$HOME"/shiftly-ranking-stage154R.* )
test "${#I[@]}" -eq 1
I="${I[0]}"
test -s "$I/functions.json" && test -s "$I/hosting.json"
D=$(mktemp -d "$HOME/shiftly-ranking-stage155.XXXXXX")
echo "BACKUP: $D"
AUTH="Authorization: Bearer $(gcloud auth print-access-token)"
api(){ curl -fsS --max-time 60 -H "$AUTH" "$1"; }
FAPI="https://cloudfunctions.googleapis.com/v2/projects/$P/locations/$R"
api "$FAPI/functions?pageSize=1000" > "$D/functions.json"
norm(){ jq -eS 'select((.nextPageToken // "")=="" and (.functions|length)==5 and all(.functions[];.state=="ACTIVE"))|[.functions[]|if .eventTrigger.eventFilters then .eventTrigger.eventFilters|=sort_by(.attribute,.operator,.value) else . end]|sort_by(.name)' "$1"; }
norm "$I/functions.json" > "$D/functions-expected.json"
norm "$D/functions.json" > "$D/functions-current.json"
diff "$D/functions-expected.json" "$D/functions-current.json"
diff <(jq -r '.functions[].name|split("/")|last' "$D/functions.json"|sort) <(printf '%s\n' bookingPublicApi normalAuthorityApi bookingStudentDeleted bookingAdminApi seasonalAuthorityApi|sort)
for F in bookingPublicApi normalAuthorityApi bookingStudentDeleted bookingAdminApi seasonalAuthorityApi; do
  api "$FAPI/functions/$F" > "$D/$F-config.json"
  jq -e --arg name "projects/$P/locations/$R/functions/$F" '.name==$name and .state=="ACTIVE" and .environment=="GEN_2"' "$D/$F-config.json" >/dev/null
  api "$FAPI/functions/$F:getIamPolicy" > "$D/$F-function-iam.json"
  SERVICE=$(jq -er '.serviceConfig.service' "$D/$F-config.json")
  [[ "$SERVICE" == projects/$P/locations/$R/services/* ]]
  api "https://run.googleapis.com/v2/$SERVICE:getIamPolicy" > "$D/$F-run-iam.json"
  SRC=$(jq -er '.buildConfig.sourceProvenance.resolvedStorageSource // .buildConfig.source.storageSource | "gs://"+.bucket+"/"+.object+"#"+(.generation|tostring)' "$D/$F-config.json")
  gcloud storage cp "$SRC" "$D/$F-rollback.zip" --project="$P"
  unzip -tq "$D/$F-rollback.zip"
  echo "PASS: BACKUP $F"
done
HAPI=https://firebasehosting.googleapis.com/v1beta1
api "$HAPI/sites/shiftly-t/channels/live/releases?pageSize=1" > "$D/hosting-release.json"
V=$(jq -er '.releases[0].version.name' "$D/hosting-release.json")
test "$V" = "$(jq -er '.releases[0].version.name' "$I/hosting.json")"
[[ "$V" == sites/shiftly-t/versions/* ]]
api "$HAPI/$V" > "$D/hosting-version.json"
api "$HAPI/$V/files?pageSize=1000" > "$D/hosting-files.json"
jq -e '(.nextPageToken // "")=="" and (.files|length)>0' "$D/hosting-files.json" >/dev/null
echo "PASS: HOSTING ROLLBACK VERSION $V"
RULES=https://firebaserules.googleapis.com/v1
api "$RULES/projects/$P/releases?pageSize=100" > "$D/rules-releases.json"
jq -e '(.nextPageToken // "")=="" and any(.releases[]; .name|contains("/releases/cloud.firestore"))' "$D/rules-releases.json" >/dev/null
while IFS= read -r N; do
  [[ "$N" == projects/$P/rulesets/* ]]
  api "$RULES/$N" > "$D/ruleset-${N##*/}.json"
done < <(jq -r '.releases[].rulesetName' "$D/rules-releases.json"|sort -u)
echo "PASS: RULES RELEASES AND SOURCE SAVED"
cp "$I/databases.json" "$I/services.txt" "$D/"
api "https://storage.googleapis.com/storage/v1/b?project=$P&maxResults=1000" > "$D/buckets.json"
jq -e '(.nextPageToken // "")==""' "$D/buckets.json" >/dev/null
echo "=== FIRESTORE DATABASES ==="
jq -r '.[]|[.name,.locationId,.type]|@tsv' "$D/databases.json"
echo "=== EXISTING STORAGE BUCKETS ==="
jq -r '.items[]?|[.name,.location,.storageClass]|@tsv' "$D/buckets.json"
(cd "$D"; find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS; sha256sum -c SHA256SUMS >/dev/null)
echo "PASS: LOCAL BACKUP CHECKSUMS"
echo "SUCCESS STAGE155 PRODUCTION ROLLBACK ASSETS SAVED"
