#!/usr/bin/env bash
# Export existing production data to its private production backup bucket. No application changes.
set -euo pipefail
umask 077
P=shiftly-d02f6
PN=85446950632
B=shiftly-85446950632-prod-firestore-20261124120039
I=( "$HOME"/shiftly-ranking-stage155.* )
test "${#I[@]}" -eq 1
(cd "${I[0]}"; sha256sum -c SHA256SUMS >/dev/null)
# Never automatically submit a second export after a prior submission.
for x in "$HOME"/shiftly-ranking-stage156.*/submission-started.txt; do
  if [ -e "$x" ]; then echo "REVIEW REQUIRED: EXISTING EXPORT SUBMISSION $x"; exit 1; fi
done
D=$(mktemp -d "$HOME/shiftly-ranking-stage156.XXXXXX")
echo "REPORT: $D"
AUTH="Authorization: Bearer $(gcloud auth print-access-token)"
api(){ curl -fsS --max-time 60 -H "$AUTH" "$1"; }
SAPI=https://storage.googleapis.com/storage/v1
api "$SAPI/b/$B" > "$D/bucket.json"
jq -e --arg b "$B" --arg pn "$PN" '.name==$b and (.projectNumber|tostring)==$pn and .location=="ASIA-NORTHEAST1" and .iamConfiguration.uniformBucketLevelAccess.enabled==true and .iamConfiguration.publicAccessPrevention=="enforced"' "$D/bucket.json" >/dev/null
api "$SAPI/b/$B/iam" > "$D/bucket-iam.json"
jq -e 'all(.bindings[]?.members[]?; .!="allUsers" and .!="allAuthenticatedUsers")' "$D/bucket-iam.json" >/dev/null
echo "PASS: PRIVATE PRODUCTION BACKUP BUCKET"
BASE=https://firestore.googleapis.com/v1
DB="projects/$P/databases/(default)"
api "$BASE/$DB" > "$D/database.json"
jq -e --arg db "$DB" '.name==$db and .locationId=="asia-northeast1" and .type=="FIRESTORE_NATIVE"' "$D/database.json" >/dev/null
PREFIX="ranking-preproduction-$(date -u +%Y%m%dT%H%M%SZ)-${D##*.}"
URI="gs://$B/$PREFIX"
printf '%s\n' "$URI" > "$D/output-uri.txt"
jq -n --arg uri "$URI" '{outputUriPrefix:$uri}' > "$D/request.json"
echo "EXPORT TARGET: $URI"
printf 'EXPORT SUBMISSION STARTED\n' > "$D/submission-started.txt"
curl -fsS --max-time 90 -H "$AUTH" -H 'Content-Type: application/json' -X POST --data-binary @"$D/request.json" "$BASE/$DB:exportDocuments" > "$D/operation.json"
OP=$(jq -er '.name' "$D/operation.json")
[[ "$OP" == "$DB"/operations/* ]]
echo "EXPORT OPERATION: $OP"
for ((i=0;i<120;i++)); do
  AUTH="Authorization: Bearer $(gcloud auth print-access-token)"
  api "$BASE/$OP" > "$D/operation-status.json"
  if jq -e '.done==true' "$D/operation-status.json" >/dev/null; then break; fi
  sleep 5
done
jq -e --arg uri "$URI" '.done==true and .error==null and .metadata.operationState=="SUCCESSFUL" and .response.outputUriPrefix==$uri' "$D/operation-status.json" >/dev/null
gcloud storage ls "$URI/$PREFIX.overall_export_metadata" --project="$P" --quiet > "$D/export-metadata-object.txt"
grep -Fx "$URI/$PREFIX.overall_export_metadata" "$D/export-metadata-object.txt" >/dev/null
echo "PASS: FIRESTORE EXPORT COMPLETED"
echo "PASS: EXPORT METADATA EXISTS"
echo "SUCCESS STAGE156 PRODUCTION FIRESTORE BACKUP"
