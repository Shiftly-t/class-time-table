// Local, read-only dashboard and per-account presentation preferences.
export function summarizeDay(rows, periods, teacherIds) {
  const active = rows.filter((r) => r.status !== 'cancelled');
  const assigned = new Set();
  const counts = periods.map((p) => ({ label: p.number + '限', time: p.start + '〜' + p.end, count: 0 }));
  let other = 0;
  for (const row of active) {
    if (row.teacherUid && teacherIds.has(row.teacherUid) && !row.teacherAbsent) assigned.add(row.teacherUid);
    const i = periods.findIndex((p) => p.start === row.start && p.end === row.end);
    if (i < 0) other++;
    else counts[i].count++;
  }
  if (other) counts.push({ label: 'その他の時間', time: '', count: other });
  return { lessons: active.length, teachers: assigned.size, counts };
}
export function searchDirectory(query, students, teachers) {
  const normalize = (x) =>
    String(x ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase('ja')
      .trim();
  const q = normalize(query);
  if (!q) return [];
  return [
    ...students.map((x) => ({
      type: 'student',
      id: x.id,
      name: x.name,
      detail: x.school || '',
      terms: [x.name, x.school],
    })),
    ...teachers.map((x) => ({ type: 'teacher', id: x.id, name: x.name, detail: '講師', terms: [x.name] })),
  ]
    .filter((x) => x.terms.some((v) => normalize(v).includes(q)))
    .slice(0, 30);
}
export function readDisplayPreferences(storage, key) {
  try {
    const v = JSON.parse(storage.getItem(key) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
export function writeDisplayPreferences(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* optional device preference */
  }
}
