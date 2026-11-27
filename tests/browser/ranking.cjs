const assert = require('node:assert/strict');
const { fixtureUrl } = require('./harness.cjs');

async function mountRanking(page, server) {
  const url = `${server.origin}/_tests/ranking.html`;
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html>
        <html lang="ja">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="stylesheet" href="/style.css">
            <link rel="stylesheet" href="/ranking-live.css">
          </head>
          <body>
            <button id="rankingButton" type="button" hidden>講師ランキングを開く</button>
            <dialog id="rankingDialog" aria-label="講師ランキング">
              <div id="rankingHost" class="ranking-shell"></div>
            </dialog>
          </body>
        </html>`,
    }),
  );
  await page.goto(url);
  await page.evaluate(async (fixtureUrl) => {
    // Mount the actual presentation module on localhost. The main app's production-only gate is unchanged.
    const { fixture, httpsCallable } = await import(fixtureUrl);
    const { installRankingLive } = await import('/ranking-live.js');
    let session;
    let role;
    let maintenance = false;
    const complete = { complete: true, recorded: 30, expected: 30 };
    const stats = { slots: 12, regular: 8, seasonal: 4, days: 5, students: 3 };
    const teachers = [
      { teacherUid: 'teacher', name: '試験用講師' },
      { teacherUid: 'other', name: '別の講師' },
    ];
    const badges = [
      { badgeId: 'first', name: '協力バッジ', color: '#c89c38', icon: '🤝', active: true },
      { badgeId: 'second', name: '継続バッジ', color: '#238c74', icon: '⭐', active: true },
    ];
    let profileBadges = badges.map((badge) => ({
      ...badge,
      teacherUid: 'teacher',
      recordId: 'earned-' + badge.badgeId,
      source: 'manual',
      awardedAt: '2026-10-20T04:00:00Z',
    }));
    const rules = [];
    const grants = [];
    const history = {
      teacherName: '試験用講師',
      kind: 'month',
      key: '2026-10',
      metric: 'slots',
      rank: 1,
      name: '月間表彰',
      action: 'granted',
      at: '2026-11-05T04:00:00Z',
    };

    fixture.handleCallable('rankingReadApi', ({ kind, key, teacherUid }) => {
      if (kind === 'profile') {
        const teacher = teachers.find((person) => person.teacherUid === (teacherUid || session));
        return {
          profile: { ...teacher, totals: stats, monthly: [{ ...stats, key: '2026-10' }] },
          coverage: complete,
        };
      }
      if (kind !== 'month') throw new Error('Unexpected ranking period');
      return {
        period: key === '2026-10' ? '2026年10月' : '2026年11月',
        coverage: key === '2026-10' ? { ...complete, complete: false, recorded: 28 } : complete,
        rows: teachers.map((teacher, i) => ({ ...teacher, ...stats, rank: i + 1 })),
      };
    });
    fixture.handleCallable('rankingAchievementApi', (request) => {
      switch (request.action) {
        case 'listBadges':
          return { badges: (request.teacherUid || session) === 'teacher' ? profileBadges : [] };
        case 'listHistory':
          return request.cursor
            ? { history: [{ ...history, key: '2026-09', name: '前月の表彰' }], nextCursor: null }
            : { history: [history], nextCursor: 'previous-page' };
        case 'saveBadgeOrder':
          if (session !== 'teacher') throw new Error('Unexpected order editor access');
          profileBadges = request.recordIds.map((id) => profileBadges.find((badge) => badge.recordId === id));
          return { state: 'committed' };
      }

      if (role !== 'owner') throw new Error('Unexpected badge management access');
      const { action, operationId, ...data } = request;
      switch (action) {
        case 'manage':
          return { badges, rules, teachers, grants, manualHistory: [] };
        case 'saveManualBadge':
          badges.push(data);
          break;
        case 'saveAutomaticRule':
          rules.push(data);
          break;
        case 'grantManualBadges':
          grants.push(...request.teacherUids.map((teacherUid) => ({ badgeId: request.badgeId, teacherUid })));
          break;
        case 'revokeManualBadges':
          for (const teacherUid of request.teacherUids) {
            const index = grants.findIndex(
              (grant) => grant.badgeId === request.badgeId && grant.teacherUid === teacherUid,
            );
            if (index >= 0) grants.splice(index, 1);
          }
          break;
        default:
          throw new Error('Unexpected ranking achievement action: ' + action);
      }
      return { state: 'committed' };
    });

    const ranking = installRankingLive({
      trigger: document.getElementById('rankingButton'),
      dialog: document.getElementById('rankingDialog'),
      host: document.getElementById('rankingHost'),
      call: httpsCallable(null, 'rankingReadApi'),
      callAchievement: httpsCallable(null, 'rankingAchievementApi'),
      getSession: () => session,
      getRole: () => role,
      getAvailable: () => !maintenance || role === 'owner',
      today: () => '2026-11-12',
    });
    window.setRankingSession = (next) => {
      ({ session, role, maintenance = false } = next);
      ranking.sync();
    };
  }, fixtureUrl);
}

function setSession(page, session, role, maintenance = false) {
  return page.evaluate((next) => window.setRankingSession(next), { session, role, maintenance });
}

async function calls(page, name) {
  return page.evaluate(
    async ({ fixtureUrl, name }) => {
      const { fixture } = await import(fixtureUrl);
      return fixture.callLog.filter((call) => call.name === name).map((call) => call.request);
    },
    { fixtureUrl, name },
  );
}

function assertOperation(request, expected) {
  const { operationId, ...data } = request;
  assert.match(operationId, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
  assert.deepEqual(data, expected);
}

async function ranking({ page, server }) {
  await mountRanking(page, server);
  const trigger = page.locator('#rankingButton');
  const dialog = page.locator('#rankingDialog');
  const control = (name, host = dialog) => host.getByRole('button', { name, exact: true });
  const combo = (name, host) => host.getByRole('combobox', { name, exact: true });
  const heading = (name) => dialog.getByRole('heading', { name, exact: true });
  const achievementCalls = () => calls(page, 'rankingAchievementApi');

  assert.equal(await trigger.isHidden(), true);
  await setSession(page, 'unknown', 'unknown');
  assert.equal(await trigger.isHidden(), true);
  assert.deepEqual(await calls(page, 'rankingReadApi'), []);

  await setSession(page, 'teacher', 'employee');
  await trigger.click();
  await heading('2026年11月 · 担当授業コマ数（延べ）').waitFor();
  assert.equal(await control('バッジ管理').count(), 0);

  const periodPicker = dialog.locator('#rankingPeriodPickerPanel');
  await control('対象期間：2026年11月').click();
  assert.equal(await control('12月', periodPicker).isDisabled(), true);
  await control('10月', periodPicker).click();
  await dialog.getByText('未確定の日付があります。確定済み 28 / 30 日', { exact: true }).waitFor();
  assert.equal(await dialog.locator('.ranking-podium-person').count(), 0);
  await control('対象期間：2026年10月').click();
  await control('11月', periodPicker).click();
  await heading('2026年11月 · 担当授業コマ数（延べ）').waitFor();

  await control('ランキング部門：担当授業コマ数（延べ）').click();
  await control('授業担当日数', dialog.locator('#rankingMetricPickerPanel')).click();
  await heading('2026年11月 · 授業担当日数').waitFor();
  assert.equal(await control('ランキング部門：授業担当日数').getAttribute('aria-expanded'), 'false');
  assert.equal(await dialog.locator('.ranking-count').first().textContent(), '5 日');
  assert.deepEqual(await calls(page, 'rankingReadApi'), [
    { kind: 'month', key: '2026-11', metric: 'slots' },
    { kind: 'month', key: '2026-10', metric: 'slots' },
    { kind: 'month', key: '2026-11', metric: 'slots' },
    { kind: 'month', key: '2026-11', metric: 'days' },
  ]);

  await dialog.locator('.ranking-podium-person').filter({ hasText: '別の講師' }).click();
  await heading('別の講師').waitFor();
  assert.equal(await control('並び替え').count(), 0);
  await control('プロフィール').click();
  await heading('試験用講師').waitFor();
  await control('並び替え').click();
  await control('継続バッジを上へ').click();
  await control('並び順を保存').click();
  await dialog.getByText('並び順を保存しました。', { exact: true }).waitFor();
  assert.deepEqual(await dialog.locator('#rankingProfileBadgeGallery strong').allTextContents(), [
    '継続バッジ',
    '協力バッジ',
  ]);
  assertOperation(
    (await achievementCalls()).find((request) => request.action === 'saveBadgeOrder'),
    {
      action: 'saveBadgeOrder',
      recordIds: ['earned-second', 'earned-first'],
    },
  );

  await control('表彰履歴').click();
  await dialog.getByText('月間表彰', { exact: true }).waitFor();
  await control('過去の表彰をさらに表示').click();
  await dialog.getByText('前月の表彰', { exact: true }).waitFor();
  assert.deepEqual(await dialog.locator('.ranking-achievement strong').allTextContents(), [
    '月間表彰',
    '前月の表彰',
  ]);

  await setSession(page, 'teacher', 'employee', true);
  assert.equal(await trigger.isHidden(), true);
  assert.equal(await dialog.isHidden(), true);
  assert.equal(await page.locator('#rankingHost').textContent(), '');

  await setSession(page, 'admin', 'admin');
  await trigger.click();
  await heading('2026年11月 · 担当授業コマ数（延べ）').waitFor();
  assert.equal(await control('バッジ管理').count(), 0);
  await setSession(page, 'admin', 'admin', true);
  assert.equal(await trigger.isHidden(), true);
  assert.equal(await dialog.isHidden(), true);

  await setSession(page, 'owner', 'owner', true);
  await trigger.click();
  await control('バッジ管理').click();
  await heading('バッジ・表彰を作成・編集').waitFor();
  const builder = dialog.locator('.ranking-badge-builder');
  await builder.getByLabel('バッジ名称', { exact: true }).fill('新しい手動バッジ');
  await builder.getByLabel('バッジの説明', { exact: true }).fill('試験用の説明');
  await control('バッジを保存する', builder).click();
  await dialog.getByText('手動バッジを保存しました。', { exact: true }).waitFor();
  const manual = (await achievementCalls()).find((request) => request.action === 'saveManualBadge');
  assert.match(manual.badgeId, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
  assertOperation(manual, {
    action: 'saveManualBadge',
    badgeId: manual.badgeId,
    name: '新しい手動バッジ',
    description: '試験用の説明',
    color: '#c89c38',
    icon: '🥇',
    active: true,
  });

  await combo('付与方法', builder).selectOption('rule');
  await builder.getByLabel('バッジ名称', { exact: true }).fill('試験用自動表彰');
  await combo('種類', builder).selectOption('award');
  assert.equal(await combo('付与条件', builder).inputValue(), 'rank');
  assert.equal(
    await combo('対象期間', builder)
      .locator('option[value=all]')
      .evaluate((option) => option.disabled),
    true,
  );
  await builder.getByLabel('基準値', { exact: true }).fill('3');
  await control('自動ルールを保存する', builder).click();
  await dialog.getByText('自動ルールを保存しました。', { exact: true }).waitFor();
  const automatic = (await achievementCalls()).find((request) => request.action === 'saveAutomaticRule');
  assert.match(automatic.ruleId, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
  assertOperation(automatic, {
    action: 'saveAutomaticRule',
    ruleId: automatic.ruleId,
    name: '試験用自動表彰',
    description: '',
    color: '#c89c38',
    icon: '🥇',
    active: false,
    category: 'award',
    kind: 'month',
    metric: 'slots',
    criterion: 'rank',
    value: 3,
  });

  const grantForm = dialog
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: '講師への一括付与・取消', exact: true }) });
  await combo('選択方法', grantForm).selectOption('teacher');
  await combo('対象講師', grantForm).selectOption('teacher');
  const choice = (badge) =>
    grantForm.locator('.ranking-recipient').filter({ hasText: badge }).getByRole('checkbox');
  await choice('協力バッジ').check();
  await choice('継続バッジ').check();
  await grantForm.getByLabel('理由', { exact: true }).fill('試験用の付与理由');
  await control('2個のバッジを付与する', grantForm).click();
  await dialog.getByText('2個のバッジを付与しました。', { exact: true }).waitFor();
  const grants = (await achievementCalls()).filter((request) => request.action === 'grantManualBadges');
  assert.equal(grants.length, 2);
  assert.notEqual(grants[0].operationId, grants[1].operationId);
  for (const [i, badgeId] of ['first', 'second'].entries()) {
    assertOperation(grants[i], {
      action: 'grantManualBadges',
      badgeId,
      teacherUids: ['teacher'],
      reason: '試験用の付与理由',
    });
  }
  await combo('手動バッジ', grantForm).selectOption('first');
  const teacherChoice = choice('試験用講師');
  assert.equal(await teacherChoice.isDisabled(), true);
  await combo('操作', grantForm).selectOption('revoke');
  await teacherChoice.check();
  await grantForm.getByLabel('理由', { exact: true }).fill('試験用の取消理由');
  await control('1名の付与を取り消す', grantForm).click();
  await dialog.getByText('1名の付与を取り消しました。', { exact: true }).waitFor();
  assertOperation(
    (await achievementCalls()).find((request) => request.action === 'revokeManualBadges'),
    {
      action: 'revokeManualBadges',
      badgeId: 'first',
      teacherUids: ['teacher'],
      reason: '試験用の取消理由',
    },
  );

  await setSession(page);
  assert.equal(await trigger.isHidden(), true);
  assert.equal(await dialog.isHidden(), true);
  assert.equal(await page.locator('#rankingHost').textContent(), '');
}

module.exports = { ranking };
