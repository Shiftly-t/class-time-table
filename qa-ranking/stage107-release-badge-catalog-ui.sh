#!/usr/bin/env bash
# QA Hosting only. Stop on unexpected drift; never automatically retry a release.
set -euo pipefail
umask 077
P=shiftly-t-test
BASE="$HOME/shiftly-ranking-stage85.THZj48"
OLD=( "$HOME"/shiftly-ranking-stage90.*/after-files.json )
test "${#OLD[@]}" = 1
test -s "${OLD[0]}"
S="$HOME/shiftly-ranking-stage98.fSZPZv/repo/qa-ranking/frontend"
D=$(mktemp -d "$HOME/shiftly-ranking-stage107.XXXXXX")
echo "WORKDIR: $D"
API=https://firebasehosting.googleapis.com/v1beta1
AUTH="Authorization: Bearer $(gcloud auth print-access-token)"
api(){ curl -fsS --max-time 60 -H "$AUTH" "$1"; }
release(){ api "$API/sites/$P/channels/live/releases?pageSize=1"; }
manifest(){ api "$API/$1/files?pageSize=1000" | jq -e 'select((.nextPageToken // "") == "")'; }
norm(){ jq -S '[.files[]|{path,hash}]|sort_by(.path)' "$1"; }
release > "$D/before-release.json"
V=$(jq -er '.releases[0].version.name' "$D/before-release.json")
[[ "$V" == sites/shiftly-t-test/versions/* ]]
manifest "$V" > "$D/before-files.json"
diff <(norm "${OLD[0]}") <(norm "$D/before-files.json")
api "$API/$V" > "$D/before-version.json"
jq -e '. == {"hosting":{"site":"shiftly-t-test","public":"public","ignore":["firebase.json","**/.*","**/node_modules/**"],"headers":[{"source":"**","headers":[{"key":"Cache-Control","value":"no-cache, no-store, must-revalidate"}]}]}}' "$BASE/firebase.json" >/dev/null
cp -a "$BASE/public" "$BASE/firebase.json" "$D/"
cd "$D"
diff <(jq -r '.files[].path|ltrimstr("/")|select(startswith("__/firebase/")|not)' before-files.json | sort) <(find public -type f -printf '%P\n' | sort)
while IFS= read -r f; do
  curl -fsSL --max-time 60 -H 'Cache-Control: no-cache' "https://$P.web.app/$f?stage107=$(date +%s%N)" -o live-check.tmp
  cmp "public/$f" live-check.tmp
done < <(find public -type f -printf '%P\n' | sort)
rm live-check.tmp
echo "PASS: CURRENT QA BASELINE AND ROLLBACK VERSION $V"
test "$(git hash-object "$S/ranking-live.js")" = 76e9a04c2207eac7a58381bb50d82b52314bceb4
test "$(git hash-object "$S/ranking-live.css")" = be20ee1afecfc4fddd9ef55b0ce6249ac9832efb
cp "$S/ranking-live.js" "$S/ranking-live.css" public/
python3 - <<'PY'
from pathlib import Path
import re
version=b'qa-ranking-20261126-catalog107'
for f, patterns in {
    'app.js': [rb'(ranking-live\.js\?v=)[\w.-]+'],
    'index.html': [rb'(ranking-live\.css\?v=)[\w.-]+',rb'(app\.js\?v=)[\w.-]+']
}.items():
    p=Path('public')/f
    s=p.read_bytes()
    for pat in patterns:
        s,n=re.subn(pat,lambda m:m.group(1)+version,s)
        if n!=1: raise SystemExit('ASSET VERSION ANCHOR MISMATCH: '+f)
    p.write_bytes(s)
PY
node --input-type=module --check < public/ranking-live.js
node --input-type=module --check < public/app.js
echo "PASS: PINNED SOURCE AND CACHE VERSION"
test "$(release | jq -er '.releases[0].version.name')" = "$V"
echo "DEPLOYMENT STARTED" > release-started.txt
firebase deploy --only hosting --project "$P" --config firebase.json --non-interactive
AUTH="Authorization: Bearer $(gcloud auth print-access-token)"
release > after-release.json
NV=$(jq -er '.releases[0].version.name' after-release.json)
[[ "$NV" == sites/shiftly-t-test/versions/* && "$NV" != "$V" ]]
manifest "$NV" > after-files.json
api "$API/$NV" > after-version.json
diff <(jq -S '.config' before-version.json) <(jq -S '.config' after-version.json)
jq -nr --slurpfile a before-files.json --slurpfile b after-files.json '
def m: [.files[]|{key:.path,value:.hash}]|from_entries;
($a[0]|m) as $x | ($b[0]|m) as $y |
(($x+$y)|keys[]) as $k | select($x[$k]!=$y[$k]) | $k
' | sort > changed-files.txt
diff changed-files.txt <(printf '/%s\n' app.js index.html ranking-live.css ranking-live.js | sort)
for f in ranking-live.js ranking-live.css app.js index.html; do
  curl -fsSL --max-time 60 -H 'Cache-Control: no-cache' "https://$P.web.app/$f?stage107=$(date +%s%N)" -o live-check.tmp
  cmp "public/$f" live-check.tmp
  echo "PASS: LIVE $f"
done
rm live-check.tmp
echo "PASS: ONLY FOUR HOSTING FILES CHANGED; CONFIG PRESERVED"
echo "SUCCESS STAGE107 BADGE CATALOG QA UI RELEASE"
