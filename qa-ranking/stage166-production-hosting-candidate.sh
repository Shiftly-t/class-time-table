#!/usr/bin/env bash
# Local production Hosting candidate, offline browser regression. No deploy.
set -euo pipefail
umask 077
W=$(mktemp -d "$HOME/shiftly-ranking-stage166.XXXXXX")
echo "WORKDIR: $W"
mkdir "$W/main" "$W/dev" "$W/public"
curl -fsSL --max-time 120 "https://codeload.github.com/Shiftly-t/class-time-table/tar.gz/7820726eff314ed693e0c76d331093ea1f4e049b" | tar -xz --strip-components=1 -C "$W/main"
curl -fsSL --max-time 120 "https://codeload.github.com/Shiftly-t/class-time-table/tar.gz/f98315da37a1c47d8d57310f947484171e7e41d3" | tar -xz --strip-components=1 -C "$W/dev"
find "$W/main" -maxdepth 1 -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) -exec cp {} "$W/public/" \;
for f in index.html app.js course-booking-admin.html course-booking-admin.js seasonal-authority-client.js config.js firebase-target.js; do
  curl -fsSL --max-time 30 -H 'Cache-Control: no-cache' "https://shiftly-t.web.app/$f?stage166=$(date +%s%N)" -o "$W/live-check"
  cmp "$W/public/$f" "$W/live-check"
done
echo "PASS: PRODUCTION HOSTING BASELINE"
python3 - "$W" <<'PY'
import sys,re,runpy,hashlib,json
from pathlib import Path
w=Path(sys.argv[1]); root=w/"public"; front=w/"dev/qa-ranking/frontend"
ui=runpy.run_path(str(front/"apply-qa-ui.py"))
co=runpy.run_path(str(front/"apply-qa-correction.py"))
def once(s,a,b):
    if s.count(a)!=1: raise ValueError("Anchor mismatch: "+a[:100])
    return s.replace(a,b,1)
def read(n): return (root/n).read_text()
def save(n,s): (root/n).write_text(s)
def hashes(): return {f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in root.iterdir() if f.is_file()}
before=hashes()
version="prod-ranking-20261126-a"
for n in ("index.html","course-booking-admin.html"):
    assert 'data-shiftly-environment="production"' in read(n)
for n in ("app.js","course-booking-admin.js"):
    assert re.search(r"""from ['"]\./config\.js(?:\?[^'"]*)?['"]""",read(n))
assert re.search(r"""projectId\s*:\s*['"]shiftly-d02f6['"]""",read("config.js"))
assert "qaFirestoreDatabaseId = ''" in read("config.js")
assert not any((root/n).exists() for n in ("ranking-live.js","ranking-live.css","ranking-correction-ui.js"))
html=read("index.html"); app=read("app.js")
assert 'id="rankingButton"' not in html and 'qaRankingNoticeOpen' not in app
assert "firebaseTargetForPage(" in app and "getFirestore(fbApp, databaseId)" in app
guard="location.origin==='https://shiftly-t.web.app'&&firebaseConfig.projectId==='shiftly-d02f6'&&document.documentElement.dataset.shiftlyEnvironment==='production'&&!databaseId"
install=ui["RANKING_INSTALL"].replace("RANKING_QA_GUARD",guard).replace(ui["ASSET_VERSION"],version).replace("qaRankingReadApi","rankingReadApi").replace("qaRankingAchievementApi","rankingAchievementApi").replace("qaRankingNoticeOpen","rankingNoticeOpen").replace("Isolated QA ranking UI","Isolated production ranking UI").replace("QA ranking UI unavailable","Ranking UI unavailable")
pos='<button id="helpGuideButton"'
html=once(html,pos,ui["RANKING_BUTTON"]+pos)
html=once(html,'</head>',f'<link rel="stylesheet" href="./ranking-live.css?v={version}"></head>')
html=ui["replace_once"](html,ui["APP_TAG"],ui["DIALOG"]+f'<script type="module" src="./app.js?v={version}"></script>')
app=once(app,ui["AUTH_ANCHOR"],install+ui["AUTH_ANCHOR"])
app=once(app,"function renderNotifications()","let rankingNoticeOpen;\nfunction renderNotifications()")
app=ui["replace_once"](app,re.escape(ui["NOTICE_LABEL"])+r'    (?=if\()',ui["NOTICE_LABEL"]+ui["NOTICE_PATCH"].replace("qaRankingNoticeOpen","rankingNoticeOpen"))
app=ui["replace_once"](app,r"if\(!label\.disabled\)(?=node\.append\(make\('small','notification-jump-hint')","if(!label.disabled&&!rankingTarget)")
for old,new in [
('await commands.publishCourse({courseId:course.id,beforeCourse:course,changes:[{id,before:old||null,value:data}]});','if((await commands.publishCourse({courseId:course.id,beforeCourse:course,changes:[{id,before:old||null,value:data}]})).cancelled)return;'),
('await commands.publishCourse({courseId:old.courseId,beforeCourse:state.courses.find(c=>c.id===old.courseId),changes:[{id:old.id,before:old,remove:true}]});','if((await commands.publishCourse({courseId:old.courseId,beforeCourse:state.courses.find(c=>c.id===old.courseId),changes:[{id:old.id,before:old,remove:true}]})).cancelled)return;'),
('await commands.publishCourse({\n        courseId:course.id,','const result=await commands.publishCourse({\n        courseId:course.id,'),
('\n      if(await refreshPublishedCourseEditor(course,editor,current)){','\n      if(result.cancelled)return;\n      if(await refreshPublishedCourseEditor(course,editor,current)){')]:
    app=once(app,old,new)
app=co["version"](app,"seasonal-authority-client.js").replace(co["VERSION"],version)
save("app.js",app); save("index.html",html)
save("seasonal-authority-client.js",co["update_seasonal_client"](read("seasonal-authority-client.js")).replace(co["VERSION"],version))
save("course-booking-admin.js",co["update_booking"](read("course-booking-admin.js")).replace(co["VERSION"],version))
save("course-booking-admin.html",co["version"](read("course-booking-admin.html"),"course-booking-admin.js").replace(co["VERSION"],version))
save("ranking-live.js",once((front/"ranking-live.js").read_text(),"QA検証版 · 確定済み実績","確定済み実績").replace("existing QA Auth","existing Auth"))
for n in ("ranking-live.css","ranking-correction-ui.js"): save(n,(front/n).read_text())
after=hashes()
changed={n for n in before if before[n]!=after[n]}
added=set(after)-set(before)
assert changed=={"index.html","app.js","seasonal-authority-client.js","course-booking-admin.js","course-booking-admin.html"},changed
assert added=={"ranking-live.js","ranking-live.css","ranking-correction-ui.js"},added
assert "qaRanking" not in read("app.js") and "shiftly-t-test.web.app" not in install
assert after["config.js"]==before["config.js"] and after["firebase-target.js"]==before["firebase-target.js"]
(w/"candidate-report.json").write_text(json.dumps({"baseline":"7820726eff314ed693e0c76d331093ea1f4e049b","changed":sorted(changed),"added":sorted(added),"files":after},indent=2))
# Exercise the already-prepared production candidate with the existing browser assertions.
# Use a reserved .invalid origin and mock every browser request, including Firebase SDKs.
t=(front/"test-ranking-live.cjs").read_text()
start=t.index("function fixture() {"); end=t.index("async function browserTest()",start)
t=t[:start]+r"""function fixture() {
  assert.ok(source);
  fs.cpSync(source, staging, {recursive:true});
  assert.match(load('index.html'), /data-shiftly-environment="production"/);
  const app=load('app.js');
  assert.match(app,/https:\/\/shiftly-t\.web\.app/);
  const patchedApp=app.replace("location.origin==='https://shiftly-t.web.app'","location.origin==='https://shiftly-ranking.invalid'");
  assert.notEqual(patchedApp,app);
  save('app.js', firebase + patchedApp.replace(/^import .* from 'https:\/\/www\.gstatic\.com\/firebasejs\/.*';\n/gm, '') + testHook);
}

"""+t[end:]
t=t.replace("https://shiftly-t-test.web.app","https://shiftly-ranking.invalid").replace("qaRankingReadApi","rankingReadApi").replace("qaRankingAchievementApi","rankingAchievementApi").replace("executablePath: '/usr/bin/chromium'","executablePath: process.env.STAGE99_CHROMIUM")
(front/"stage166.cjs").write_text(t)
print("PASS: EXACT PRODUCTION HOSTING CHANGE SCOPE")
PY
for f in app.js seasonal-authority-client.js course-booking-admin.js ranking-live.js ranking-correction-ui.js; do
 node --input-type=module --check < "$W/public/$f"
done
B=( "$HOME"/shiftly-ranking-stage98.* )
# Locate the already installed browser tools, not a new download.
B="$HOME/shiftly-ranking-stage98.fSZPZv"
export NODE_PATH="$B/browser-tools/node_modules"
export STAGE99_CHROMIUM="$(find "$B/chromium-recovery" -type f -name chrome -print -quit)"
test -x "$STAGE99_CHROMIUM"
timeout 180s node "$W/dev/qa-ranking/frontend/stage166.cjs" "$W/public"
echo "SUCCESS STAGE166 PRODUCTION HOSTING CANDIDATE"
