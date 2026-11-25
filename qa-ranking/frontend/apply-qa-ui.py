"""Apply the ranking overlay to a QA Hosting staging directory."""

import argparse
import hashlib
import re
from pathlib import Path


ASSET_VERSION = 'qa-ranking-20261125-c'
LEGACY_BASELINE = {
    'index.html': '4047d62d635155e76b9a183e97f29a6dec4e94583c1cac94b47ef7591db4cd61',
    'app.js': 'e4ca099a5733d7e8df82823b868ee5ede9396c5a34153d646d8655e488bd87de',
    'style.css': '6d7eb34935dad0c9d61a6fcbda5168e47864f81cfc5cb082e180d25c2b281158',
}
AUTH_ANCHOR = 'onAuthStateChanged(auth,user=>{'
RANKING_BUTTON = (
    '<button id="rankingButton" class="icon-button" type="button" title="ランキング" '
    'aria-label="ランキング" hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" '
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
    'aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v7a5 5 0 0 1-10 0V4ZM7 6H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4"/></svg>'
    '<span class="ranking-button-label">ランキング</span></button>'
)
DIALOG = '<dialog id="rankingDialog" aria-label="講師ランキング"><div id="rankingHost" class="ranking-shell"></div></dialog>'
APP_TAG = r'<script type="module" src="\./app\.js(?:\?v=[^"]*)?"></script>'
RANKING_INSTALL = f"""// Isolated QA ranking UI. Existing authentication and App Check are reused.
if(RANKING_QA_GUARD){{
  import('./ranking-live.js?v={ASSET_VERSION}').then(({{installRankingLive}})=>{{
    const rankingFunctions=getFunctions(fbApp,'asia-northeast1');
    const ranking=installRankingLive({{trigger:$('rankingButton'),dialog:$('rankingDialog'),host:$('rankingHost'),
      call:httpsCallable(rankingFunctions,'qaRankingReadApi'),
      callAchievement:httpsCallable(rankingFunctions,'qaRankingAchievementApi'),
      getSession:()=>state.user?.uid,getRole:()=>state.profile?.role,
      getAvailable:()=>maintenanceState.loaded&&!maintenanceState.enabled&&!$('appPanel').hidden&&!$('notificationButton').hidden,
      today:todayKey}});
    qaRankingNoticeOpen=target=>ranking.openAchievement(target,()=>closeDialog('notificationDialog'));
    const observer=new MutationObserver(ranking.sync);
    for(const id of ['appPanel','notificationButton'])observer.observe($(id),{{attributes:true,attributeFilter:['hidden']}});
    const maintenanceLabel=$('maintenanceModeLabel');
    if(maintenanceLabel)observer.observe(maintenanceLabel,{{childList:true}});
  }}).catch(()=>console.warn('QA ranking UI unavailable'));
}}
"""
NOTICE_LABEL = "    const label=make('button','notification-open',notificationText(n));\n    label.type='button';\n"
NOTICE_PATCH = """    const rankingTarget=n.kind==='rankingAchievement'&&['badges','history'].includes(n.target)&&qaRankingNoticeOpen;
    if(rankingTarget){
      label.title=n.target==='badges'?'獲得バッジを表示':'表彰履歴を表示';
      label.addEventListener('click',()=>qaRankingNoticeOpen(n.target));
    }else """
PREVIOUS_INSTALL = (
    r"^(?:// Isolated QA ranking UI\. Existing authentication and App Check are reused\.\n"
    r"|if\(document\.documentElement\.dataset\.shiftlyEnvironment==='qa'\n(?=[^\n]+\n[^\n]+\n  import\('\./ranking-live\.js))"
    r"[\s\S]*?^}\n"
)


def same_baseline(root):
    return all(hashlib.sha256((root / name).read_bytes()).hexdigest() == digest
               for name, digest in LEGACY_BASELINE.items())


def replace_once(text, pattern, replacement):
    if len(re.findall(pattern, text, flags=re.MULTILINE)) != 1:
        raise ValueError(f'ANCHOR MISMATCH: {pattern[:80]}')
    return re.sub(pattern, lambda _: replacement, text, count=1, flags=re.MULTILINE)


def prepare(root):
    html = (root / 'index.html').read_text(encoding='utf-8')
    app = (root / 'app.js').read_text(encoding='utf-8')
    if 'data-shiftly-environment="production"' in html:
        raise ValueError('QA RANKING UI TARGET MISMATCH')

    style = f'<link rel="stylesheet" href="./ranking-live.css?v={ASSET_VERSION}">'
    script = f'<script type="module" src="./app.js?v={ASSET_VERSION}"></script>'
    guard = "location.origin==='https://shiftly-t-test.web.app'&&firebaseConfig.projectId==='shiftly-t-test'"
    if same_baseline(root):
        if "getFirestore(fbApp, 'shiftly-qa-v1')" not in app or 'https://shiftly-t-test.web.app' not in app:
            raise ValueError('QA RANKING UI TARGET MISMATCH')
    else:
        qa_binding = re.search(r"""from ['"]\./(config-qa-[a-zA-Z0-9.-]+\.js)(?:\?[^'"]*)?['"]""", app)
        if not qa_binding:
            raise ValueError('QA CONFIG MODULE NOT FOUND')
        config = (root / qa_binding.group(1)).read_text(encoding='utf-8')
        if ('data-shiftly-environment="qa"' not in html or 'firebaseTargetForPage(' not in app or
                'getFirestore(fbApp, databaseId)' not in app or 'shiftly-qa-v1' not in config or
                not re.search(r"""\bprojectId\b['"]?\s*:\s*['"]shiftly-t-test['"]""", config) or 'shiftly-d02f6' in config):
            raise ValueError('QA RANKING UI TARGET MISMATCH')
        guard += "&&document.documentElement.dataset.shiftlyEnvironment==='qa'&&databaseId==='shiftly-qa-v1'"

    if 'id="rankingButton"' in html:
        html = replace_once(html, r'<button id="rankingButton"[^>]*>[\s\S]*?</button>', '')
        html = replace_once(html, r'<dialog id="rankingDialog"[\s\S]*?</dialog>', '')
        html = replace_once(html, r'<link rel="stylesheet" href="\./ranking-live\.css(?:\?v=[^"]*)?">', '')
        app = replace_once(app, PREVIOUS_INSTALL, '')

    position = '<button id="helpGuideButton"' if 'id="helpGuideButton"' in html else '<button id="notificationButton"'
    html = replace_once(html, re.escape(position), RANKING_BUTTON + position)
    html = replace_once(html, '</head>', style + '</head>')
    html = replace_once(html, APP_TAG, DIALOG + script)
    app = replace_once(app, '^' + re.escape(AUTH_ANCHOR), RANKING_INSTALL.replace('RANKING_QA_GUARD', guard) + AUTH_ANCHOR)
    if 'let qaRankingNoticeOpen;' not in app:
        app = replace_once(app, r'^function renderNotifications\(\)',
                           'let qaRankingNoticeOpen;\nfunction renderNotifications()')
        app = replace_once(app, re.escape(NOTICE_LABEL) + r'    (?=if\()', NOTICE_LABEL + NOTICE_PATCH)
        app = replace_once(app, r"if\(!label\.disabled\)(?=node\.append\(make\('small','notification-jump-hint')",
                           'if(!label.disabled&&!rankingTarget)')
    assets = {name: Path(__file__).with_name(name).read_text(encoding='utf-8')
              for name in ['ranking-live.js', 'ranking-live.css']}
    return {'index.html': html, 'app.js': app, **assets}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path, help='QA Hosting staging directory')
    parser.add_argument('--check', action='store_true', help='validate and leave the directory unchanged')
    args = parser.parse_args()
    try:
        assets = prepare(args.root)
    except (OSError, ValueError) as error:
        parser.exit(1, f'{error}\n')
    if args.check:
        print('SUCCESS RANKING UI QA SOURCE CHECK')
        return
    for name, contents in assets.items():
        (args.root / name).write_text(contents, encoding='utf-8')
    print('SUCCESS RANKING UI PATCH APPLIED')


if __name__ == '__main__':
    main()
