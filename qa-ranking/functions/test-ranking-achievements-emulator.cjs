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

      const badge = { action: 'saveManualBadge', operationId: 'badge-1', badgeId: 'manual', name: '特別賞', description: '運営からの感謝', icon: '★', color: '#413245', active: true };
      const rule = { action: 'saveAutomaticRule', operationId: 'rule-1', ruleId: 'monthly', name: '月間表彰', description: '月間実績の表彰', icon: '★', color: '#413245', active: true,
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
      const catalog = await actor('o', {action:'manage'});
      assert.equal(catalog.badges[0].description,'運営からの感謝');
      assert.equal(catalog.rules[0].description,'月間実績の表彰');
      assert.equal(history.history[0].description,'月間実績の表彰');
      const archive = {action:'archiveDefinition',operationId:'archive-rule',definitionType:'rule',definitionId:'monthly'};
      await assert.rejects(()=>actor('a',archive),/FORBIDDEN/);
      await actor('o',archive);
      assert.equal((await actor('o',archive)).state,'replayed');
      await actor('o',{...archive,operationId:'archive-manual',definitionType:'manual',definitionId:'manual'});
      const archived=await actor('o',{action:'manage'});
      assert.equal(archived.rules[0].archived,true);
      assert.equal(archived.badges[0].archived,true);
      assert.equal(archived.rules[0].active,false);
      assert.equal(archived.badges[0].active,false);
      await assert.rejects(()=>actor('o',{...grant,operationId:'archived-grant',teacherUid:'a'}),/UNAVAILABLE/);
      const historyBefore=await actor('a',{action:'listHistory'});
      const nextCorrection=db.batch();
      nextCorrection.update(db.doc(`rankingInternalDays/${day}`),{revision:3,facts:[fact('private-s2','e')]});
      nextCorrection.create(db.doc(`rankingInternalRefresh/${day}_3`),{date:day,revision:3,status:'pending'});
      await nextCorrection.commit();
      for(let pass=0;pass<8;pass++){
        const outcomes=await instance.runPending({limit:1});
        assert(!outcomes.some(item=>item.state==='failed'),JSON.stringify(outcomes));
      }
      assert.equal((await db.doc(`rankingInternalRefresh/${day}_3`).get()).get('status'),'complete');
      assert.deepEqual(await actor('a',{action:'listHistory'}),historyBefore);
      assert.equal((await actor('e',{action:'listBadges'})).badges[0].description,'運営からの感謝');
      assert.equal((await inbox.get()).size,3);
      console.log('SUCCESS FIRESTORE ARCHIVE HISTORY PRESERVED');
      // The preference is personal, persistent, and independent of achievement records.
      await db.doc('rankingInternalConfig/runtime').update({achievementNotificationsEnabled:false});
      for (const id of ['order-extra','order-new']) {
        await actor('o',{...badge,badgeId:id,operationId:'create-'+id});
      }
      await actor('o',{...grant,badgeId:'order-extra',operationId:'grant-extra'});
      const own=(await actor('e',{action:'listBadges'})).badges.map(b=>b.recordId);
      assert.equal(own.length,2);
      const reversed=[...own].reverse();
      const order={action:'saveBadgeOrder',operationId:'order-save',recordIds:reversed};
      const readState=async()=>Promise.all(['rankingInternalAchievements','rankingInternalAchievementHistory','rankingInternalAchievementOutbox','notifications/e/items'].map(async path=>(await db.collection(path).get()).docs.map(d=>[d.id,d.data()])));
      const unchanged=await readState();
      await assert.rejects(()=>actor('a',order),/INVALID/);
      await assert.rejects(()=>actor('e',{...order,teacherUid:'a'}),/INVALID/);
      await assert.rejects(()=>actor('e',{...order,recordIds:[own[0],own[0]]}),/INVALID/);
      await assert.rejects(()=>actor('e',{...order,recordIds:own.slice(0,1)}),/INVALID/);
      assert.equal((await actor('e',order)).state,'committed');
      assert.equal((await actor('e',order)).state,'replayed');
      assert.deepEqual((await db.doc('rankingInternalConfig/badgeOrder_e').get()).get('recordIds'),reversed);
      const fresh=createRankingAchievements({db,clock:()=>now,notificationTimestamp:FieldValue.serverTimestamp});
      assert.deepEqual((await fresh.handle({auth:{uid:'a'},app:{appId:'emulator-test'},data:{action:'listBadges',teacherUid:'e'}})).badges.map(b=>b.recordId),reversed);
      assert.deepEqual(await readState(),unchanged);
      assert.equal((await db.doc('rankingInternalConfig/badgeOrder_a').get()).exists,false);
      now='2026-06-01T10:12:00+09:00';
      await actor('o',{...grant,badgeId:'order-new',operationId:'grant-new'});
      assert.deepEqual((await actor('e',{action:'listBadges'})).badges.slice(0,2).map(b=>b.recordId),reversed);
      await actor('o',{...grant,badgeId:'order-extra',action:'revokeManualBadge',operationId:'revoke-extra'});
      assert(!(await actor('e',{action:'listBadges'})).badges.some(b=>b.badgeId==='order-extra'));
      console.log('SUCCESS FIRESTORE PERSONAL BADGE ORDER TESTS');
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
