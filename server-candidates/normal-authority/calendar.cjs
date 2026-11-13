'use strict';
// Derived only from this repository's public app.js calendar, not private attachments.
const dateKey=d=>d.toISOString().slice(0,10);
const datePlus=(key,n)=>{const d=new Date(key+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return dateKey(d)};
const holidayCache=new Map();
function japaneseHolidays(year){
  if(holidayCache.has(year))return holidayCache.get(year);
  const h=new Map();
  const put=(m,d,name)=>h.set(`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,name);
  const nthMonday=(m,n)=>{const first=new Date(Date.UTC(year,m-1,1)).getUTCDay();return 1+(8-first)%7+(n-1)*7;};
  put(1,1,'元日');put(1,nthMonday(1,2),'成人の日');put(2,11,'建国記念の日');
  if(year>=2020)put(2,23,'天皇誕生日');
  const spring=Math.floor(20.8431+0.242194*(year-1980)-Math.floor((year-1980)/4));
  const autumn=Math.floor(23.2488+0.242194*(year-1980)-Math.floor((year-1980)/4));
  put(3,spring,'春分の日');put(4,29,'昭和の日');put(5,3,'憲法記念日');put(5,4,'みどりの日');put(5,5,'こどもの日');
  put(7,nthMonday(7,3),'海の日');put(8,11,'山の日');put(9,nthMonday(9,3),'敬老の日');put(9,autumn,'秋分の日');
  put(10,nthMonday(10,2),'スポーツの日');put(11,3,'文化の日');put(11,23,'勤労感謝の日');
  // The Olympic-year exceptions are not ordinary calendar rules.
  if(year===2020){h.delete(`${year}-07-20`);h.delete(`${year}-10-12`);h.delete(`${year}-08-11`);put(7,23,'海の日');put(7,24,'スポーツの日');put(8,10,'山の日');}
  if(year===2021){h.delete(`${year}-07-19`);h.delete(`${year}-10-11`);h.delete(`${year}-08-11`);put(7,22,'海の日');put(7,23,'スポーツの日');put(8,8,'山の日');}
  const originals=[...h.keys()].sort();
  // Citizen's holidays lie between two national holidays (e.g., 2026-09-22).
  for(let day=1;day<=365+(new Date(Date.UTC(year,1,29)).getUTCMonth()===1?1:0);day++){
    const d=dateKey(new Date(Date.UTC(year,0,day)));
    if(d.slice(0,4)!==String(year)||h.has(d)||new Date(d+'T00:00:00Z').getUTCDay()===0)continue;
    if(h.has(datePlus(d,-1))&&h.has(datePlus(d,1)))h.set(d,'国民の休日');
  }
  // Substitute holiday: for each Sunday national holiday, first subsequent
  // non-holiday weekday (including a chain of Golden Week holidays).
  for(const d of originals){
    const [y,m,day]=d.split('-').map(Number);
    if(new Date(Date.UTC(y,m-1,day)).getUTCDay()!==0)continue;
    let after=datePlus(d,1);
    while(h.has(after))after=datePlus(after,1);
    h.set(after,'振替休日');
  }
  holidayCache.set(year,h);return h;
}
function automaticClosure(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return null;
  const [year,month,day]=date.split('-').map(Number);
  if(year<2000||year>2099)return null;
  const weekday=new Date(Date.UTC(year,month-1,day)).getUTCDay();
  const holiday=japaneseHolidays(year).get(date);
  if(!holiday&&weekday!==0)return null;
  return {date,note:holiday?`${holiday}のため休校`:'日曜日のため休校',automatic:true,holidayName:holiday||''};
}


module.exports={automaticClosure,japaneseHolidays};
