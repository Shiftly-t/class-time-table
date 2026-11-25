import assert from 'node:assert/strict';
import { createRankingAchievements } from '../ranking-achievement-store.mjs';
import { achievementKey, automaticRule } from '../ranking-achievements.mjs';
import { createRankingAchievementCallable } from '../qa-ranking/functions/ranking-achievement-callable.cjs';

const day = '2026-03-31';
const fact = (studentId, teacherUid) => ({
  slotId: JSON.stringify([studentId, day, '17:30', '18:25']), date: day, studentId, teacherUid,
  endedAt: `${day}T18:25:00+09:00`, kind: 'regular', status: 'done'
});
const runtime = 'rankingInternalConfig/runtime';
const active = {
  enabled: true, automationEnabled: true, correctionIntegrationVerified: true, achievementsEnabled: true,
  publicationEnabled: true, trackingStart: '2026-03-01'
};
const state = new Map([
  [runtime, { enabled: true, trackingStart: active.trackingStart }],
  ['users/a', { role: 'employee', name: '講師A', email: 'private-email' }],
  ['users/b', { role: 'admin', name: '講師B' }],
  ['users/o', { role: 'owner', name: '運営' }],
  ['users/x', { role: 'guest', name: '外部' }]
]);
const doc = (path, value) => ({ path, id: path.split('/').at(-1), exists: value !== undefined, data: () => value, get: key => value?.[key] });
const query = (name, options = { filters: [] }) => ({
  name, options,
  where(key, op, expected) { return query(name, { ...options, filters: [...options.filters, [key, op, expected]] }); },
  limit(max) { return query(name, { ...options, max }); },
  orderBy(order, direction) { return query(name, { ...options, order, direction }); },
  startAfter(cursor) { return query(name, { ...options, cursor }); }
});
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const db = {
  projectId: 'shiftly-t-test', databaseId: 'shiftly-qa-v1', doc: path => ({ path }), collection: query,
  async runTransaction(callback, options) {
    const writes = new Map();
    const tx = {
      async get(target) {
        assert.equal(writes.size, 0, 'Firestore reads must precede writes');
        if (target.path) return doc(target.path, state.get(target.path));
        const { filters, order, direction, cursor, max } = target.options;
        const sortKey = item => order ? item.get(order) : item.id;
        const orderOf = (a, b) => compare(a, b) * (direction === 'desc' ? -1 : 1);
        const docs = [...state].filter(([path, value]) => path.startsWith(`${target.name}/`) &&
          filters.every(([field, op, expected]) => ({ '==': value[field] === expected, '>=': value[field] >= expected, '<=': value[field] <= expected })[op]))
          .map(([path, value]) => doc(path, value)).filter(item => sortKey(item) !== undefined)
          .sort((a, b) => orderOf(sortKey(a), sortKey(b)))
          .filter(item => cursor === undefined || orderOf(sortKey(item), typeof cursor === 'string' ? cursor : sortKey(cursor)) > 0).slice(0, max);
        return { docs };
      },
      create({ path }, value) {
        assert(!state.has(path) && !writes.has(path), 'Firestore create must be unique');
        this.set({ path }, value);
      },
      set({ path }, value) {
        assert(!options?.readOnly);
        writes.set(path, structuredClone(value));
      }
    };
    const result = await callback(tx);
    for (const [key, value] of writes) state.set(key, value);
    return result;
  }
};
let now = '2026-04-01T00:10:00+09:00';
const awards = createRankingAchievements({ db, clock: () => now, notificationTimestamp: () => ({ serverNow: true }) });
const request = (uid, data) => ({ auth: { uid }, app: { appId: 'verified-fixture' }, data });
const run = (uid, data) => awards.handle(request(uid, data));
const manual = { action: 'saveManualBadge', operationId: 'create-manual', badgeId: 'special', name: '特別賞', color: '#335544', icon: '🎖', active: true };
const grant = { action: 'grantManualBadge', operationId: 'grant-a', badgeId: 'special', teacherUid: 'a', reason: 'private-reason' };
const saveRule = {
  action: 'saveAutomaticRule', operationId: 'create-rule', ruleId: 'milestone', category: 'badge', kind: 'all',
  name: '達成', color: '#446655', icon: '★', active: true, metric: 'slots', criterion: 'minimum', value: 2
};
const monthly = { ...saveRule, operationId: 'create-month', ruleId: 'highest', category: 'award', kind: 'month', name: '月間表彰', criterion: 'rank', value: 1 };
const configJob = data => `achievement_${achievementKey('achievement', 'o', data.operationId)}`;
const records = prefix => [...state].filter(([path]) => path.startsWith(`${prefix}/`));
const refresh = revision => {
  state.set(`rankingInternalRefresh/${day}_${revision}`, { date: day, revision, status: 'pending' });
  return `${day}_${revision}`;
};
function seed(revision, facts) {
  state.set(`rankingInternalDays/${day}`, { date: day, revision, facts });
  return refresh(revision);
}
async function reconcile(job) {
  for (let i = 0; i < 8 && state.get(`rankingInternalRefresh/${job}`).status === 'pending'; i++) await awards.reconcileJob(job);
  return state.get(`rankingInternalRefresh/${job}`).status;
}

assert.throws(() => createRankingAchievements({ db: { ...db, projectId: 'shiftly-d02f6' } }), /TARGET_MISMATCH/);
assert.throws(() => automaticRule({ ...monthly, kind: 'all' }), /INVALID_ACHIEVEMENT_INPUT/);
assert.throws(() => automaticRule({ ...saveRule, value: 0 }), /INVALID_ACHIEVEMENT_INPUT/);
await assert.rejects(() => awards.handle({ data: manual }), /UNAUTHENTICATED/);
await assert.rejects(() => awards.handle({ ...request('o', manual), app: null }), /UNAUTHENTICATED/);
await assert.rejects(() => run('x', { action: 'listHistory' }), /FORBIDDEN/);
await assert.rejects(() => run('o', manual), /NOT_ENABLED/);
state.set(runtime, active);
await assert.rejects(() => run('o', { ...manual, email: 'private-user' }), /INVALID_ACHIEVEMENT_INPUT/);
await assert.rejects(() => run('a', manual), /FORBIDDEN/);
await assert.rejects(() => run('b', saveRule), /FORBIDDEN/);
await assert.rejects(() => run('a', { action: 'manage' }), /FORBIDDEN/);
assert.deepEqual((await run('o', { action: 'manage' })).rules, []);
assert.deepEqual(await run('o', manual), { state: 'committed' });
assert.deepEqual(await run('o', manual), { state: 'replayed' });
await assert.rejects(() => run('o', { ...manual, name: '別名' }), /OPERATION_ID_REUSED/);
assert.deepEqual(await run('o', grant), { state: 'committed' });
await assert.rejects(() => run('o', { ...grant, operationId: 'duplicate' }), /ALREADY_GRANTED/);
assert.equal(records('rankingInternalAchievementOutbox')[0][1].status, 'suppressed');
assert.equal((await run('a', { action: 'listBadges' })).badges[0].source, 'manual');
assert(!JSON.stringify(await run('b', { action: 'listBadges', teacherUid: 'a' })).includes('private'));
state.set(runtime, { ...active, publicationEnabled: false });
await assert.rejects(() => run('a', { action: 'listBadges' }), /NOT_PUBLISHED/);
assert.equal((await run('o', { action: 'manage' })).grants.length, 1);
state.set('systemConfig/restoreJob', { restoring: true });
await assert.rejects(() => run('o', { action: 'manage' }), /UNAVAILABLE/);
assert.deepEqual(await awards.runPending(), []);
state.delete('systemConfig/restoreJob');
state.set(runtime, active);

for (let i = 1; i < 31; i++) {
  const date = `2026-03-${String(i).padStart(2, '0')}`;
  state.set(`rankingInternalDays/${date}`, { date, revision: 1, facts: [] });
}
const first = seed(1, [fact('private-a1', 'a'), fact('private-a2', 'a'), fact('private-b1', 'b'), fact('private-b2', 'b')]);
await run('o', saveRule);
await run('o', monthly);
assert.equal(await reconcile(first), 'complete');
assert.equal(await reconcile(configJob(saveRule)), 'complete');
assert.equal(await reconcile(configJob(monthly)), 'complete');
assert.equal((await run('a', { action: 'listBadges' })).badges.length, 2);
assert.equal((await run('b', { action: 'listBadges' })).badges[0].badgeId, 'milestone');
const tied = (await run('x', { action: 'listHistory' }).catch(error => error.message));
assert.equal(tied, 'RANKING_FORBIDDEN');
const history = (await run('a', { action: 'listHistory' })).history;
assert.deepEqual(history.map(x => x.rank), [1, 1]);
assert(history.every(x => x.action === 'granted'));
assert(!JSON.stringify(history).includes('private'));

// A correction revokes only the automatic badges/awards that no longer qualify.
state.set(runtime, { ...active, achievementNotificationsEnabled: true, notificationIntegrationVerified: true });
now = '2026-04-01T12:05:00+09:00';
const corrected = seed(2, [fact('private-a1', 'a'), fact('private-b1', 'b'), fact('private-b2', 'b')]);
assert.equal(await reconcile(corrected), 'complete');
assert.deepEqual((await run('a', { action: 'listBadges' })).badges.map(x => x.source), ['manual']);
assert.deepEqual((await run('b', { action: 'listBadges' })).badges.map(x => x.source), ['automatic']);
assert.equal((await run('a', { action: 'listHistory' })).history[0].action, 'revoked');
const pendingOutbox = records('rankingInternalAchievementOutbox').filter(([, item]) => item.status === 'pending');
assert.equal(pendingOutbox.length, 2);
assert(pendingOutbox.every(([, item]) => item.teacherUid === 'a' && !JSON.stringify(item).includes('private')));
assert.equal((await awards.reconcileJob(corrected)).state, 'idle');
await awards.runPending();
const renderedNotices = records('notifications');
assert.equal(renderedNotices.length, 2);
assert(renderedNotices.every(([, item]) => item.kind === 'rankingAchievement' && item.read === false && item.createdAt.serverNow));
assert.deepEqual(new Set(renderedNotices.map(([, item]) => item.target)), new Set(['badges', 'history']));
assert.equal((await awards.deliver(pendingOutbox[0][1].eventId)).state, 'idle');
await awards.runPending();
assert.equal(records('notifications').length, 2);

// Day gaps preserve existing state and prevent new automatic grants.
state.delete('rankingInternalDays/2026-03-01');
const missing = seed(3, [fact('private-a1', 'a'), fact('private-a2', 'a'), fact('private-b1', 'b')]);
assert.equal(await reconcile(missing), 'blockedCoverage');
assert.deepEqual((await run('a', { action: 'listBadges' })).badges.map(x => x.source), ['manual']);
assert.equal((await run('b', { action: 'listBadges' })).badges.length, 1);

// Former staff remain eligible for manual revocation, and their inboxes receive no notices.
state.delete('users/a');
const former = (await run('o', { action: 'manage' })).teachers.find(x => x.teacherUid === 'a');
assert.deepEqual(former, { teacherUid: 'a', name: '講師A', canGrant: false });
await run('o', { ...grant, action: 'revokeManualBadge', operationId: 'revoke-a' });
await awards.runPending();
assert.equal(records('notifications').length, 2);
assert(records('rankingInternalAchievementOutbox').some(([, item]) => item.status === 'skipped'));
assert.equal((await run('b', { action: 'listBadges', teacherUid: 'a' })).badges.length, 0);

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
let options;
const callable = createRankingAchievementCallable({ onCall: (opts, invoke) => { options = opts; return invoke; }, HttpsError, handle: awards.handle });
assert.equal(options.enforceAppCheck, true);
await assert.rejects(() => callable({ ...request('b', manual), app: null }), { code: 'permission-denied' });
await assert.rejects(() => callable(request('b', manual)), { code: 'permission-denied' });
assert.equal((await callable(request('o', { action: 'manage' }))).rules.length, 2);
// Bulk transaction and description compatibility.
state.set('users/a',{role:'employee',name:'講師A'});
state.set(runtime,{...active,achievementNotificationsEnabled:false});
const custom={...manual,operationId:'new-custom',badgeId:'custom',description:'教室への貢献'};
await run('o',custom);
const bulk={action:'grantManualBadges',operationId:'bulk-1',badgeId:'custom',teacherUids:['a','b'],reason:'QA一括付与'};
await assert.rejects(()=>run('a',bulk),/FORBIDDEN/);
await assert.rejects(()=>run('o',{...bulk,teacherUids:['a','a']}),/INVALID/);
await assert.rejects(()=>run('o',{...bulk,teacherUids:['a','x']}),/UNAVAILABLE/);
assert.equal((await run('a',{action:'listBadges'})).badges.length,0);
assert.equal((await run('o',bulk)).state,'committed');
assert.equal((await run('o',{...bulk,teacherUids:['b','a']})).state,'replayed');
assert.equal((await run('a',{action:'listBadges'})).badges[0].description,'教室への貢献');
const manage=await run('o',{action:'manage'});
assert.equal(manage.badges.find(x=>x.badgeId==='custom').description,'教室への貢献');
assert.equal(manage.manualHistory.filter(x=>x.badgeId==='custom'&&x.action==='granted').length,2);
assert(!JSON.stringify(manage).includes('private-email'));
await run('o',{...bulk,action:'revokeManualBadges',operationId:'bulk-2'});
assert.equal((await run('a',{action:'listBadges'})).badges.length,0);
assert.equal((await run('o',{action:'manage'})).manualHistory.filter(x=>x.badgeId==='custom'&&x.action==='revoked').length,2);
console.log('SUCCESS RANKING BADGE BULK AND DESCRIPTION TESTS');
console.log('SUCCESS RANKING ACHIEVEMENT TRANSACTION AND NOTIFICATION FIXTURE TESTS');
