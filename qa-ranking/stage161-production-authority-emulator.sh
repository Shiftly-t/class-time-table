#!/usr/bin/env bash
# Local isolated emulator regression using copies of production candidates.
set -euo pipefail
umask 077
D="$HOME/shiftly-ranking-stage159.ekgra8pt"
test -f "$D/NOT_DEPLOYABLE.txt"
W=$(mktemp -d "$HOME/shiftly-ranking-stage161.XXXXXX")
echo "WORKDIR: $W"
export NODE_PATH=""
while IFS= read -r f; do
  p="$(dirname "$(dirname "$f")")"
  if [ -f "$p/firebase-functions/package.json" ]; then export NODE_PATH="$p"; break; fi
done < <(find "$HOME" -path '*/node_modules/firebase-admin/package.json' -type f 2>/dev/null)
test -n "$NODE_PATH"
mkdir "$W/repo"
curl -fsSL --max-time 120 "https://codeload.github.com/Shiftly-t/class-time-table/tar.gz/d4744dbe584429d260fe1ffbe6622d7697b98894" | tar -xz --strip-components=1 -C "$W/repo"
python3 - "$D" "$W" <<'PY'
import json,shutil,sys
from pathlib import Path
d,w=map(Path,sys.argv[1:])
demo="demo-shiftly-ranking-stage161"
names=["normalAuthorityApi","seasonalAuthorityApi","bookingAdminApi","bookingPublicApi","bookingStudentDeleted"]
for name in names:
    dst=w/name
    shutil.copytree(d/name,dst)
    for f in dst.glob("ranking-*"):
        if f.suffix in (".cjs",".mjs"):
            s=f.read_text()
            f.write_text(s.replace("'shiftly-d02f6'","'"+demo+"'"))
tests={
 "normalAuthorityApi":"test-ranking-authority-emulator.cjs",
 "seasonalAuthorityApi":"test-ranking-manual-seasonal-emulator.cjs",
 "bookingAdminApi":"test-ranking-booking-correction-emulator.cjs"}
for name,test in tests.items():
    s=(w/"repo"/"qa-ranking"/"functions"/test).read_text()
    s=s.replace("'shiftly-t-test'","'"+demo+"'").replace("'shiftly-qa-v1'","'(default)'")
    if name=="bookingAdminApi":
        old=" const {qaBookingAdminApi}=require('./index.js');\n const app=getApp(),db=getFirestore(app,'(default)');"
        new=""" const {initializeApp}=require('firebase-admin/app');
 const {FieldValue,Timestamp}=require('firebase-admin/firestore');
 const {HttpsError}=require('firebase-functions/v2/https');
 const app=initializeApp({projectId:'demo-shiftly-ranking-stage161'}),db=getFirestore(app);
 const coor=require('./coordination.cjs').createCoordinator({rawDb:db,FieldValue,Timestamp,core,HttpsError,key:()=> 'ad'.repeat(32)});
 const bridge=require('./stage2-bridge.cjs').createStage2Bridge({coor,core,Timestamp,reservedDate:()=>false,legacyAdmin:()=>{throw Error('UNEXPECTED LEGACY ADMIN');},legacyPublic:()=>{throw Error('UNEXPECTED LEGACY PUBLIC');}});
 const methods=['bookingAdminApi','adminApi','bookingAdmin','admin'].filter(k=>typeof bridge[k]==='function');
 assert.equal(methods.length,1,'Booking bridge entry: '+Object.keys(bridge).join(','));
 const qaBookingAdminApi={run:req=>bridge[methods[0]](req)};"""
        if s.count(old)!=1: raise RuntimeError("Booking fixture anchor mismatch")
        s=s.replace(old,new)
        anchor="  assert.equal((await db.doc(entry).get()).get('confirmed').length,1);"
        extra="""
  for(const name of ['normalAuthorityApi','seasonalAuthorityApi','bookingAdminApi','bookingPublicApi','bookingStudentDeleted']){
    const dir=require('node:path').resolve(__dirname,'..',name);
    const localCore=require(dir+'/booking-core.cjs');
    const adapter=require(dir+'/coordination.cjs').createCoordinator({rawDb:db,FieldValue,Timestamp,core:localCore,HttpsError,key:()=> 'ad'.repeat(32)});
    const graph=require(dir+'/booking-graph.cjs').createBookingGraph({coor:adapter,core:localCore,reservedDate:()=>false});
    const verify=()=>adapter.run('admin',{auth:{uid:'admin'},app:{appId:'fixture'},data:{action:'capabilities'}},()=>graph.validate({strict:true}).then(()=>({ok:true})));
    assert.equal((await verify()).ok,true);
    await db.doc('timetableEntries/'+id).update({status:'invalid'});
    try{await assert.rejects(verify(),/Published assignment display.state mismatch/);}
    finally{await db.doc('timetableEntries/'+id).update({status:'cancelled'});}
    console.log('PASS: CROSS FUNCTION GRAPH',name);
  }
"""
        if s.count(anchor)!=1: raise RuntimeError("Cross function fixture anchor mismatch")
        s=s.replace(anchor,anchor+extra)
    guard="\nif(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8788'||process.env.GCLOUD_PROJECT!=='demo-shiftly-ranking-stage161')throw Error('DEMO EMULATOR REQUIRED');\n"
    if not s.startswith("'use strict';"): raise RuntimeError("Unexpected test format")
    s=s.replace("'use strict';","'use strict';"+guard,1)
    (w/name/test).write_text(s)
(w/"firebase.json").write_text(json.dumps({"emulators":{"firestore":{"host":"127.0.0.1","port":8788},"hub":{"host":"127.0.0.1","port":4400},"logging":{"host":"127.0.0.1","port":4500},"ui":{"enabled":False},"singleProjectMode":True}}))
PY
cd "$W"
cat > run-tests.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
test "${FIRESTORE_EMULATOR_HOST:-}" = 127.0.0.1:8788
export GCLOUD_PROJECT=demo-shiftly-ranking-stage161
export GOOGLE_CLOUD_PROJECT=demo-shiftly-ranking-stage161
export GCP_PROJECT=demo-shiftly-ranking-stage161
timeout 120s node normalAuthorityApi/test-ranking-authority-emulator.cjs
timeout 120s node seasonalAuthorityApi/test-ranking-manual-seasonal-emulator.cjs
timeout 120s node bookingAdminApi/test-ranking-booking-correction-emulator.cjs
SH
timeout 420s firebase emulators:exec --only firestore --project demo-shiftly-ranking-stage161 --config "$W/firebase.json" 'bash run-tests.sh'
echo "SUCCESS STAGE161 PRODUCTION AUTHORITY EMULATOR"
