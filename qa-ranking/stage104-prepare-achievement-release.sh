#!/usr/bin/env bash
# Local preparation only: explicitly scoped reads from QA.
set -euo pipefail
umask 077
P=shiftly-t-test
R=asia-northeast1
S="$HOME/shiftly-ranking-stage98.fSZPZv/repo"
OLD="$HOME/shiftly-ranking-stage87.5eOIqj"
D=$(mktemp -d "$HOME/shiftly-ranking-stage104.XXXXXX")
test "$(git hash-object "$S/ranking-achievements.mjs")" = 80c48bf944a2fe1b20ff2e6955f98124cbfbf3eb
test "$(git hash-object "$S/ranking-achievement-store.mjs")" = 161fff0348368a97bc8cac5067f3a0700b99079b
echo "WORKDIR: $D"
API="https://cloudfunctions.googleapis.com/v2/projects/$P/locations/$R"
AUTH="Authorization: Bearer $(gcloud auth print-access-token)"
curl -fsS -H "$AUTH" "$API/functions?pageSize=1000" > "$D/functions-before.json"
jq -e '(.nextPageToken // "") == ""' "$D/functions-before.json" >/dev/null
gcloud scheduler jobs list --project="$P" --location="$R" --format=json > "$D/scheduler-before.json"
for F in qaRankingAchievementApi qaRankingProcessAchievements; do
  curl -fsS -H "$AUTH" "$API/functions/$F" > "$D/$F-config.json"
  jq -e --arg f "projects/$P/locations/$R/functions/$F" '.name == $f and .state == "ACTIVE" and .environment == "GEN_2"' "$D/$F-config.json" >/dev/null
  curl -fsS -H "$AUTH" "$API/functions/$F:getIamPolicy" > "$D/$F-function-iam.json"
  SERVICE=$(jq -er '.serviceConfig.service | split("/") | last' "$D/$F-config.json")
  gcloud run services get-iam-policy "$SERVICE" --project="$P" --region="$R" --format=json > "$D/$F-run-iam.json"
  SRC=$(jq -er '.buildConfig.sourceProvenance.resolvedStorageSource // .buildConfig.source.storageSource | "gs://"+.bucket+"/"+.object+"#"+(.generation|tostring)' "$D/$F-config.json")
  gcloud storage cp "$SRC" "$D/$F-rollback.zip"
  mkdir "$D/$F-old" "$D/$F-new" "$D/$F-stage87"
  unzip -oq "$D/$F-rollback.zip" -d "$D/$F-old"
  unzip -oq "$OLD/$F-deployed.zip" -d "$D/$F-stage87"
  diff -qr "$D/$F-old" "$D/$F-stage87"
  test "$(git hash-object "$D/$F-old/ranking-achievements.mjs")" = d9ddcc4903be6aa1e932ae94d7c3408188e487de
  test "$(git hash-object "$D/$F-old/ranking-achievement-store.mjs")" = 3fb449338daccd908de6da2566733d93702bf10a
  cp -a "$D/$F-old/." "$D/$F-new/"
  cp "$S/ranking-achievements.mjs" "$S/ranking-achievement-store.mjs" "$D/$F-new/"
  (cd "$D/$F-new"; node --check ranking-achievements.mjs; node --check ranking-achievement-store.mjs; zip -qr "$D/$F-candidate.zip" .)
  unzip -tq "$D/$F-candidate.zip"
  echo "PASS: CURRENT SOURCE, ROLLBACK AND CANDIDATE $F"
done
echo "SUCCESS STAGE104 QA RELEASE PREPARED"
