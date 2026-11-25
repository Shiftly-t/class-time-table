'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

async function exercise() {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('LOCAL_EMULATOR_REQUIRED');
  const { createRankingAchievements } = await import('../../ranking-achievement-store.mjs');
  const app = initializeApp({ projectId: 'shiftly-t-test' }, 'ranking-achievements-emulator');
  const db = getFirestore(app, 'shiftly-qa-v1');
  try {
    assert.equal((await db.listCollections()).length, 0, 'An empty, dedicated emulator is required');
    try {
      let now = '2026-06-01T00:10:00+09:00';
      const instance = createRankingAchievements({ db, clock: () => now, notificationTimestamp: FieldValue.serverTimestamp });
      const actor = (uid, data) => instance.handle({ auth: { uid }, app: { appId: 'emulator-test' }, data });
      const day = '2026-05-31';
      const config = {
        enabled: true, automationEnabled: true, correctionIntegrationVerified: true, achievementsEnabled: true,
        trackingStart: '2026-05-01', publicationEnabled: true, achievementNotificationsEnabled: true, notificationIntegrationVerified: true
      };
      const fact = (studentId, teacherUid) => ({
        slotId: JSON.stringify([studentId, day, '17:30', '18:25']), date: day, studentId, teacherUid,
        endedAt: `${day}T18:25:00+09:00`, kind: 'regular', status: 'done'
      });
      const seed = db.batch();
      seed.create(db.doc('rankingInternalConfig/runtime'), config);
      for (const [id, role] of [['o', 'owner'], ['a', 'admin'], ['e', 'employee']]) {
        seed.create(db.doc(`users/${id}`), { name: `講師 ${id}`, role, email: `private-${id}` });
      }
      for (let i = 1; i <= 31; i++) {
        const date = `2026-05-${String(i).padStart(2, '0')}`;
        const facts = date === day ? [fact('private-s1', 'a'), fact('private-s2', 'e')] : [];
        seed.create(db.doc(`rankingInternalDays/${date}`), { date, revision: 1, facts });
      }
      seed.create(db.doc(`rankingInternalRefresh/${day}_1`), { date: day, revision: 1, status: 'pending' });
      await seed.commit();

      const badge = { action: 'saveManualBadge', operationId: 'badge-1', badgeId: 'manual', name: '特別賞', icon: '★', color: '#413245', active: true };
      const rule = { action: 'saveAutomaticRule', operationId: 'rule-1', ruleId: 'monthly', name: '月間表彰', icon: '★', color: '#413245', active: true,
        category: 'award', kind: 'month', metric: 'slots', criterion: 'rank', value: 1 };
      const grant = { action: 'grantManualBadge', operationId: 'grant-1', badgeId: badge.badgeId, teacherUid: 'e', reason: 'private-reason' };
      await assert.rejects(() => actor('a', badge), /FORBIDDEN/);
      await actor('o', badge);
      await actor('o', rule);
      const duplicate = await Promise.all([actor('o', grant), actor('o', grant)]);
      assert.deepEqual(duplicate.map(x => x.state).sort(), ['committed', 'replayed']);
      for (let pass = 0; pass < 8; pass++) {
        const outcomes = await instance.runPending({ limit: 1 });
        assert(!outcomes.some(item => item.state === 'failed'), JSON.stringify(outcomes));
      }
      assert.equal((await db.doc(`rankingInternalRefresh/${day}_1`).get()).get('status'), 'complete');
      const history = await actor('a', { action: 'listHistory' });
      assert.deepEqual(history.history.map(entry => entry.rank), [1, 1]);
      assert(!JSON.stringify(history).includes('private'));
      const inbox = db.collection('notifications/e/items');
      assert.equal((await inbox.get()).size, 2);
      assert((await inbox.get()).docs.every(notice => notice.get('createdAt')?.toMillis() > 0 && notice.get('read') === false));

      // A verified correction refreshes all windows and only revokes the affected automatic award.
      now = '2026-06-01T10:11:00+09:00';
      const correction = db.batch();
      correction.update(db.doc(`rankingInternalDays/${day}`), { revision: 2, facts: [fact('private-s1', 'a')] });
      correction.create(db.doc(`rankingInternalRefresh/${day}_2`), { date: day, revision: 2, status: 'pending' });
      await correction.commit();
      for (let pass = 0; pass < 6; pass++) {
        const outcomes = await instance.runPending({ limit: 1 });
        assert(!outcomes.some(item => item.state === 'failed'), JSON.stringify(outcomes));
      }
      const revoked = (await actor('e', { action: 'listHistory' })).history[0];
      assert(revoked.action === 'revoked' && revoked.teacherUid === 'e');
      const grants = (await actor('e', { action: 'listBadges' })).badges;
      assert.equal(grants.length, 1);
      assert.equal(grants[0].source, 'manual');
      assert((await inbox.get()).docs.some(notice => notice.get('target') === 'history' && notice.get('message').includes('取り消')));
      assert.equal((await inbox.get()).size, 3);
      assert.deepEqual(await instance.runPending(), []);
    } finally {
      for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
      assert.equal((await db.listCollections()).length, 0);
    }
  } finally {
    await deleteApp(app);
  }
  console.log('SUCCESS NAMED FIRESTORE EMULATOR RANKING ACHIEVEMENT AND NOTIFICATION TESTS');
}

exercise().catch(error => { console.error(error); process.exitCode = 1; });
