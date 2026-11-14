// Pure, read-only academic-year presentation. No Firebase imports or writes.
const japanDateKey=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function gradeInfo(value=''){
  const raw=String(value||'').trim();
  // Examples: 小2 / 小学2年 / 小学校2年 / 中3 / 中学3年 / 高校1年.
  const m=raw.match(/^(小学生|小学(?:校)?|小|中学生|中学(?:校)?|中|高校生|高校|高)\s*([1-6一二三四五六１-６]?)/);
  if(!m)return {level:'other',rank:3,year:99};
  const prefix=m[1];const level=prefix.startsWith('小')?'elementary':prefix.startsWith('中')?'middle':'high';
  const ranks={elementary:0,middle:1,high:2};
  const numerals={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6};
  const year=m[2]?Number(m[2].normalize('NFKC'))||numerals[m[2]]||99:99;
  return {level,rank:ranks[level],year};
}
// Academic-year rollover is based on JST, not the device's local timezone.
// Legacy students created before this feature are assumed to have a 2026 school-year grade.
const LEGACY_GRADE_YEAR = 2026;
const GRADE_STAGES = ['小1','小2','小3','小4','小5','小6','中1','中2','中3','高1','高2','高3','卒業'];
export function academicYearForDate(date){
  const [year,month]=String(date||japanDateKey()).split('-').map(Number);
  return year-(month<4?1:0);
}
export const academicYearJST = () => academicYearForDate(japanDateKey());
export function gradeRecordYear(student){
  const v=Number(student?.gradeYear);
  return Number.isInteger(v) && v>=2000 && v<=2100 ? v : LEGACY_GRADE_YEAR;
}
export function shiftGrade(value,years){
  const original=String(value||'').trim();
  if(!years)return original;
  const info=gradeInfo(original);
  let index=original==='卒業'?12:
    info.level==='elementary'?info.year-1:
    info.level==='middle'?5+info.year:
    info.level==='high'?8+info.year:-1;
  if(!Number.isInteger(years)||index<0||index>=GRADE_STAGES.length)return original;
  return GRADE_STAGES[Math.min(GRADE_STAGES.length-1,Math.max(0,index+years))];
}
export function displayStudentGrade(student,date){
  return shiftGrade(student.grade,academicYearForDate(date)-gradeRecordYear(student));
}
