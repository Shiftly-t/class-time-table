#!/usr/bin/env bash
# QA only, read-only cloud access. Prepare exactly one callable source update.
set -euo pipefail
umask 077
P=shiftly-t-test
R=asia-northeast1
F=qaRankingAchievementApi
S="$HOME/shiftly-ranking-stage128.mn41V6"
OLD=( "$HOME"/shiftly-ranking-stage104.* )
test "${#OLD[@]}" = 1
test -s "${OLD[0]}/$F-stage105-deployed.zip"
test "$(git hash-object "$S/ranking-achievement-store.mjs")" = e723961d3aa9fb99d43864354a2fe5d688e33a63
D=$(mktemp -d "$HOME/shiftly-ranking-stage130.XXXXXX")
echo "WORKDIR: $D"
API="https://cloudfunctions.googleapis.com/v2/projects/$P/locations/$R"
AUTH="Authorization: Bearer $(gcloud auth print-access-token)"
read_api(){ curl -fsS --max-time 60 -H "$AUTH" "$1"; }
read_api "$API/functions?pageSize=1000" > "$D/functions-before.json"
jq -e '(.nextPageToken // "") == ""' "$D/functions-before.json" >/dev/null
gcloud scheduler jobs list --project="$P" --location="$R" --format=json > "$D/scheduler-before.json"
read_api "$API/functions/$F" > "$D/$F-config.json"
jq -e --arg f "projects/$P/locations/$R/functions/$F" '.name == $f and .state == "ACTIVE" and .environment == "GEN_2"' "$D/$F-config.json" >/dev/null
read_api "$API/functions/$F:getIamPolicy" > "$D/$F-function-iam.json"
SERVICE=$(jq -er '.serviceConfig.service | split("/") | last' "$D/$F-config.json")
gcloud run services get-iam-policy "$SERVICE" --project="$P" --region="$R" --format=json > "$D/$F-run-iam.json"
SRC=$(jq -er '.buildConfig.sourceProvenance.resolvedStorageSource // .buildConfig.source.storageSource | "gs://"+.bucket+"/"+.object+"#"+(.generation|tostring)' "$D/$F-config.json")
gcloud storage cp "$SRC" "$D/$F-rollback.zip"
mkdir "$D/$F-old" "$D/$F-new" "$D/$F-stage105"
unzip -oq "$D/$F-rollback.zip" -d "$D/$F-old"
unzip -oq "${OLD[0]}/$F-stage105-deployed.zip" -d "$D/$F-stage105"
diff -qr "$D/$F-old" "$D/$F-stage105"
test "$(git hash-object "$D/$F-old/ranking-achievement-store.mjs")" = 161fff0348368a97bc8cac5067f3a0700b99079b
cp -a "$D/$F-old/." "$D/$F-new/"
cp "$S/ranking-achievement-store.mjs" "$D/$F-new/"
(cd "$D/$F-new"; node --check ranking-achievement-store.mjs; zip -qr "$D/$F-candidate.zip" .)
unzip -tq "$D/$F-candidate.zip"
python3 - "$D/$F-rollback.zip" "$D/$F-candidate.zip" <<'PY'
import sys,zipfile
def files(path):
    with zipfile.ZipFile(path) as z:
        names=[x.filename for x in z.infolist() if not x.is_dir()]
        assert len(names)==len(set(names))
        return {n:z.read(n) for n in names}
a,b=map(files,sys.argv[1:])
assert a.keys()==b.keys()
assert {n for n in a if a[n]!=b[n]}=={'ranking-achievement-store.mjs'}
PY
echo "PASS: CURRENT SOURCE AND ROLLBACK VERIFIED"
echo "PASS: ONLY ACHIEVEMENT STORE CHANGED"
echo "SUCCESS STAGE130 PROFILE ORDER API PREPARED"
