import { createHash } from 'node:crypto';
import { aggregateRanking, rankTeachers } from './ranking-core.mjs';
import { rankingWindow } from './ranking-view-model.mjs';
export { isRankingTeacherUid as isTeacherUid } from './ranking-roster.mjs';

export const ACHIEVEMENT_METRICS = ['slots', 'regular', 'seasonal', 'days', 'students'];
export const TEACHING_ROLES = ['employee', 'admin'];
export const PERIOD_KINDS = ['all', 'month', 'year'];

export function achievementKey(...parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function validAchievementDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}

export function achievementDate(now, offset = 0) {
  return new Date(Date.parse(now) + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
}

export function periodKey(kind, date) {
  if (kind === 'all') return '';
  if (kind === 'month') return date.slice(0, 7);
  return String(Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0));
}

export function describeScope(kind, key, trackingStart, yesterday) {
  const window = kind === 'all' ? { from: trackingStart, to: yesterday } : rankingWindow(kind, key);
  return {
    id: `${kind}:${key}`, kind, key,
    from: window.from > trackingStart ? window.from : trackingStart,
    to: window.to < yesterday ? window.to : yesterday,
    awardEligible: kind !== 'all' && window.from >= trackingStart && window.to <= yesterday
  };
}

export function isAchievementId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function text(value, max) {
  if (typeof value !== 'string' || value.length > max || !value.trim() || /[\p{Cc}]/u.test(value)) {
    throw Error('INVALID_ACHIEVEMENT_INPUT');
  }
  return value.trim();
}

export const achievementReason = value => text(value, 500);

export function badgeDetails(input) {
  if (typeof input.color !== 'string' || !/^#[a-f\d]{6}$/i.test(input.color) || typeof input.active !== 'boolean') {
    throw Error('INVALID_ACHIEVEMENT_INPUT');
  }
  const result = { name: text(input.name, 60), color: input.color.toLowerCase(), icon: text(input.icon, 16), active: input.active };
  if (input.description !== undefined) {
    if (typeof input.description !== 'string' || input.description.length > 300 || /[\p{Cc}]/u.test(input.description)) throw Error('INVALID_ACHIEVEMENT_INPUT');
    result.description = input.description.trim();
  }
  return result;
}

export function automaticRule(input) {
  const { ruleId, category, kind, metric, criterion, value } = input;
  if (!isAchievementId(ruleId) || !['badge', 'award'].includes(category) || !PERIOD_KINDS.includes(kind) ||
      !ACHIEVEMENT_METRICS.includes(metric) || !['minimum', 'rank'].includes(criterion) ||
      !Number.isSafeInteger(value) || value < 1 || value > (criterion === 'rank' ? 300 : 1000000) ||
      (category === 'award' && (kind === 'all' || criterion !== 'rank'))) {
    throw Error('INVALID_ACHIEVEMENT_INPUT');
  }
  return { ...badgeDetails(input), ruleId, category, kind, metric, criterion, value };
}

export function publicBadge(record) {
  const { badgeId, teacherUid, name, color, icon, source, awardedAt } = record;
  return { badgeId, teacherUid, name, color, icon, source, awardedAt, ...(typeof record.description === 'string' ? {description: record.description} : {}) };
}

export function publicAward(event) {
  const { ruleId, teacherUid, name, teacherName, color, icon, rank, metric, kind, key, at, action } = event;
  return { ruleId, teacherUid, name, teacherName, color, icon, rank, metric, kind, key, at, action, ...(typeof event.description === 'string' ? {description: event.description} : {}) };
}

export function planAutomaticAchievements({ scope, rules, ledger, now }) {
  if (!ledger.coverage.complete || ledger.coverage.expected === 0) return null;
  const { facts, teachers } = ledger;
  const totals = aggregateRanking({ facts, teachers, from: scope.from, to: scope.to, cutoff: now });
  const names = new Map(teachers.map(teacher => [teacher.uid, teacher.name]));
  const rankings = new Map();
  const desired = new Map();
  for (const rule of rules) {
    if (!rule.active || rule.kind !== scope.kind || (rule.category === 'award' && !scope.awardEligible)) continue;
    if (!rankings.has(rule.metric)) rankings.set(rule.metric, rankTeachers(totals, rule.metric));
    for (const row of rankings.get(rule.metric)) {
      if (rule.criterion === 'rank' ? row.rank > rule.value : row[rule.metric] < rule.value) continue;
      const id = achievementKey('automatic', scope.id, rule.category, rule.ruleId, row.teacherUid);
      const fields = {
        source: 'automatic', scope: scope.id, category: rule.category, ruleId: rule.ruleId,
        kind: scope.kind, key: scope.key, teacherUid: row.teacherUid,
        name: rule.name, color: rule.color, icon: rule.icon,
        ...(typeof rule.description === 'string' ? {description: rule.description} : {})
      };
      desired.set(id, rule.category === 'award'
        ? { ...fields, teacherName: names.get(row.teacherUid), rank: row.rank, metric: rule.metric }
        : { ...fields, badgeId: rule.ruleId });
    }
  }
  return desired;
}
