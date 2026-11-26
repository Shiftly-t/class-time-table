export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const japanDateFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function japanDateKey(date = new Date()) {
  return japanDateFormatter.format(date);
}

// Date keys describe calendar days. Use local date components for arithmetic
// so parsing a UTC timestamp never moves a date key to the previous day.
export function localDateFromKey(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function datePlus(value, increment) {
  const [year, month, day] = value.split('-').map(Number);
  return dateKey(new Date(year, month - 1, day + increment));
}

export function startOfWeek(value) {
  const daysSinceMonday = (localDateFromKey(value).getDay() + 6) % 7;
  return datePlus(value, -daysSinceMonday);
}

export function shiftMonth(value, increment) {
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(year, month - 1 + increment, 1);
  const targetYear = target.getFullYear();
  const targetMonth = target.getMonth();
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return dateKey(new Date(targetYear, targetMonth, Math.min(day, lastDay)));
}

export function prettyDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || '';
  const [, month, day] = value.split('-').map(Number);
  return `${month}月${day}日（${WEEKDAYS[localDateFromKey(value).getDay()]}）`;
}
