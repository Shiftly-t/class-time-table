#!/usr/bin/env bash
# Compare immutable QA deployed archives with production rollback archives. Local staging only.
set -euo pipefail
umask 077
P=( "$HOME"/shiftly-ranking-stage155.* )
Q=( "$HOME"/shiftly-ranking-stage153.* )
E=( "$HOME"/shiftly-ranking-stage156.* )
test "${#P[@]}" -eq 1 && test "${#Q[@]}" -eq 1 && test "${#E[@]}" -eq 1
P="${P[0]}"; Q="${Q[0]}"; E="${E[0]}"
(cd "$P"; sha256sum -c SHA256SUMS >/dev/null)
jq -e '.done==true and .error==null and .metadata.operationState=="SUCCESSFUL"' "$E/operation-status.json" >/dev/null
D=$(mktemp -d "$HOME/shiftly-ranking-stage157.XXXXXX")
echo "WORKDIR: $D"
mkdir "$D/qa"
jq -e '(.functions|length)==10 and all(.functions[];.state=="ACTIVE")' "$Q/functions.json" >/dev/null
for F in qaNormalAuthorityApi qaSeasonalAuthorityApi qaBookingAdminApi qaRankingReadApi qaRankingAchievementApi qaRankingCaptureDaily qaRankingFinalizeDaily qaRankingProcessAchievements; do
  SRC=$(jq -er --arg f "$F" '[.functions[]|select(.name==("projects/shiftly-t-test/locations/asia-northeast1/functions/"+$f))]|select(length==1)|.[0]|.buildConfig.sourceProvenance.resolvedStorageSource // .buildConfig.source.storageSource | "gs://"+.bucket+"/"+.object+"#"+(.generation|tostring)' "$Q/functions.json")
  [[ "$SRC" == gs://gcf-v2-sources-592978959203-asia-northeast1/* ]]
  gcloud storage cp "$SRC" "$D/qa/$F.zip" --project=shiftly-t-test --quiet
  unzip -tq "$D/qa/$F.zip" >/dev/null
done
python3 - "$P" "$D" <<'PY'
import hashlib,json,sys
from pathlib import Path,PurePosixPath
from zipfile import ZipFile
p,d=map(Path,sys.argv[1:])
def files(path):
    with ZipFile(path) as z:
        names=[i.filename for i in z.infolist() if not i.is_dir()]
        if len(names)!=len(set(names)) or any(PurePosixPath(n).is_absolute() or '..' in PurePosixPath(n).parts for n in names): raise ValueError('Unsafe ZIP')
        return {n:hashlib.sha256(z.read(n)).hexdigest() for n in names}
report={}
for prod,qa in [('normalAuthorityApi','qaNormalAuthorityApi'),('seasonalAuthorityApi','qaSeasonalAuthorityApi'),('bookingAdminApi','qaBookingAdminApi')]:
    a=files(p/(prod+'-rollback.zip')); b=files(d/'qa'/(qa+'.zip'))
    report[prod]={'production_only':sorted(a.keys()-b.keys()),'qa_only':sorted(b.keys()-a.keys()),'changed_common':sorted(n for n in a.keys()&b.keys() if a[n]!=b[n]),'identical':sorted(n for n in a.keys()&b.keys() if a[n]==b[n])}
    print(f'=== {prod} ===')
    print('IDENTICAL:',len(report[prod]['identical']))
    print('PRODUCTION ONLY:',len(report[prod]['production_only']))
    print('QA ONLY:',len(report[prod]['qa_only']))
    print('CHANGED COMMON:',len(report[prod]['changed_common']))
    for n in report[prod]['changed_common']: print('  '+n)
(d/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('PASS: PRODUCTION AND QA SOURCE ARCHIVES COMPARED')
PY
echo "SUCCESS STAGE157 PRODUCTION SOURCE INVENTORY"
