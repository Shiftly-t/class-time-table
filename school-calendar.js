import { dateKey, datePlus, localDateFromKey } from './calendar-date.js';

// This calendar covers 2000–2099. Review future equinoxes and statutory
// exceptions against the Cabinet Office calendar during the annual rollout.
const holidayCache = new Map();

function japaneseHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);

  const holidays = new Map();
  const add = (month, day, name) => {
    const monthText = String(month).padStart(2, '0');
    const dayText = String(day).padStart(2, '0');
    holidays.set(`${year}-${monthText}-${dayText}`, name);
  };
  const nthMonday = (month, occurrence) => {
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    return 1 + ((8 - firstWeekday) % 7) + (occurrence - 1) * 7;
  };

  add(1, 1, '元日');
  add(1, nthMonday(1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  if (year >= 2020) add(2, 23, '天皇誕生日');
  const springEquinox = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const autumnEquinox = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  add(3, springEquinox, '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(7, nthMonday(7, 3), '海の日');
  add(8, 11, '山の日');
  add(9, nthMonday(9, 3), '敬老の日');
  add(9, autumnEquinox, '秋分の日');
  add(10, nthMonday(10, 2), 'スポーツの日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  // The Tokyo Olympics moved three holidays in each of these years.
  if (year === 2020) {
    holidays.delete('2020-07-20');
    holidays.delete('2020-10-12');
    holidays.delete('2020-08-11');
    add(7, 23, '海の日');
    add(7, 24, 'スポーツの日');
    add(8, 10, '山の日');
  }
  if (year === 2021) {
    holidays.delete('2021-07-19');
    holidays.delete('2021-10-11');
    holidays.delete('2021-08-11');
    add(7, 22, '海の日');
    add(7, 23, 'スポーツの日');
    add(8, 8, '山の日');
  }

  const nationalHolidays = [...holidays.keys()].sort();
  const daysInYear = new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
  // A day between two national holidays can become a citizen's holiday.
  for (let day = 1; day <= daysInYear; day++) {
    const date = dateKey(new Date(year, 0, day));
    if (date.slice(0, 4) !== String(year) || holidays.has(date) || localDateFromKey(date).getDay() === 0) continue;
    if (holidays.has(datePlus(date, -1)) && holidays.has(datePlus(date, 1))) {
      holidays.set(date, '国民の休日');
    }
  }

  // Move a Sunday national holiday past any consecutive holidays.
  for (const date of nationalHolidays) {
    if (localDateFromKey(date).getDay() !== 0) continue;
    let substitute = datePlus(date, 1);
    while (holidays.has(substitute)) substitute = datePlus(substitute, 1);
    holidays.set(substitute, '振替休日');
  }

  holidayCache.set(year, holidays);
  return holidays;
}

export function automaticClosure(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const year = Number(date.slice(0, 4));
  if (year < 2000 || year > 2099) return null;
  const holidayName = japaneseHolidays(year).get(date);
  if (!holidayName && localDateFromKey(date).getDay() !== 0) return null;

  return {
    date,
    note: holidayName ? `${holidayName}のため休校` : '日曜日のため休校',
    automatic: true,
    holidayName: holidayName || '',
  };
}

export function schoolClosureForDate({ closures, openDays, examEvents }, date) {
  // Special openings and exams temporarily override the underlying closure.
  if (openDays[date] || examEvents[date]) return null;
  return closures[date] || automaticClosure(date);
}
