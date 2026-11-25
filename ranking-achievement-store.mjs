import { isDeepStrictEqual } from 'node:util';
import {
  achievementDate, achievementKey, achievementReason, automaticRule, badgeDetails, describeScope,
  isAchievementId, isTeacherUid, periodKey, PERIOD_KINDS, planAutomaticAchievements, publicAward,
  publicBadge, TEACHING_ROLES, validAchievementDate
} from './ranking-achievements.mjs';
import { readRankingLedger } from './ranking-read.mjs';
import { rankingWindow } from './ranking-view-model.mjs';

const COLLECTIONS = {
  catalog: 'rankingInternalAchievementCatalog', records: 'rankingInternalAchievements',
  history: 'rankingInternalAchievementHistory', outbox: 'rankingInternalAchievementOutbox',
  operations: 'rankingInternalOperations', refresh: 'rankingInternalRefresh'
};
const fields = {
  listBadges: ['teacherUid'], listHistory: ['cursor'], manage: [],
  saveManualBadge: ['operationId', 'badgeId', 'name', 'color', 'icon', 'active'],
  saveAutomaticRule: ['operationId', 'ruleId', 'name', 'color', 'icon', 'active', 'category', 'kind', 'metric', 'criterion', 'value'],
  grantManualBadge: ['operationId', 'badgeId', 'teacherUid', 'reason'],
  revokeManualBadge: ['operationId', 'badgeId', 'teacherUid', 'reason']
};
const snapshot = document => document.exists ? document.data() : null;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const teacherName = user => typeof user?.name === 'string' && user.name.trim() && user.name.length <= 100;
const appRoles = [...TEACHING_ROLES, 'owner'];
const pageSize = 50;

function commandOf(data) {
  if (!data || !Object.hasOwn(fields, data.action) || Object.keys(data).some(key => key !== 'action' && !fields[data.action].includes(key))) {
    throw Error('INVALID_ACHIEVEMENT_INPUT');
  }
  const { action, operationId, badgeId, teacherUid, cursor } = data;
  if (action === 'listBadges') {
    if (teacherUid !== undefined && !isTeacherUid(teacherUid)) throw Error('INVALID_ACHIEVEMENT_INPUT');
    return { action, teacherUid };
  }
  if (action === 'listHistory') {
    if (cursor != null && (typeof cursor !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z_[a-f0-9]{64}$/.test(cursor))) {
      throw Error('INVALID_ACHIEVEMENT_INPUT');
    }
    return { action, cursor };
  }
  if (action === 'manage') return { action };
  if (!isAchievementId(operationId)) throw Error('INVALID_ACHIEVEMENT_INPUT');
  if (action === 'saveAutomaticRule') return { action, operationId, rule: automaticRule(data) };
  if (!isAchievementId(badgeId)) throw Error('INVALID_ACHIEVEMENT_INPUT');
  if (action === 'saveManualBadge') return { action, operationId, badgeId, badge: badgeDetails(data) };
  if (!isTeacherUid(teacherUid)) throw Error('INVALID_ACHIEVEMENT_INPUT');
  return { action, operationId, badgeId, teacherUid, reason: achievementReason(data.reason) };
}

export function createRankingAchievements({ db, clock = () => new Date().toISOString(), notificationTimestamp, loadLedger = readRankingLedger }) {
  if (db.projectId !== 'shiftly-t-test' || db.databaseId !== 'shiftly-qa-v1') throw Error('QA_RANKING_TARGET_MISMATCH');
  const collection = function (name) { return db.collection(COLLECTIONS[name]); };
  const ref = (name, id) => db.doc(`${COLLECTIONS[name]}/${id}`);
  const read = (tx, path) => tx.get(db.doc(path)).then(snapshot);
  const documents = async (tx, query, count) => {
    const { docs } = await tx.get(query.limit(count + 1));
    if (docs.length > count) throw Error('RANKING_ACHIEVEMENT_LIMIT');
    return docs;
  };
  const nowIso = () => new Date(clock()).toISOString();
  const operationalState = async tx => {
    const [config, maintenance, restore] = await Promise.all([
      read(tx, 'rankingInternalConfig/runtime'), read(tx, 'systemConfig/maintenance'), read(tx, 'systemConfig/restoreJob')
    ]);
    return { config, unavailable: Boolean(restore || maintenance?.enabled === true) };
  };
  const enabled = config => config?.enabled === true && config.achievementsEnabled === true &&
    config.correctionIntegrationVerified === true && validAchievementDate(config.trackingStart) && config.trackingStart >= '2000-01-01';
  const notificationEnabled = config => enabled(config) && config.publicationEnabled === true &&
    config.achievementNotificationsEnabled === true && config.notificationIntegrationVerified === true;
  const fullConfig = (config, unavailable) => {
    if (unavailable) throw Error('RANKING_UNAVAILABLE');
    if (!enabled(config)) throw Error('RANKING_ACHIEVEMENTS_NOT_ENABLED');
  };

  function transition(tx, { id, previous, next, actor, reason, now, config, trigger }) {
    const generation = (previous?.generation ?? 0) + 1;
    const action = next ? (previous?.active ? 'revised' : 'granted') : 'revoked';
    const awardedAt = previous?.active ? previous.awardedAt : now;
    const content = next ?? previous.content;
    const record = { active: Boolean(next), content, generation, awardedAt, scope: content.scope, teacherUid: content.teacherUid };
    const eventId = achievementKey(id, generation);
    const event = { ...content, at: now, action, actor, trigger, reason, eventId };
    if (content.category === 'award') event.publicAwardSortKey = `${now}_${eventId}`;
    tx.set(ref('records', id), record);
    tx.create(ref('history', eventId), event);
    if (action !== 'revised' || (content.category === 'award' && content.rank !== previous.content.rank)) {
      tx.create(ref('outbox', eventId), {
        eventId, teacherUid: content.teacherUid, category: content.category, name: content.name,
        kind: content.kind, key: content.key, rank: content.rank ?? null, action, at: now,
        status: notificationEnabled(config) ? 'pending' : 'suppressed'
      });
    }
  }

  async function handle(request) {
    const actor = request?.auth?.uid;
    if (!isTeacherUid(actor) || !request.app) throw Error('RANKING_UNAUTHENTICATED');
    const command = commandOf(request.data);
    const now = nowIso();
    const isPublic = command.action === 'listBadges' || command.action === 'listHistory';
    return db.runTransaction(async tx => {
      const [{ config, unavailable }, user] = await Promise.all([operationalState(tx), read(tx, `users/${actor}`)]);
      if (!appRoles.includes(user?.role) || (!isPublic && user.role !== 'owner')) throw Error('RANKING_FORBIDDEN');
      fullConfig(config, unavailable);
      if (isPublic) {
        if (config.publicationEnabled !== true) throw Error('RANKING_NOT_PUBLISHED');
        if (command.action === 'listBadges') {
          const teacherUid = command.teacherUid ?? actor;
          const records = await documents(tx, collection('records').where('teacherUid', '==', teacherUid), 2000);
          const badges = records.map(doc => doc.data()).filter(x => x.active && x.content.category === 'badge')
            .map(x => publicBadge({ ...x.content, awardedAt: x.awardedAt }));
          return { teacherUid, badges };
        }
        // Firestore orderBy omits documents without this field (manual audit and automatic badge events).
        let query = collection('history').orderBy('publicAwardSortKey', 'desc');
        if (command.cursor != null) query = query.startAfter(command.cursor);
        const { docs } = await tx.get(query.limit(pageSize + 1));
        return { history: docs.slice(0, pageSize).map(doc => publicAward(doc.data())),
          nextCursor: docs.length > pageSize ? docs[pageSize - 1].data().publicAwardSortKey : null };
      }
      if (command.action === 'manage') {
        const [catalog, users, records] = await Promise.all([
          documents(tx, collection('catalog'), 60), documents(tx, db.collection('users'), 300),
          documents(tx, collection('records').where('scope', '==', 'manual'), 2000)
        ]);
        const definitions = catalog.map(doc => doc.data());
        const grants = records.map(doc => doc.data()).filter(x => x.active);
        const teachers = new Map(users.filter(doc => TEACHING_ROLES.includes(doc.get('role')) && isTeacherUid(doc.id) && teacherName(doc.data()))
          .map(doc => [doc.id, { teacherUid: doc.id, name: doc.get('name').trim(), canGrant: true }]));
        for (const { content } of grants) {
          if (!teachers.has(content.teacherUid)) {
            teachers.set(content.teacherUid, { teacherUid: content.teacherUid, name: content.teacherName ?? content.teacherUid, canGrant: false });
          }
        }
        return {
          badges: definitions.filter(x => x.type === 'manual').map(({ badgeId, name, color, icon, active }) => ({ badgeId, name, color, icon, active })),
          rules: definitions.filter(x => x.type === 'rule').map(automaticRule),
          teachers: [...teachers.values()],
          grants: grants.map(x => publicBadge({ ...x.content, awardedAt: x.awardedAt }))
        };
      }
      const operation = achievementKey('achievement', actor, command.operationId);
      const operationRef = ref('operations', operation);
      const previousOperation = snapshot(await tx.get(operationRef));
      const signature = achievementKey(command);
      if (previousOperation) {
        if (previousOperation.signature !== signature) throw Error('RANKING_OPERATION_ID_REUSED');
        return { state: 'replayed' };
      }
      if (command.action === 'saveAutomaticRule' || command.action === 'saveManualBadge') {
        // The transaction query also protects the catalog size against concurrent additions.
        const catalog = await documents(tx, collection('catalog'), 60);
        if (command.action === 'saveAutomaticRule') {
          const id = `rule_${command.rule.ruleId}`;
          const before = catalog.find(doc => doc.id === id)?.data();
          if (!before && catalog.filter(doc => doc.get('type') === 'rule').length >= 30) throw Error('RANKING_ACHIEVEMENT_LIMIT');
          const kinds = [...new Set([before?.kind, command.rule.kind].filter(Boolean))];
          tx.set(ref('catalog', id), { ...command.rule, type: 'rule', updatedAt: now });
          tx.create(ref('refresh', `achievement_${operation}`), {
            type: 'achievementRule', kinds, index: 0, status: 'pending', createdAt: now
          });
        } else {
          const id = `manual_${command.badgeId}`;
          const before = catalog.find(doc => doc.id === id);
          if (!before && catalog.filter(doc => doc.get('type') === 'manual').length >= 30) throw Error('RANKING_ACHIEVEMENT_LIMIT');
          tx.set(ref('catalog', id), { ...command.badge, badgeId: command.badgeId, type: 'manual', updatedAt: now });
        }
      } else {
        const { badgeId, teacherUid, reason } = command;
        const id = achievementKey('manual', badgeId, teacherUid);
        const [badge, previous, teacher] = await Promise.all([
          tx.get(ref('catalog', `manual_${badgeId}`)).then(snapshot), tx.get(ref('records', id)).then(snapshot),
          read(tx, `users/${teacherUid}`)
        ]);
        if (command.action === 'grantManualBadge') {
          if (!badge?.active || !TEACHING_ROLES.includes(teacher?.role) || !teacherName(teacher)) throw Error('RANKING_GRANT_TARGET_UNAVAILABLE');
          if (previous?.active) throw Error('RANKING_ALREADY_GRANTED');
          const { name, color, icon } = badge;
          const next = { source: 'manual', scope: 'manual', category: 'badge', badgeId, teacherUid,
            teacherName: teacher.name.trim(), name, color, icon, kind: 'all', key: '' };
          transition(tx, { id, previous, next, actor, reason, now, config, trigger: operation });
        } else {
          if (!previous?.active) throw Error('RANKING_NOT_GRANTED');
          transition(tx, { id, previous, next: null, actor, reason, now, config, trigger: operation });
        }
      }
      tx.create(operationRef, { signature, actor, command, at: now });
      return { state: 'committed' };
    }, isPublic || command.action === 'manage' ? { readOnly: true } : undefined);
  }

  async function reconcileJob(jobId) {
    const now = nowIso();
    return db.runTransaction(async tx => {
      const [{ config, unavailable }, job] = await Promise.all([
        operationalState(tx), tx.get(ref('refresh', jobId)).then(snapshot)
      ]);
      if (unavailable || !enabled(config) || config.automationEnabled !== true) return { state: 'disabled' };
      if (!job || job.status !== 'pending') return { state: 'idle' };
      const ruleJob = job.type === 'achievementRule';
      if (!ruleJob) {
        if (!validAchievementDate(job.date) || !Number.isSafeInteger(job.revision) || job.revision < 1 || `${job.date}_${job.revision}` !== jobId) {
          throw Error('RANKING_INVALID_REFRESH');
        }
        const day = await read(tx, `rankingInternalDays/${job.date}`);
        if (day?.date !== job.date || day.revision < job.revision || job.date < config.trackingStart) throw Error('RANKING_INVALID_REFRESH');
      }
      const kinds = ruleJob ? job.kinds : PERIOD_KINDS;
      const index = job.index ?? 0;
      if (!Array.isArray(kinds) || !Number.isSafeInteger(index) || !PERIOD_KINDS.includes(kinds[index])) throw Error('RANKING_INVALID_REFRESH');
      const kind = kinds[index];
      const yesterday = achievementDate(now, -1);
      const todayKey = periodKey(kind, yesterday);
      const key = ruleJob ? (job.key ?? periodKey(kind, config.trackingStart)) : periodKey(kind, job.date);
      const scope = describeScope(kind, key, config.trackingStart, yesterday);
      const [catalog, records] = await Promise.all([
        documents(tx, collection('catalog'), 60), documents(tx, collection('records').where('scope', '==', scope.id), 4000)
      ]);
      const rules = catalog.filter(doc => doc.get('type') === 'rule').map(doc => automaticRule(doc.data()));
      const desired = scope.from <= scope.to && (records.length || rules.some(rule => rule.active && rule.kind === kind))
        ? planAutomaticAchievements({ scope, rules, ledger: await loadLedger({ tx, db, from: scope.from, to: scope.to, now }), now })
        : new Map();
      const nextJob = { ...job };
      if (desired) {
        const existing = new Map(records.map(doc => [doc.id, doc.data()]));
        const ids = new Set([...existing.keys(), ...desired.keys()]);
        const changes = [];
        for (const id of ids) {
          const previous = existing.get(id);
          const next = desired.get(id);
          if (next ? previous?.active && isDeepStrictEqual(previous.content, next) : !previous?.active) continue;
          changes.push({ id, previous, next });
        }
        for (const change of changes.slice(0, 100)) {
          transition(tx, { ...change, actor: 'system', reason: '確定実績に基づく再判定', now, config, trigger: jobId });
        }
        if (changes.length > 100) return { state: 'pending', scope: scope.id };
      } else nextJob.coverageBlocked = true;
      if (ruleJob && kind !== 'all' && key < todayKey) {
        const after = new Date(Date.parse(rankingWindow(kind, key).to) + 86400000).toISOString().slice(0, 10);
        nextJob.key = periodKey(kind, after);
      } else {
        delete nextJob.key;
        nextJob.index = index + 1;
        if (nextJob.index >= kinds.length) nextJob.status = nextJob.coverageBlocked ? 'blockedCoverage' : 'complete';
      }
      tx.set(ref('refresh', jobId), nextJob);
      return { state: nextJob.status, scope: scope.id };
    });
  }

  async function deliver(eventId) {
    if (typeof eventId !== 'string' || !/^[a-f0-9]{64}$/.test(eventId)) throw Error('RANKING_INVALID_NOTIFICATION');
    return db.runTransaction(async tx => {
      const [{ config, unavailable }, event] = await Promise.all([
        operationalState(tx), tx.get(ref('outbox', eventId)).then(snapshot)
      ]);
      if (unavailable || !notificationEnabled(config) || typeof notificationTimestamp !== 'function') return { state: 'disabled' };
      if (!event || event.status !== 'pending') return { state: 'idle' };
      if (event.eventId !== eventId || !isTeacherUid(event.teacherUid) || !['badge', 'award'].includes(event.category) ||
          !['granted', 'revoked', 'revised'].includes(event.action) || !timestamp(event.at) ||
          typeof event.name !== 'string' || !event.name || event.name.length > 60) throw Error('RANKING_INVALID_NOTIFICATION');
      const user = await read(tx, `users/${event.teacherUid}`);
      const state = TEACHING_ROLES.includes(user?.role) ? 'delivered' : 'skipped';
      if (state === 'delivered') {
        const target = db.doc(`notifications/${event.teacherUid}/items/ranking_${eventId}`);
        const prior = await tx.get(target);
        if (!prior.exists) {
          const type = event.category === 'award' ? '表彰' : 'バッジ';
          const action = { granted: 'を獲得しました', revoked: 'が取り消されました', revised: 'が更新されました' }[event.action];
          const destination = event.category === 'award' ? 'history' : 'badges';
          tx.create(target, { kind: 'rankingAchievement', target: destination, message: `${type}「${event.name}」${action}。`,
            read: false, createdAt: notificationTimestamp() });
        }
      }
      tx.set(ref('outbox', eventId), { ...event, status: state, processedAt: nowIso() });
      return { state };
    });
  }

  async function runPending({ limit = 5 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw Error('RANKING_INVALID_WORK_LIMIT');
    const cursorPath = 'rankingInternalConfig/achievementWorker';
    const queues = await db.runTransaction(async tx => {
      const [{ config, unavailable }, cursors] = await Promise.all([operationalState(tx), read(tx, cursorPath)]);
      if (unavailable || !enabled(config)) return { refresh: [], outbox: [] };
      async function pending(name, active) {
        if (!active) return [];
        const queue = collection(name).where('status', '==', 'pending').limit(limit);
        if (typeof cursors?.[name] === 'string') {
          const cursor = await tx.get(ref(name, cursors[name]));
          if (cursor.exists) {
            const { docs } = await tx.get(queue.startAfter(cursor));
            if (docs.length) return docs.map(doc => doc.id);
          }
        }
        const { docs } = await tx.get(queue);
        return docs.map(doc => doc.id);
      }
      const [refresh, outbox] = await Promise.all([
        pending('refresh', config.automationEnabled === true), pending('outbox', notificationEnabled(config))
      ]);
      if (refresh.length || outbox.length) {
        tx.set(db.doc(cursorPath), { refresh: refresh.at(-1) ?? cursors?.refresh ?? null, outbox: outbox.at(-1) ?? cursors?.outbox ?? null });
      }
      return { refresh, outbox };
    });
    const failure = error => ({ state: 'failed', code: /^[A-Z_]{1,80}$/.test(error?.message) ? error.message : 'RANKING_WORK_FAILED' });
    const outcomes = [];
    for (const id of queues.refresh) outcomes.push(await reconcileJob(id).catch(failure));
    for (const id of queues.outbox) outcomes.push(await deliver(id).catch(failure));
    return outcomes;
  }

  return { handle, reconcileJob, deliver, runPending };
}
