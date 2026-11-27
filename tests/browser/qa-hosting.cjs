const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fixtureUrl, openPage } = require('./harness.cjs');

const projectId = 'shiftly-t-test';
const authDomain = `${projectId}.firebaseapp.com`;
const databaseId = 'shiftly-qa-v1';
const region = 'asia-northeast1';
const origin = `https://${projectId}.web.app`;
const publicConfig = {
  projectId,
  authDomain,
  apiKey: 'AIza' + 'A'.repeat(35),
  appId: '1:1234567890:web:0123abcd',
  messagingSenderId: '1234567890',
};

function stageQaBuild(context) {
  const repository = path.resolve(__dirname, '../..');
  const inputs = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftly-qa-browser-'));
  context.after(() => fs.rmSync(inputs, { recursive: true, force: true }));
  const config = path.join(inputs, 'web.json');
  const siteKey = path.join(inputs, 'app-check-key');
  const out = path.join(inputs, 'build');
  fs.writeFileSync(config, JSON.stringify(publicConfig));
  fs.writeFileSync(siteKey, 'fixture-qa-app-check-key');
  execFileSync(
    process.execPath,
    ['tools/stage-qa-hosting.mjs', '--config', config, '--site-key-file', siteKey, '--out', out],
    { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return path.join(out, 'public');
}

async function assertQaConnections(page, { staff, callableNames, requests }) {
  const observed = await page.evaluate(async (url) => {
    const { fixture } = await import(url);
    return {
      connections: fixture.connectionLog,
      requests: fixture.callLog.map(({ name, request }) => [name, request.action ?? request.kind]),
      directWrites: fixture.directWrites.length,
    };
  }, fixtureUrl);

  assert.deepEqual(
    observed.connections.filter(({ method }) => method === 'initializeApp'),
    [{ method: 'initializeApp', projectId, authDomain }],
  );
  assert.deepEqual(
    observed.connections.filter(({ method }) => method === 'initializeAppCheck'),
    [{ method: 'initializeAppCheck', projectId }],
  );
  assert.deepEqual(
    observed.connections.filter(({ method }) => method === 'getAuth'),
    staff ? [{ method: 'getAuth', projectId }] : [],
  );
  assert.deepEqual(
    observed.connections.filter(({ method }) => method === 'getFirestore'),
    staff ? [{ method: 'getFirestore', projectId, databaseId }] : [],
  );
  assert.deepEqual(
    observed.connections
      .filter(({ method }) => method === 'httpsCallable')
      .sort((a, b) => a.name.localeCompare(b.name)),
    [...callableNames]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({
        method: 'httpsCallable',
        projectId,
        region,
        name,
      })),
  );
  assert.deepEqual(observed.requests, requests);
  assert.equal(observed.directWrites, 0);
}

async function qaHosting(browser, server, context) {
  const { page, close } = await openPage(
    browser,
    server,
    { viewport: { width: 1200, height: 900 } },
    { origin, assetRoot: stageQaBuild(context) },
  );
  try {
    await page.goto(origin);
    await page.locator('#loginForm').waitFor();
    assert.equal(await page.locator('#rankingButton').isHidden(), true);
    await page.evaluate(async (url) => {
      const { fixture } = await import(url);
      fixture.setRecords({
        'users/teacher': { role: 'employee', name: '試験講師' },
        'systemConfig/maintenance': { enabled: false },
      });
      fixture.handleCallable('qaRankingReadApi', ({ kind }) => {
        if (kind !== 'month') throw new Error('Unexpected QA ranking query');
        return {
          period: '2026年11月',
          coverage: { complete: false, recorded: 10, expected: 11 },
          rows: [],
        };
      });
      fixture.handleCallable('qaRankingAchievementApi', ({ action }) => {
        if (action !== 'listHistory') throw new Error('Unexpected QA achievement action');
        return { history: [], nextCursor: null };
      });
    }, fixtureUrl);
    await page.locator('#email').fill('teacher@example.invalid');
    await page.locator('#password').fill('browser-test-only');
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#appPanel').waitFor();
    await page.locator('#rankingButton').click();
    const ranking = page.locator('#rankingDialog');
    await ranking.getByText('未確定の日付があります。確定済み 10 / 11 日', { exact: true }).waitFor();
    await ranking.getByRole('button', { name: '表彰履歴', exact: true }).click();
    await page.waitForFunction(async (url) => {
      const { fixture } = await import(url);
      return fixture.callLog.some(({ name }) => name === 'qaRankingAchievementApi');
    }, fixtureUrl);
    assert.equal(await ranking.getByRole('button', { name: 'バッジ管理' }).count(), 0);
    await assertQaConnections(page, {
      staff: true,
      callableNames: [
        'qaBookingAdminApi',
        'qaNormalAuthorityApi',
        'qaSeasonalAuthorityApi',
        'qaRankingReadApi',
        'qaRankingAchievementApi',
      ],
      requests: [
        ['qaRankingReadApi', 'month'],
        ['qaRankingAchievementApi', 'listHistory'],
      ],
    });

    await page.goto(`${origin}/course-booking-admin.html`);
    await page.getByRole('heading', { name: 'ログインが必要です' }).waitFor();
    await page.evaluate(async (url) => {
      const { fixture } = await import(url);
      fixture.setRecords({
        'users/admin': { role: 'admin', name: '試験管理者' },
        'users/teacher': { role: 'employee', name: '試験講師' },
      });
      fixture.handleCallable('qaBookingAdminApi', ({ action }) => {
        if (action !== 'courses') throw new Error('Unexpected QA admin booking action');
        return { courses: [] };
      });
      fixture.setUser('teacher');
    }, fixtureUrl);
    await page.getByRole('heading', { name: '管理者のみ利用できます' }).waitFor();
    await assertQaConnections(page, { staff: true, callableNames: ['qaBookingAdminApi'], requests: [] });
    await page.evaluate(async (url) => (await import(url)).fixture.setUser('admin'), fixtureUrl);
    await page.getByRole('heading', { name: '講習が登録されていません' }).waitFor();
    await assertQaConnections(page, {
      staff: true,
      callableNames: ['qaBookingAdminApi'],
      requests: [['qaBookingAdminApi', 'courses']],
    });

    const qr = new URLSearchParams({ c: 'qa-fixture-course', s: 'qa-fixture-student', t: 'x'.repeat(42) });
    await page.goto(`${origin}/course-booking.html#${qr}`);
    await page.locator('#nameInput').waitFor();
    await page.evaluate(async (url) => {
      const { fixture } = await import(url);
      fixture.handleCallable('qaBookingPublicApi', ({ action }) => {
        if (action !== 'view') throw new Error('Unexpected QA public booking action');
        return {
          phase: 'open',
          course: { name: '試験講習', startDate: '2026-11-12', endDate: '2026-11-12', periods: [] },
          booking: { status: 'unanswered' },
          slots: [],
        };
      });
    }, fixtureUrl);
    await page.locator('#nameInput').fill('試験生徒');
    await page.locator('#nameForm button').click();
    await page.locator('[data-act="join"]').waitFor();
    await assertQaConnections(page, {
      staff: false,
      callableNames: ['qaBookingPublicApi'],
      requests: [['qaBookingPublicApi', 'view']],
    });
  } finally {
    await close();
  }
}

module.exports = { qaHosting };
