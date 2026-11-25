from pathlib import Path
import hashlib, sys, re
root=Path(sys.argv[1])
expected={'index.html':'4047d62d635155e76b9a183e97f29a6dec4e94583c1cac94b47ef7591db4cd61','app.js':'e4ca099a5733d7e8df82823b868ee5ede9396c5a34153d646d8655e488bd87de','style.css':'6d7eb34935dad0c9d61a6fcbda5168e47864f81cfc5cb082e180d25c2b281158'}
for name,h in expected.items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==h, 'SOURCE CHANGED: '+name
def replace(s,a,b):
    assert s.count(a)==1, 'ANCHOR MISMATCH: '+a[:80]
    return s.replace(a,b,1)
html=(root/'index.html').read_text()
app=(root/'app.js').read_text()
assert "getFirestore(fbApp, 'shiftly-qa-v1')" in app and 'https://shiftly-t-test.web.app' in app
button='<button id="rankingButton" class="icon-button" type="button" title="ランキング" aria-label="ランキング" hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v7a5 5 0 0 1-10 0V4ZM7 6H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4"/></svg><span class="ranking-button-label">ランキング</span></button>'
html=replace(html,'<button id="notificationButton"',button+'<button id="notificationButton"')
html=replace(html,'</head>','<link rel="stylesheet" href="./ranking-live.css?v=qa-ranking-20261125-b"></head>')
html=replace(html,'<script type="module" src="./app.js?v=shiftly-student-move-migration-20261113"></script>','<dialog id="rankingDialog" aria-label="講師ランキング"><div id="rankingHost" class="ranking-shell"></div></dialog><script type="module" src="./app.js?v=qa-ranking-20261125-b"></script>')
anchor='onAuthStateChanged(auth,user=>{if(!user)loggedOut();else loggedIn(user).catch(e=>{trapError(e,\'ログイン後の読み込みに失敗しました\');});});'
snippet="""// Isolated QA ranking UI. Existing authentication and App Check are reused.
if(location.origin==='https://shiftly-t-test.web.app'&&firebaseConfig.projectId==='shiftly-t-test'){
  import('./ranking-live.js?v=qa-ranking-20261125-b').then(({installRankingLive})=>{
    const ranking=installRankingLive({trigger:$('rankingButton'),dialog:$('rankingDialog'),host:$('rankingHost'),
      call:httpsCallable(getFunctions(fbApp,'asia-northeast1'),'qaRankingReadApi'),
      getSession:()=>state.user?.uid,getRole:()=>state.profile?.role,
      getAvailable:()=>maintenanceState.loaded&&!$('appPanel').hidden&&!$('notificationButton').hidden,
      today:todayKey});
    const observer=new MutationObserver(ranking.sync);
    for(const id of ['appPanel','notificationButton'])observer.observe($(id),{attributes:true,attributeFilter:['hidden']});
  }).catch(()=>console.warn('QA ranking UI unavailable'));
}
"""
app=replace(app,anchor,snippet+anchor)
(root/'index.html').write_text(html)
(root/'app.js').write_text(app)
print('SUCCESS RANKING UI PATCH APPLIED')
