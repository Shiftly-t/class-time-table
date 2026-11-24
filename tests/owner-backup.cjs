const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const qa = require('./qa-firebase-fixture.cjs');

const sourceDir = path.resolve(__dirname, '../production-hosting');
const origin = 'https://shiftly.invalid';

const firebase = {
  'firebase-app.js': 'export const initializeApp = config => config;',
  'firebase-auth.js': `
    const auth = { currentUser: { uid: 'synthetic-owner' } };
    export const getAuth = () => auth;
    export const onAuthStateChanged = (session, callback) => queueMicrotask(() => callback(session.currentUser));
    export const signInWithEmailAndPassword = window.backupTest.unexpected;
    export const signOut = window.backupTest.unexpected;
  `,
  'firebase-firestore.js': `
    export const getFirestore = (app, databaseId) => {
      window.backupTest.firestoreTargets.push([app.projectId,databaseId]);
      return {};
    };
    export const collection = (source, ...parts) => ({ path: [source.path, ...parts].filter(Boolean).join('/') });
    export const doc = (source, ...parts) => collection(source, ...parts);
    export const query = ref => ref;
    export const where = () => {};
    export const orderBy = () => {};
    export const limit = () => {};
    export const serverTimestamp = () => new Date();
    export const increment = window.backupTest.unexpected;
    export const arrayUnion = window.backupTest.unexpected;
    export const setDoc = window.backupTest.unexpected;
    export const deleteDoc = window.backupTest.unexpected;
    export const updateDoc = window.backupTest.unexpected;
    export const writeBatch = window.backupTest.unexpected;
    export const runTransaction = window.backupTest.unexpected;
    export class Timestamp {}
    export const getDocs = ref => window.backupTest.readCollection(ref.path);
    export const getDocsFromServer = getDocs;
    export const getDoc = async ref => ({
      exists: () => ref.path === 'users/synthetic-owner',
      data: () => ({ role: 'owner', name: 'テスト運営' }),
    });
    export function onSnapshot(ref, optionsOrNext, next) {
      const listener = typeof optionsOrNext === 'function' ? optionsOrNext : next;
      queueMicrotask(() => listener({
        exists: () => false,
        docs: [],
        metadata: { fromCache: false, hasPendingWrites: false },
      }));
      return () => {};
    }
  `,
  'firebase-functions.js': `
    export const getFunctions = (app, region) => {
      window.backupTest.functionsTargets.push([app.projectId,region]);
      return {};
    };
    export const httpsCallable = (_, name) => fields => window.backupTest.call(name, fields);
  `,
  'firebase-app-check.js': `
    export const initializeAppCheck = () => {};
    export class ReCaptchaEnterpriseProvider {}
  `,
};

function installBackupFixture(mode) {
  const actions = [];
  let created = false;
  let unexpected = 0;
  const collectionReads = [];
  const protocolVersion = 3;
  window.backupTest = {
    actions,
    collectionReads,
    firestoreTargets:[],
    functionsTargets:[],
    unexpected() {
      unexpected++;
      throw Error('Unexpected SDK operation');
    },
    getUnexpected: () => unexpected,
    async readCollection(collection) {
      collectionReads.push(collection);
      if (created && mode === 'audit-refresh' && collection === 'auditLogs') {
        throw Object.assign(Error('SYNTHETIC_PRIVATE_AUDIT'), { code: 'permission-denied' });
      }
      return { docs: [] };
    },
    async call(name, fields) {
      actions.push([name, fields.action]);
      if (name !== 'seasonalAuthorityApi') throw Error('Unexpected test service');
      const { action } = fields;
      if (action === 'capabilities') {
        return { data: { protocolVersion, operations: ['listSnapshots', 'createSnapshot'] } };
      }
      if (action === 'listSnapshots') {
        if (mode === 'initial-list' || (created && mode === 'list-refresh')) {
          throw Object.assign(Error('SYNTHETIC_PRIVATE_LIST'), { code: 'functions/failed-precondition' });
        }
        return {
          data: {
            protocolVersion,
            archives: [{ id: 'fixture-old-archive', label: 'テスト既存バックアップ', formatVersion: 3, recordCount: 2 }],
            nextCursor: null,
            totalBackupCount: 1,
          },
        };
      }
      if (action === 'createSnapshot') {
        created = true;
        return {
          data: { protocolVersion, ok: true, version: 2, changed: 1, archiveId: 'fixture-new-archive', count: 7, formatVersion: 3 },
        };
      }
      throw Error('Unexpected test action: ' + action);
    },
  };
}

async function serveOffline(route, blocked) {
  const url = new URL(route.request().url());
  const name = path.posix.basename(url.pathname);
  const javascript = body => route.fulfill({
    contentType: 'text/javascript',
    headers: { 'access-control-allow-origin': '*' },
    body,
  });
  if (url.origin === 'https://www.gstatic.com' && /^\/firebasejs\/[^/]+\//.test(url.pathname) && Object.hasOwn(firebase, name)) {
    return javascript(firebase[name]);
  }
  if (url.origin === origin && url.pathname === '/' + name) {
    if (name === 'config.js') return javascript(qa.configModule);
    if (name === 'booking-config.js') return javascript(qa.bookingConfigModule);
    if (name === 'favicon.ico') return route.fulfill({ status: 204 });
    const source = path.join(sourceDir, name);
    if (/^[a-z][a-z-]*\.(?:html|css|js)$/.test(name) && existsSync(source)) {
      const body = await readFile(source, 'utf8');
      if (name.endsWith('.js')) return javascript(body);
      return route.fulfill(name.endsWith('.html')
        ? { contentType: 'text/html', body: body.replace('data-shiftly-environment="production"', 'data-shiftly-environment="qa"') }
        : { contentType: 'text/css', body });
    }
  }
  blocked.push(url.origin + url.pathname);
  return route.abort('blockedbyclient');
}

async function runScenario(browser, mode) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const blocked = [];
  const errors = [];
  try {
    await context.route('**/*', route => serveOffline(route, blocked));
    await context.addInitScript(installBackupFixture, mode);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/index.html');
    await page.locator('#navOwnerHistory').click();
    const targets = await page.evaluate(() => ({firestore:window.backupTest.firestoreTargets,functions:window.backupTest.functionsTargets}));
    assert.deepEqual(targets.firestore, [[qa.projectId,qa.databaseId]]);
    assert.deepEqual(targets.functions, [[qa.projectId,qa.region]]);
    const archiveList = page.locator('#ownerArchiveList');
    if (mode === 'initial-list') {
      const warning = archiveList.locator('.owner-backup-warning');
      await warning.waitFor();
      assert.match(await warning.innerText(), /新形式バックアップ.*一覧|バックアップ.*取得/);
      assert.match(await warning.innerText(), /旧形式の復元適用は停止/);
      assert.doesNotMatch(await archiveList.innerText(), /クラウドバックアップはまだありません|保存済み完全バックアップ：0件/);
    } else {
      await archiveList.getByText('テスト既存バックアップ').waitFor();
      await page.locator('#ownerCreateBackup').click();
      const notice = page.locator('#shiftlyNotice[open] #shiftlyNoticeText');
      await notice.waitFor();
      assert.equal(await notice.textContent(), 'バックアップは作成済みです。一覧を更新できませんでした。一覧のみ再読み込みしてください。');
      await page.locator('#shiftlyNoticeClose').click();
      const before = await page.evaluate(() => window.backupTest.collectionReads.length);
      await page.locator('#ownerRefresh').click();
      await page.waitForFunction(before => window.backupTest.collectionReads.length > before, before);
      if (mode === 'list-refresh') {
        await page.locator('#ownerAuditMessage').filter({ hasText: '最近の変更履歴' }).waitFor();
        await archiveList.locator('.owner-backup-warning').waitFor();
        assert.doesNotMatch(await archiveList.innerText(), /クラウドバックアップはまだありません|保存済み完全バックアップ：0件/);
      } else {
        await page.locator('#ownerAuditMessage').filter({ hasText: '読み込みに失敗しました' }).waitFor();
      }
    }
    const actions = await page.evaluate(() => window.backupTest.actions);
    assert.equal(actions.filter(([, action]) => action === 'createSnapshot').length, mode === 'initial-list' ? 0 : 1);
    assert.ok(actions.every(([fn, action]) => fn === 'seasonalAuthorityApi' && ['capabilities', 'listSnapshots', 'createSnapshot'].includes(action)));
    assert.doesNotMatch(await page.locator('body').textContent(), /SYNTHETIC_PRIVATE/);
    assert.equal(await page.evaluate(() => window.backupTest.getUnexpected()), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    console.log('PASS ' + mode);
  } finally {
    await context.close();
  }
}

async function main() {
  const executablePath = process.env.SHIFTLY_CHROMIUM
    || (existsSync(chromium.executablePath()) ? undefined : '/usr/bin/chromium');
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  try {
    for (const mode of ['initial-list', 'list-refresh', 'audit-refresh']) await runScenario(browser, mode);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
