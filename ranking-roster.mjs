export const isRankingTeacherRole = role => role === 'employee' || role === 'admin';

export function isRankingTeacherUid(uid) {
 return typeof uid === 'string' && uid.length > 0 && uid.length <= 256 && !uid.includes('/') && uid !== '.' && uid !== '..' && !/^__.*__$/.test(uid);
}

export function rankingTeacher(teacher) {
 if (!isRankingTeacherUid(teacher?.uid) || !isRankingTeacherRole(teacher.role) ||
     typeof teacher.name !== 'string' || !teacher.name.trim() || teacher.name.length > 100) {
  throw Error('RANKING_INVALID_ROSTER');
 }
 return {uid:teacher.uid, role:teacher.role, name:teacher.name.trim()};
}

// Archived identity accompanies the fact that established it. Only the approved display fields are stored.
export function readArchivedRankingTeachers(value) {
 if (value === undefined) return new Map();
 if (!Array.isArray(value) || value.length > 300) throw Error('RANKING_INVALID_ROSTER');
 const roster = new Map();
 for (const row of value) {
  const teacher = rankingTeacher(row);
  if (roster.has(teacher.uid)) throw Error('RANKING_INVALID_ROSTER');
  roster.set(teacher.uid,teacher);
 }
 return roster;
}

export function archiveRankingTeachers({facts, teachers, previous}) {
 const archived = readArchivedRankingTeachers(previous);
 const live = new Map(teachers.map(teacher => [teacher.uid,teacher]));
 const uids = [...new Set(facts.map(fact => fact.teacherUid))].sort();
 if (uids.length > 300) throw Error('RANKING_INVALID_ROSTER');
 return uids.map(uid => {
  if (archived.has(uid)) return archived.get(uid);
  if (!live.has(uid)) throw Error('RANKING_HISTORICAL_ROSTER_REQUIRED');
  return rankingTeacher(live.get(uid));
 });
}
