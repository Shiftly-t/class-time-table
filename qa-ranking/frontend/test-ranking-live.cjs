// Offline integration of the QA overlay on the operation 32 UI baseline.
const assert = require('node:assert/strict');
const {execFileSync, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

const repo = path.resolve(__dirname, '../..');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftly-ranking-ui-'));
const qaOrigin = 'https://shiftly-t-test.web.app';
const baseline = '7820726eff314ed693e0c76d331093ea1f4e049b';
const source = process.argv[2];
const patch = (...args) => spawnSync('python3', [path.join(__dirname, 'apply-qa-ui.py'), staging, ...args], {
  encoding: 'utf8',
});
const save = (name, contents) => fs.writeFileSync(path.join(staging, name), contents);
const load = name => fs.readFileSync(path.join(staging, name), 'utf8');

const firebase = `
const initializeApp = () => ({}), getAuth = () => ({}), getFirestore = () => ({});
const getFunctions = (_, region) => ({region});
const initializeAppCheck = () => {}, ReCaptchaEnterpriseProvider = class {};
const onAuthStateChanged = () => {}, signInWithEmailAndPassword = () => {}, signOut = () => {};
const doc = () => ({}), collection = () => ({}), getDoc = () => {}, getDocs = () => {}, getDocsFromServer = () => {};
const query = () => {}, where = () => {}, setDoc = () => {}, deleteDoc = () => {}, updateDoc = () => {};
const onSnapshot = () => {}, serverTimestamp = () => {}, runTransaction = () => {}, increment = () => {};
const arrayUnion = () => {}, Timestamp = class {}, orderBy = () => {}, limit = () => {};
const writeBatch = () => ({update(){}, commit:async()=>{}});
const httpsCallable = (functions, name) => fields => window.mockCallable(functions, name, fields);
`;

const testHook = `
window.rankingFixture = {
  role(role) {
    state.user = role ? {uid: 'teacher-a'} : null;
    state.profile = role ? {role} : null;
    maintenanceState.loaded = Boolean(role);
    for (const id of ['appPanel', 'notificationButton', 'helpGuideButton', 'logout']) $(id).hidden = !role;
    $('identity').textContent = 'テスト講師 / 運営';
  },
  maintenance(active) {
    maintenanceState.enabled = active;
    $('maintenanceModeLabel').textContent = active ? 'メンテナンス中' : '通常運用中';
  },
  notices() {
    state.notices = [
      {id:'r', kind:'rankingAchievement', target:'history', message:'表彰通知の試験', read:true},
      {id:'s', kind:'lesson', message:'既存通知の試験', read:true},
    ];
  }
};
`;

function fixture() {
  if (source) {
    fs.cpSync(source, staging, {recursive: true});
  } else {
    for (const name of ['index.html', 'app.js', 'style.css']) {
      save(name, execFileSync('git', ['show', `${baseline}:${name}`], {cwd: repo, encoding: 'utf8'}));
    }
    save('index.html', load('index.html').replace('data-shiftly-environment="production"', 'data-shiftly-environment="qa"'));
    save('app.js', load('app.js').replace("from './config.js'", "from './config-qa-ui-test.js'"));
    save('config-qa-ui-test.js', `
    export const firebaseConfig = {projectId:'shiftly-t-test', authDomain:'shiftly-t-test.firebaseapp.com',
      apiKey:'fixture', appId:'1:123:web:abc', messagingSenderId:'123'};
    export const qaFirestoreDatabaseId = 'shiftly-qa-v1';
    export const normalAuthorityApiEnabled = true, teacherWorkFeatureEnabled = false;
    `);
    save('booking-config.js', "export const bookingAppCheckSiteKey = 'fixture';");
  }
  const qaIndex = load('index.html');
  save('index.html', qaIndex.replace('data-shiftly-environment="qa"', 'data-shiftly-environment="production"'));
  const refused = patch('--check');
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /QA RANKING UI TARGET MISMATCH/);
  save('index.html', qaIndex);
  const first = patch('--check');
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /SUCCESS RANKING UI QA SOURCE CHECK/);
  assert.equal(load('index.html'), qaIndex);
  const applied = patch();
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /SUCCESS RANKING UI PATCH APPLIED/);
  assert.match(load('index.html'), /id="rankingButton".*id="helpGuideButton"/);
  const patchedApp = load('app.js');
  const upgrade = patch();
  assert.equal(upgrade.status, 0, upgrade.stderr);
  assert.equal(load('app.js'), patchedApp);
  save('app.js', firebase + patchedApp.replace(/^import .* from 'https:\/\/www\.gstatic\.com\/firebasejs\/.*';\n/gm, '') + testHook);
}

async function browserTest() {
  const browser = await chromium.launch({executablePath: '/usr/bin/chromium', args: ['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(6000);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== qaOrigin) return route.abort();
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = fs.existsSync(path.join(staging, name)) ? path.join(staging, name) : path.join(repo, name);
      if (!fs.existsSync(file)) return route.abort();
      const mediaType = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html';
      await route.fulfill({path: file, contentType: mediaType});
    });
    await page.clock.setFixedTime(new Date('2026-11-25T01:00:00.000Z'));
    await page.addInitScript(() => {
      const stats = {slots: 12, regular: 8, seasonal: 4, days: 5, students: 7};
      const coverage = {complete: true, expected: 3, recorded: 3, from: '2026-11-22', to: '2026-11-24'};
      const rows = [
        {teacherUid: 'teacher-a', name: '講師A', rank: 1},
        {teacherUid: 'teacher-b', name: '講師B', rank: 1},
        {teacherUid: 'teacher-c', name: '講師C', rank: 3},
        {teacherUid: 'teacher-d', name: '講師D', rank: 3},
        {teacherUid: 'teacher-e', name: '講師E', rank: 5},
      ].map(row => ({...row, ...stats}));
      const baselineBadge = {badgeId: 'existing', teacherUid: 'teacher-a', name: '自動バッジ', color: '#3344ff',
        icon: '★', source: 'automatic', awardedAt: '2026-11-25T01:00:00.000Z'};
      const award = {name: '年度表彰', teacherName: '講師B', color: '#5566ff', icon: '◎', rank: 1,
        metric: 'slots', kind: 'year', key: '2025', at: '2026-11-01T16:01:00.000Z'};
      const badges = [];
      const rules = [];
      const grants = [];
      let ownOrder=[];
      window.seedCatalog = () => {
        for(let i=1;i<=6;i++){
          badges.push({badgeId:'fixture-manual-'+i,name:'追加運営'+i,color:'#3344ff',icon:'★',active:true});
          rules.push({ruleId:'fixture-rule-'+i,name:'追加自動'+i,color:'#3344ff',icon:'★',active:true,category:'badge',kind:'all',metric:'slots',criterion:'minimum',value:i});
        }
      };
      window.callLog = [];
      window.mockCallable = async ({region}, name, input) => {
        callLog.push({region, name, ...input});
        if (region !== 'asia-northeast1') throw Error('unexpected callable region');
        if (window.failRead && name === 'qaRankingReadApi') {
          throw Object.assign(Error('denied'), {code: window.failRead});
        }
        if (name === 'qaRankingReadApi') {
          if (input.kind === 'profile') {
            const who = rows.find(row => row.teacherUid === (input.teacherUid || 'teacher-a'));
            return {data: {profile: {...who, totals: stats, monthly: [{key: '2026-11', ...stats}]}, coverage}};
          }
          return {data: {period: input.kind === 'cumulative' ? '累計' : '2026年11月', rows, coverage}};
        }
        if (name !== 'qaRankingAchievementApi') throw Error('unexpected callable');
        const teacherUid = input.teacherUid || 'teacher-a';
        switch (input.action) {
          case 'listBadges': {
            if(window.failBadges) throw Object.assign(Error('badge unavailable'),{code:'functions/unavailable'});
            if(teacherUid==='teacher-c') return {data:{badges:[]}};
            const earned=teacherUid==='teacher-b' ? Array.from({length:7},(_,i)=>({...baselineBadge,teacherUid,badgeId:'earned-'+i,name:'講師Bバッジ'+(i+1),recordId:(i+10).toString(16).padStart(64,'0')})) :
              Array.from({length:7},(_,i)=>({...baselineBadge,teacherUid,recordId:i.toString(16).padStart(64,'0'),name:i===0?'自動バッジ':'自分バッジ'+(i+1)}));
            if(teacherUid==='teacher-a'&&ownOrder.length)earned.sort((a,b)=>ownOrder.indexOf(a.recordId)-ownOrder.indexOf(b.recordId));
            return {data:{teacherUid,badges:earned}};
          }
          case 'saveBadgeOrder':
            ownOrder=input.recordIds.slice();break;
          case 'listHistory':
            return {data: {history: [{...award, action: input.cursor ? 'revised' : 'granted'}], nextCursor: input.cursor ? null : 'p2'}};
          case 'manage':
            return {data: {badges, grants, rules, teachers: rows.map(({name, teacherUid}) => ({name, teacherUid, canGrant: true}))}};
          case 'saveManualBadge':
            if (!badges.length) badges.push(input);
            if (!window.manualSaveRetried) {
              window.manualSaveRetried = true;
              throw Object.assign(Error('response lost'), {code: 'functions/unavailable'});
            }
            return {data: {state: 'replayed'}};
          case 'saveAutomaticRule':
            { const old=rules.findIndex(x=>x.ruleId===input.ruleId); if(old<0)rules.push(input);else rules[old]=input; }
            break;
          case 'grantManualBadges':
            grants.push(...input.teacherUids.map(teacherUid=>({...input,teacherUid})));
            break;
          case 'revokeManualBadges':
            for(const teacherUid of input.teacherUids){const i=grants.findIndex(x=>x.teacherUid===teacherUid&&x.badgeId===input.badgeId);if(i>=0)grants.splice(i,1);}
            break;
          case 'archiveDefinition': {
            const items=input.definitionType==='manual'?badges:rules;
            const key=input.definitionType==='manual'?'badgeId':'ruleId';
            const item=items.find(x=>x[key]===input.definitionId);item.archived=true;item.active=false;
            break;
          }
          default:
            throw Error('unexpected achievement action');
        }
        return {data: {state: 'committed'}};
      };
    });
    await page.goto(qaOrigin);
    await page.waitForFunction(() => window.rankingFixture);
    const trigger = page.locator('#rankingButton');
    const dialog = page.locator('#rankingDialog');
    const tab = label => dialog.locator('.ranking-tabs').getByRole('button', {name: label, exact: true});
    const setRole = role => page.evaluate(value => rankingFixture.role(value), role);
    assert.equal(await trigger.isHidden(), true);

    await setRole('employee');
    await trigger.click();
    await dialog.locator('.ranking-podium-person').first().waitFor();
    assert.equal(await dialog.locator('.ranking-podium-person').count(), 4);
    assert.equal(await tab('バッジ管理').count(), 0);
    await dialog.getByRole('button', {name: /全員を表示/}).click();
    assert.equal(await dialog.locator('.ranking-person-row').count(), 1);
    await dialog.getByRole('button', {name: '累計', exact: true}).click();
    await dialog.locator('.ranking-podium-person').first().waitFor();
    assert.equal(await dialog.locator('.ranking-person-row').count(), 0);
    await dialog.locator('.ranking-podium-person').filter({hasText: '講師B'}).click();
    await dialog.getByText('月別の担当授業コマ数（延べ）').waitFor();
    const profileBadges=dialog.locator('.ranking-profile-badges');
    assert.equal(await dialog.locator('.ranking-summary,.ranking-stat').count(),0);
    assert.equal(await profileBadges.getByRole('button',{name:'並び替え'}).isVisible(),false);
    assert.equal(await profileBadges.locator('.ranking-badge-tile').count(),6);
    await profileBadges.getByRole('button',{name:/すべて表示/}).click();
    assert.equal(await profileBadges.locator('.ranking-badge-tile').count(),7);
    await profileBadges.getByRole('button',{name:/閉じる/}).click();
    assert.equal(await profileBadges.locator('.ranking-badge-tile').count(),6);
    await dialog.getByRole('button', {name: '獲得バッジの詳細を見る'}).click();
    await dialog.getByText('講師Bの獲得バッジ').waitFor();
    await dialog.getByText('自動付与', {exact: false}).first().waitFor();
    await tab('ランキング').click();
    await dialog.locator('.ranking-podium-person').filter({hasText:'講師C'}).click();
    await profileBadges.getByText('獲得したバッジはありません。').waitFor();
    assert.equal(await profileBadges.locator('.ranking-badge-tile').count(),0);
    await tab('プロフィール').click();
    await profileBadges.getByText('自動バッジ',{exact:true}).waitFor();
    assert.equal(await profileBadges.locator('.ranking-badge-tile').count(),6);
    await profileBadges.getByRole('button',{name:'並び替え'}).click();
    await profileBadges.getByRole('button',{name:'自分バッジ2を上へ'}).click();
    await profileBadges.getByRole('button',{name:'並び順を保存'}).click();
    await dialog.getByText('並び順を保存しました。').waitFor();
    await profileBadges.locator('.ranking-badge-tile').first().getByText('自分バッジ2',{exact:true}).waitFor();
    await tab('ランキング').click();
    await tab('プロフィール').click();
    await profileBadges.locator('.ranking-badge-tile').first().getByText('自分バッジ2',{exact:true}).waitFor();
    console.log('SUCCESS RANKING PROFILE PERSONAL ORDER UI TESTS');
    await page.evaluate(()=>{window.failBadges=true});
    await tab('プロフィール').click();
    await profileBadges.getByRole('button',{name:'バッジを再取得'}).waitFor();
    assert.equal(await profileBadges.locator('.ranking-badge-tile').count(),0);
    await dialog.getByText('月別の担当授業コマ数（延べ）').waitFor();
    await page.evaluate(()=>{window.failBadges=false});
    await profileBadges.getByRole('button',{name:'バッジを再取得'}).click();
    await profileBadges.getByText('自動バッジ',{exact:true}).waitFor();
    console.log('SUCCESS RANKING PROFILE INLINE BADGE TESTS');

    await dialog.getByRole('button', {name: '閉じる',exact:true}).click();
    await page.evaluate(() => rankingFixture.notices());
    await page.locator('#notificationButton').click();
    const notification = page.locator('#notificationDialog');
    assert.equal(await notification.getByRole('button', {name: '既存通知の試験'}).isDisabled(), true);
    await notification.getByRole('button', {name: '表彰通知の試験'}).click();
    await dialog.getByText('年度表彰', {exact: true}).waitFor();
    assert.equal(await notification.isHidden(), true);
    await dialog.getByRole('button', {name: '過去の表彰をさらに表示'}).click();
    await dialog.getByText(/更新/).waitFor();
    assert.equal(await dialog.getByText('年度表彰', {exact: true}).count(), 2);

    await setRole(null);
    await trigger.waitFor({state: 'hidden'});
    await dialog.waitFor({state: 'hidden'});
    await setRole('admin');
    await trigger.click();
    assert.equal(await tab('バッジ管理').count(), 0);
    await dialog.getByRole('button', {name: '閉じる'}).click();
    await setRole('owner');
    await trigger.click();
    await tab('バッジ管理').click();
    const manual = dialog.locator('form').filter({hasText: 'オリジナルバッジを作成・編集'});
    await manual.getByLabel('バッジ名称').fill('応援バッジ');
    await manual.getByRole('button',{name:'🏆',exact:true}).click();
    await manual.getByLabel('バッジの説明').fill('運営からの感謝');
    await manual.getByLabel('新規付与を許可する').check();
    await manual.getByRole('button', {name: 'バッジを保存する'}).click();
    await manual.locator('.ranking-form-status').getByText(/時間をおいて再試行|保存を確認できません/).waitFor();
    assert.equal(await manual.getByLabel('バッジ名称').inputValue(), '応援バッジ');
    await manual.getByRole('button', {name: 'バッジを保存する'}).click();
    await dialog.getByText('手動バッジを保存しました。').waitFor();

    const grant=dialog.locator('form').filter({hasText:'講師への一括付与・取消'});
    await grant.getByLabel('手動バッジ').selectOption({label:'応援バッジ'});
    await grant.getByLabel(/講師A/).check();await grant.getByLabel(/講師B/).check();
    await grant.getByLabel('理由').fill('QA試験のため');
    await grant.getByRole('button',{name:'2名にバッジを付与する'}).click();
    await dialog.getByText('2名にバッジを付与しました。').waitFor();
    await grant.getByLabel('手動バッジ').selectOption({label:'応援バッジ'});
    await grant.getByLabel('操作').selectOption('revoke');
    await grant.getByLabel(/講師A/).check();await grant.getByLabel(/講師B/).check();
    await grant.getByLabel('理由').fill('QA試験の後片付け');
    await grant.getByRole('button',{name:'2名の付与を取り消す'}).click();
    await dialog.getByText('2名の付与を取り消しました。').waitFor();

    const automatic=dialog.locator('form').filter({hasText:'自動バッジ・表彰ルール'});
    await automatic.getByLabel('種類').selectOption('award');
    assert.equal(await automatic.getByLabel('付与条件').inputValue(),'rank');
    await automatic.getByLabel('バッジ名称').fill('月間表彰');
    await automatic.getByRole('button',{name:'👑',exact:true}).click();
    await automatic.getByRole('button',{name:'紫',exact:true}).click();
    await automatic.getByLabel('バッジ・表彰の説明').fill('月間実績');
    await automatic.getByLabel('基準値').fill('2');
    assert.equal(await automatic.locator('.ranking-preview-title').textContent(),'月間表彰');
    await automatic.getByRole('button',{name:'自動ルールを保存する'}).click();
    await dialog.getByText('自動ルールを保存しました。').waitFor();

    const row=name=>dialog.locator('.ranking-catalog-row').filter({hasText:name});
    await row('応援バッジ').getByText(/運営付与/).waitFor();
    await row('月間表彰').getByText(/自動付与/).waitFor();
    await dialog.getByLabel('付与方法').selectOption('rule');
    assert.equal(await row('応援バッジ').count(),0);
    await row('月間表彰').getByRole('button',{name:'編集'}).click();
    assert.equal(await automatic.getByLabel('バッジ名称').inputValue(),'月間表彰');
    assert.equal(await automatic.getByLabel('バッジ・表彰の説明').inputValue(),'月間実績');
    await automatic.getByLabel('バッジ名称').fill('月間表彰・改');
    await automatic.getByRole('button',{name:'自動ルールを保存する'}).click();
    await row('月間表彰・改').waitFor();
    page.once('dialog',d=>d.accept());
    await row('月間表彰・改').getByRole('button',{name:'削除'}).click();
    await dialog.getByText('バッジ・表彰を削除しました。').waitFor();
    assert.equal(await row('月間表彰・改').count(),0);
    await dialog.getByLabel('削除済みも表示').check();
    await row('月間表彰・改').getByText(/削除済み/).waitFor();
    assert.equal(await row('月間表彰・改').getByRole('button',{name:'編集'}).count(),0);

    const calls = await page.evaluate(() => callLog);
    assert(calls.some(call => call.kind === 'cumulative' && call.key === ''));
    assert(calls.some(call => call.kind === 'profile' && call.teacherUid === 'teacher-b'));
    assert(calls.some(call => call.action === 'listBadges' && call.teacherUid === 'teacher-b'));
    const attempts = calls.filter(call => call.action === 'saveManualBadge');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].operationId, attempts[1].operationId);
    assert.equal(attempts[0].badgeId, attempts[1].badgeId);

    // Catalog folding must preserve filters, archive visibility and row actions.
    await page.evaluate(()=>window.seedCatalog());
    await tab('ランキング').click();
    await tab('バッジ管理').click();
    const catalogRows=dialog.locator('.ranking-catalog-row');
    const more=dialog.locator('.ranking-catalog-more');
    await more.waitFor();
    assert.equal(await catalogRows.count(),5);
    assert.match(await more.textContent(),/13件/);
    assert.equal(await more.getAttribute('aria-expanded'),'false');
    await more.click();
    assert.equal(await catalogRows.count(),13);
    assert.equal(await more.getAttribute('aria-expanded'),'true');
    await more.click();
    assert.equal(await catalogRows.count(),5);
    await dialog.getByLabel('付与方法').selectOption('rule');
    assert.equal(await catalogRows.count(),5);
    assert.match(await more.textContent(),/6件/);
    await more.click();
    assert.equal(await catalogRows.count(),6);
    await dialog.getByLabel('削除済みも表示').check();
    assert.equal(await catalogRows.count(),5);
    assert.match(await more.textContent(),/7件/);
    await more.click();
    assert.equal(await catalogRows.count(),7);
    assert.equal(await row('月間表彰・改').getByRole('button',{name:'編集'}).count(),0);
    await row('追加自動6').getByRole('button',{name:'編集'}).click();
    assert.equal(await automatic.getByLabel('バッジ名称').inputValue(),'追加自動6');
    await dialog.getByLabel('付与方法').selectOption('manual');
    assert.equal(await catalogRows.count(),5);
    await more.click();
    assert.equal(await catalogRows.count(),7);
    console.log('SUCCESS RANKING CATALOG COLLAPSE AND FILTER TESTS');

    for (const [width, height] of [[320, 700], [768, 1024], [1280, 900]]) {
      await page.setViewportSize({width, height});
      assert.equal(await trigger.locator('span').isVisible(), width > 600);
      const bounds = await dialog.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), true);
      assert.equal(await page.locator('.topbar').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    }

    await page.evaluate(() => rankingFixture.maintenance(true));
    await trigger.waitFor({state: 'hidden'});
    await dialog.waitFor({state: 'hidden'});
    await page.evaluate(() => {
      rankingFixture.maintenance(false);
      window.failRead = 'functions/failed-precondition';
    });
    await trigger.click();
    await dialog.getByText('ランキングはまだ公開されていません。').waitFor();
    await page.evaluate(() => { window.failRead = 'functions/permission-denied'; });
    await dialog.getByRole('button', {name: '再取得'}).click();
    await dialog.getByText('認証・アクセス権限・アプリの確認に失敗しました。').waitFor();
    assert.equal(await dialog.locator('.ranking-podium-person').count(), 0);
    assert.deepEqual(errors, []);
    console.log('SUCCESS RANKING UI PATCH AND BROWSER TESTS');
  } finally {
    await browser.close();
  }
}

(async () => {
  try {
    fixture();
    await browserTest();
  } finally {
    fs.rmSync(staging, {recursive: true, force: true});
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
