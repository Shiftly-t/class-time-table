const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const qa = require('./qa-firebase-fixture.cjs');

const sourceDir = path.resolve(process.argv[2] || path.join(__dirname, '../production-hosting'));
const origin = 'https://shiftly.invalid';
const timeout = 4000;
const productionProjectId = 'shiftly-production-fixture';
const productionConfigModule = `export const firebaseConfig = { projectId: '${productionProjectId}' };`;

const firebaseModules = {
  'firebase-app.js': 'export const initializeApp = config => config;',
  'firebase-auth.js': `
    export const getAuth = () => ({});
    export const onAuthStateChanged = (_, handler) => window.bookingTest.watchAuth(handler);
  `,
  'firebase-firestore.js': `
    export const getFirestore = (app, databaseId) => {
      window.bookingTest.firestoreTargets.push([app.projectId,databaseId ?? null]);
      return {};
    };
    export const doc = (_, ...parts) => parts;
    export const getDoc = async () => ({ exists: () => true, data: () => ({ role: 'admin' }) });
  `,
  'firebase-functions.js': `
    export const getFunctions = (app, region) => {
      window.bookingTest.functionsTargets.push([app.projectId,region]);
      return {};
    };
    export const httpsCallable = (_, name) => {
      window.bookingTest.callableNames.push(name);
      return fields => window.bookingTest.call(name, fields);
    };
  `,
  'firebase-app-check.js': `
    export const initializeAppCheck = () => {};
    export class ReCaptchaEnterpriseProvider {}
  `,
};

const publicFixtureFiles = new Set([
  'course-booking-admin.html', 'course-booking-admin.js', 'booking.css', 'booking-transport.js', 'firebase-target.js',
  'course-booking.html', 'course-booking.js',
]);

function installFixtures(initialFailure) {
  const courseA = { id: 'course-a', name: 'テスト講習A', startDate: '2026-12-01', endDate: '2026-12-02', periods: [] };
  const courseB = { id: 'course-b', name: 'テスト講習B', startDate: '2026-12-03', endDate: '2026-12-04', periods: [] };
  const courseC = { id: 'course-c', name: 'テスト講習C', startDate: '2026-12-05', endDate: '2026-12-06', periods: [] };
  const courses = [courseA, courseB, courseC];
  const student = (id, name) => ({ id, name, grade: '中2', status: 'unanswered', wishes: 0, confirmed: 0 });
  const a1 = student('student-a1', 'テスト生徒A1');
  const a2 = student('student-a2', 'テスト生徒A2');
  const a3 = student('student-a3', 'テスト生徒A3');
  const b1 = student('student-b1', 'テスト生徒B1');
  const rosters = { 'course-a': [a1, a2, a3], 'course-b': [b1], 'course-c': [] };
  const calls = [];
  let authHandler;
  let account = { uid: 'fixture-admin-1' };
  let nextFailure = initialFailure;
  let nextResponse;
  let deferred;

  const matches = (fields, criterion) =>
    criterion && Object.entries(criterion).every(([key, value]) => fields[key] === value);

  window.bookingTest = {
    calls,
    firestoreTargets:[],
    functionsTargets:[],
    callableNames:[],
    fail: (criterion, error) => { nextFailure = { criterion, error }; },
    reply: (criterion, data) => { nextResponse = { criterion, data }; },
    hold: criterion => { deferred = { criterion }; },
    waiting: () => Boolean(deferred?.release),
    finish: error => {
      if (!deferred?.release) throw Error('Fixture request is not waiting');
      const release = deferred.release;
      deferred = undefined;
      release(error);
    },
    watchAuth: handler => {
      authHandler = handler;
      void handler(account);
    },
    changeAccount: uid => {
      account = uid ? { uid } : null;
      void authHandler(account);
    },
    async call(callableName, fields) {
      calls.push({ ...fields, actor: account?.uid, callableName });
      let error;
      if (matches(fields, nextFailure?.criterion)) {
        error = nextFailure.error || {};
        nextFailure = undefined;
      }
      if (matches(fields, deferred?.criterion)) {
        error = await new Promise(resolve => { deferred.release = resolve; });
      }
      if (error) {
        const message = typeof error === 'string' ? error : error.message;
        throw Object.assign(Error(message || 'テスト用の取得エラー'), {
          code: error.code || 'functions/unavailable',
          details: error.details,
        });
      }
      if (matches(fields, nextResponse?.criterion)) {
        const { data } = nextResponse;
        nextResponse = undefined;
        return { data: structuredClone(data) };
      }

      const { action, courseId, studentId } = fields;
      const row = rosters[courseId]?.find(item => item.id === studentId);
      const responses = {
        courses: { courses },
        getSettings: { course: courses.find(item => item.id === courseId), settings: { enabled: true } },
        roster: { rows: rosters[courseId] },
        slotDemand: { slots: [] },
        teachers: { teachers: [] },
        detail: { student: row, booking: { wishes: [], confirmed: [] }, history: [] },
        getQr: { studentId, courseId, studentName: row?.name, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
        adminDecline: { ok: true },
        view: { course: courseA, booking: { status: 'unanswered' }, phase: 'open', slots: [] },
      };
      if (!Object.hasOwn(responses, action)) throw Error('Unexpected synthetic callable action: ' + action);
      return { data: structuredClone(responses[action]) };
    },
  };
}

async function serveOffline(route, blocked, configModule=qa.configModule, production=false) {
  const url = new URL(route.request().url());
  const name = path.posix.basename(url.pathname);
  const javascript = body => route.fulfill({
    contentType: 'text/javascript',
    headers: { 'access-control-allow-origin': '*' },
    body,
  });

  if (url.origin === 'https://www.gstatic.com' &&
      /^\/firebasejs\/[^/]+\//.test(url.pathname) && Object.hasOwn(firebaseModules, name)) {
    return javascript(firebaseModules[name]);
  }
  if (url.origin === origin && url.pathname === '/' + name) {
    if (name === 'config.js') return javascript(configModule);
    if (name === 'booking-config.js') return javascript(qa.bookingConfigModule);
    if (name === 'favicon.ico') return route.fulfill({ status: 204 });
    if (publicFixtureFiles.has(name)) {
      const body = await readFile(path.join(sourceDir, name), 'utf8');
      if (name.endsWith('.js')) return javascript(body);
      return route.fulfill(name.endsWith('.html')
        ? { contentType: 'text/html', body: production ? body : body.replace('data-shiftly-environment="production"', 'data-shiftly-environment="qa"') }
        : { contentType: 'text/css', body });
    }
  }
  blocked.push(url.origin + url.pathname);
  return route.abort('blockedbyclient');
}

const action = (page, name) => page.locator(`[data-act="${name}"]`);

async function waitForStudent(page, name) {
  await page.locator('#studentDetail h2').filter({ hasText: name }).waitFor();
}

async function waitForCourse(page, id) {
  await page.waitForFunction(id => {
    const select = document.querySelector('#courseSelect');
    return select?.value === id && !select.disabled;
  }, id);
}

async function selectStudent(page, id, name) {
  await action(page, 'student:' + id).click();
  await waitForStudent(page, name);
}

async function closeNotice(page) {
  await page.locator('#bookingNotice[open] #bookingNoticeClose').click();
}

async function assertNoMutation(page) {
  const calls = await page.evaluate(() => window.bookingTest.calls);
  const reads = new Set(['courses', 'getSettings', 'roster', 'slotDemand', 'teachers', 'detail', 'getQr']);
  assert.deepEqual(calls.filter(call => !reads.has(call.action)), []);
}

async function assertCourseA(page) {
  assert.equal(await page.locator('#courseSelect').inputValue(), 'course-a');
  assert.equal(await action(page, 'student:student-a1').count(), 1);
  assert.equal(await action(page, 'student:student-b1').count(), 0);
  assert.match(await page.locator('#studentDetail h2').textContent(), /テスト生徒A1/);
}

async function courseSelection(page) {
  await selectStudent(page, 'student-a1', 'テスト生徒A1');
  await page.evaluate(() => window.bookingTest.fail({ action: 'roster', courseId: 'course-b' }));
  await page.locator('#courseSelect').selectOption('course-b');
  await page.locator('#bookingNotice[open]').waitFor();
  await assertCourseA(page);
  await closeNotice(page);

  await page.evaluate(() => window.bookingTest.hold({ action: 'roster', courseId: 'course-b' }));
  await page.locator('#courseSelect').selectOption('course-b');
  await page.waitForFunction(() => window.bookingTest.waiting());
  await assertCourseA(page);
  assert.equal(await action(page, 'adminDecline').isDisabled(), true);
  await assert.rejects(page.locator('#courseSelect').selectOption('course-c', { timeout: 250 }), { name: 'TimeoutError' });
  assert.equal(await page.evaluate(() => window.bookingTest.calls.some(call => call.courseId === 'course-c')), false);
  await assertNoMutation(page);
  await page.evaluate(() => window.bookingTest.finish());
  await waitForCourse(page, 'course-b');
  assert.equal(await action(page, 'student:student-b1').count(), 1);
  assert.equal(await action(page, 'student:student-a1').count(), 0);
  assert.equal(await page.locator('#studentDetail').count(), 0);
  await assertNoMutation(page);
}

async function studentSelection(page) {
  await selectStudent(page, 'student-a1', 'テスト生徒A1');
  await page.evaluate(() => window.bookingTest.fail({ action: 'detail', studentId: 'student-a2' }));
  await action(page, 'student:student-a2').click();
  await page.locator('#bookingNotice[open]').waitFor();
  await assertCourseA(page);
  await closeNotice(page);
  await action(page, 'getQr').click();
  await page.locator('#printReadyWrap').waitFor();
  const qrCalls = await page.evaluate(() => window.bookingTest.calls
    .filter(call => call.action === 'getQr').map(call => [call.courseId, call.studentId]));
  assert.deepEqual(qrCalls, [['course-a', 'student-a1']]);

  await page.evaluate(() => window.bookingTest.hold({ action: 'detail', studentId: 'student-a2' }));
  await action(page, 'student:student-a2').click();
  await page.waitForFunction(() => window.bookingTest.waiting());
  await assertCourseA(page);
  assert.equal(await action(page, 'adminDecline').isDisabled(), true);
  await assert.rejects(action(page, 'student:student-a3').click({ timeout: 250 }), { name: 'TimeoutError' });
  assert.equal(await page.evaluate(() => window.bookingTest.calls.some(call => call.studentId === 'student-a3')), false);
  await assertNoMutation(page);
  await page.evaluate(() => window.bookingTest.finish());
  await waitForStudent(page, 'テスト生徒A2');
  await assertNoMutation(page);
}

async function confirmAfterAccountChange(page) {
  await selectStudent(page, 'student-a1', 'テスト生徒A1');
  await action(page, 'adminDecline').click();
  await page.locator('#askDialog[open]').waitFor();
  await page.evaluate(() => window.bookingTest.changeAccount(null));
  await page.getByRole('heading', { name: 'ログインが必要です' }).waitFor();
  assert.equal(await page.locator('#askDialog[open]').count(), 0);
  await assertNoMutation(page);

  await page.evaluate(() => window.bookingTest.changeAccount('fixture-admin-2'));
  await waitForCourse(page, 'course-a');
  await selectStudent(page, 'student-a2', 'テスト生徒A2');
  await action(page, 'adminDecline').click();
  await page.locator('#askDialog[open]').waitFor();
  await page.evaluate(() => window.bookingTest.changeAccount('fixture-admin-3'));
  await waitForCourse(page, 'course-a');
  assert.equal(await page.locator('#askDialog[open]').count(), 0);
  assert.equal(await page.locator('#studentDetail').count(), 0);
  await assertNoMutation(page);

  await selectStudent(page, 'student-a3', 'テスト生徒A3');
  await action(page, 'adminDecline').click();
  await page.locator('#askDialog[open]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#askDialog[open]').waitFor({ state: 'detached' });
  await assertNoMutation(page);

  await action(page, 'adminDecline').click();
  await page.locator('#askDialog[open]').waitFor();
  await page.locator('#askDialog').evaluate(dialog => dialog.close());
  await page.locator('#askDialog[open]').waitFor({ state: 'detached' });
  await assertNoMutation(page);

  await action(page, 'adminDecline').click();
  await page.locator('#askDialog[open] #askYes').click();
  await page.locator('#bookingNotice[open]').waitFor();
  assert.equal(await page.locator('#bookingNoticeTitle').textContent(), '保存が完了しました');
  const calls = await page.evaluate(() => window.bookingTest.calls);
  const mutations = calls.filter(call => call.action === 'adminDecline');
  assert.equal(mutations.length, 1);
  const [{ actor, courseId, studentId }] = mutations;
  assert.deepEqual({ actor, courseId, studentId }, {
    actor: 'fixture-admin-3', courseId: 'course-a', studentId: 'student-a3',
  });
}

async function ignorePreviousAccountResponse(page) {
  await selectStudent(page, 'student-a1', 'テスト生徒A1');
  await page.evaluate(() => window.bookingTest.hold({ action: 'detail', studentId: 'student-a2' }));
  await action(page, 'student:student-a2').click();
  await page.waitForFunction(() => window.bookingTest.waiting());
  await page.evaluate(() => window.bookingTest.changeAccount('fixture-admin-2'));
  await waitForCourse(page, 'course-a');
  await selectStudent(page, 'student-a1', 'テスト生徒A1');
  await page.evaluate(async () => {
    window.bookingTest.finish();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await assertCourseA(page);
  assert.equal(await page.locator('#bookingNotice[open]').count(), 0);
  await assertNoMutation(page);
}

async function assertDiagnostic(page, expected) {
  const notice = page.locator('#bookingNotice[open] #bookingNoticeText');
  await notice.waitFor();
  assert.equal(await notice.textContent(), expected);
  assert.equal(await page.locator('#feedback').textContent(), expected);
  const text = await page.locator('body').textContent();
  assert.doesNotMatch(text, /SYNTHETIC_PRIVATE|Coordinated deployment has not been activated|Verified App Check required/);
  assert.equal(await page.locator('#bookingResultCheck').count(), 0);
}

const initialActivationFailure = {
  criterion: { action: 'courses' },
  error: {
    code: 'functions/failed-precondition',
    message: 'Coordinated deployment has not been activated',
    details: { diagnostic: 'SYNTHETIC_PRIVATE_DETAIL' },
  },
};

async function inactiveCoordination(page) {
  await assertDiagnostic(page, '講習一覧の取得：本番の連携機能が有効化されていません。運営に確認してください。');
  assert.equal(await page.locator('#courseSelect').count(), 0);
  const actions = await page.evaluate(() => window.bookingTest.calls.map(call => call.action));
  assert.deepEqual(actions, ['courses']);
}

async function diagnoseCourseReadFailures(page) {
  await selectStudent(page, 'student-a1', 'テスト生徒A1');
  await page.evaluate(() => window.bookingTest.fail(
    { action: 'getSettings', courseId: 'course-b' },
    { code: 'functions/failed-precondition', message: 'SYNTHETIC_PRIVATE_MESSAGE' },
  ));
  await page.locator('#courseSelect').selectOption('course-b');
  await assertDiagnostic(page, '受付設定の取得：操作に必要な条件を満たしていません。運営に確認してください。');
  await assertCourseA(page);
  await closeNotice(page);

  await page.evaluate(() => window.bookingTest.reply(
    { action: 'roster', courseId: 'course-b' },
    { rows: 'SYNTHETIC_PRIVATE_MALFORMED_ROSTER' },
  ));
  await page.locator('#courseSelect').selectOption('course-b');
  await assertDiagnostic(page, '生徒一覧の取得：予約APIの応答形式を確認できません。運営に確認してください。');
  await assertCourseA(page);
  await closeNotice(page);

  await page.evaluate(() => window.bookingTest.fail(
    { action: 'teachers', courseId: 'course-b' },
    { code: 'functions/failed-precondition', message: 'Verified App Check required' },
  ));
  await page.locator('#courseSelect').selectOption('course-b');
  await assertDiagnostic(page, '講師情報の取得：アプリの認証（App Check）を確認できません。ページを開き直してください。');
  await assertCourseA(page);
  await assertNoMutation(page);
}

async function verifyQrEntry(browser, {invalidDatabase=false, production=false}={}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const blocked = [];
  const errors = [];
  try {
    const configModule = production ? productionConfigModule
      : invalidDatabase ? qa.configModule.replace(qa.databaseId,'(default)') : qa.configModule;
    await context.addInitScript(installFixtures);
    await context.route('**/*', route => serveOffline(route, blocked, configModule, production));
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.on('pageerror', error => errors.push(error.message));
    const entry = invalidDatabase ? 'course-booking-admin.html' : 'course-booking.html';
    const url = origin + '/' + entry;
    await page.goto(url);
    if (invalidDatabase) {
      await page.getByText('指定のFirebase設定またはQAデータベースを確認できないため、接続を停止しました。',{exact:false}).waitFor();
      assert.equal(errors.length, 1);
    } else {
      await page.getByRole('heading',{name:'QRコードが確認できません'}).waitFor();
      assert.deepEqual(await page.evaluate(() => window.bookingTest.calls), []);
      await page.goto(`${url}#c=course-a&s=student-a1&t=${'a'.repeat(42)}`);
      await page.reload();
      await page.locator('#nameInput').fill('テスト生徒A1');
      await page.getByRole('button',{name:'確認して次へ'}).click();
      await page.getByRole('heading',{name:'講習への参加について'}).waitFor();
      assert.deepEqual(errors, []);
    }
    const targets = await page.evaluate(() => ({
      firestore:window.bookingTest.firestoreTargets,
      functions:window.bookingTest.functionsTargets,
      names:window.bookingTest.callableNames,
      calls:window.bookingTest.calls.map(({callableName,action}) => [callableName,action]),
    }));
    const projectId = production ? productionProjectId : qa.projectId;
    const expectedName = production ? 'bookingPublicApi' : 'qaBookingPublicApi';
    assert.deepEqual(targets,invalidDatabase
      ? {firestore:[],functions:[],names:[],calls:[]}
      : {firestore:[],functions:[[projectId,qa.region]],names:[expectedName],calls:[[expectedName,'view']]});
    assert.deepEqual(blocked,[]);
    console.log('PASS ' + (invalidDatabase?'rejectWrongQaDatabaseBeforeSdk':production?'publicQrUsesProductionFunctions':'publicQrUsesQaFunctions'));
  } finally {
    await context.close();
  }
}

async function main() {
  const systemChromium = '/usr/bin/chromium';
  const executablePath = process.env.SHIFTLY_CHROMIUM
    || (existsSync(chromium.executablePath()) ? undefined : systemChromium);
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  try {
    const scenarios = [
      { run: courseSelection },
      { run: studentSelection },
      { run: confirmAfterAccountChange },
      { run: ignorePreviousAccountResponse },
      { run: inactiveCoordination, initialFailure: initialActivationFailure },
      { run: diagnoseCourseReadFailures },
      { run: async function bookingAdminUsesProductionFunctions(page) { await assertNoMutation(page); }, production:true },
    ];
    for (const { run, initialFailure, production=false } of scenarios) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const blocked = [];
      const errors = [];
      try {
        await context.addInitScript(installFixtures, initialFailure);
        await context.route('**/*', route => serveOffline(route, blocked, production ? productionConfigModule : qa.configModule, production));
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/course-booking-admin.html');
        if (!initialFailure) await waitForCourse(page, 'course-a');
        await run(page);
        const targets = await page.evaluate(() => ({
          firestore:window.bookingTest.firestoreTargets,
          functions:window.bookingTest.functionsTargets,
          names:window.bookingTest.callableNames,
          calls:window.bookingTest.calls.map(call => call.callableName),
        }));
        const projectId = production ? productionProjectId : qa.projectId;
        const expectedName = production ? 'bookingAdminApi' : 'qaBookingAdminApi';
        assert.deepEqual(targets.firestore, [[projectId,production ? null : qa.databaseId]]);
        assert.deepEqual(targets.functions, [[projectId,qa.region]]);
        assert.deepEqual(targets.names, [expectedName]);
        assert.ok(targets.calls.length > 0 && targets.calls.every(name => name === expectedName));
        assert.deepEqual(blocked, [], 'No fixture requested an external resource');
        assert.deepEqual(errors, [], 'No unhandled browser error');
        console.log('PASS ' + run.name);
      } finally {
        await context.close();
      }
    }
    await verifyQrEntry(browser);
    await verifyQrEntry(browser,{invalidDatabase:true});
    await verifyQrEntry(browser,{production:true});
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
