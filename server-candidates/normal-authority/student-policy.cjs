'use strict';
const P=require('./policy.cjs');
const stages=['小1','小2','小3','小4','小5','小6','中1','中2','中3','高1','高2','高3','卒業'];
const academicYear=date=>Number(date.slice(0,4))-(Number(date.slice(5,7))<4?1:0);
function gradeAt(student,date){
 const raw=String(student.grade||'').trim(),year=Number(student.gradeYear),from=Number.isInteger(year)&&year>=2000&&year<=2100?year:2026,delta=academicYear(date)-from;
 if(!delta)return raw;
 const m=raw.match(/^(小学生|小学(?:校)?|小|中学生|中学(?:校)?|中|高校生|高校|高)\s*([1-6一二三四五六１-６]?)/),numerals={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6};
 const n=m?.[2]?(Number(m[2].normalize('NFKC'))||numerals[m[2]]||99):99;
 const index=raw==='卒業'?12:m?(m[1].startsWith('小')?n-1:m[1].startsWith('中')?5+n:8+n):-1;
 return index<0||index>=stages.length?raw:stages[Math.min(12,Math.max(0,index+delta))];
}
function cleanStudent(value,today){
 const lengths={name:80,grade:30,school:80,regular:2000,textbook:2000,remarks:4000};
 if(!value||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(lengths,k)&&!['gradeYear','regularSlots'].includes(k)))P.fail('invalid-argument','Unknown student fields');
 for(const [k,n]of Object.entries(lengths))if(typeof value[k]!=='string'||value[k].length>n||(['name','grade'].includes(k)&&!value[k].trim()))P.fail('invalid-argument','Invalid student text');
 if(value.gradeYear!==academicYear(today))P.fail('invalid-argument','Student grade year must match the current JST school year');
 const slots=value.regularSlots;
 if(!slots||typeof slots!=='object'||Array.isArray(slots)||Object.keys(slots).length>8)P.fail('invalid-argument','Use at most eight weekly slots');
 for(const [key,s]of Object.entries(slots)){
  if(!P.id(key)||key.length>50||!s||typeof s!=='object'||Object.keys(s).some(k=>!['id','weekday','start','end','teacherUid','subject','activeFrom','activeUntil'].includes(k))||s.id!==key||!P.id(s.teacherUid)||!Number.isInteger(s.weekday)||s.weekday<0||s.weekday>6||typeof s.subject!=='string'||s.subject.length>80)P.fail('invalid-argument','Invalid weekly slot');
  P.periods(s);P.date(s.activeFrom);if(Object.hasOwn(s,'activeUntil')&&typeof s.activeUntil!=='string')P.fail('invalid-argument','Invalid weekly end date');if(s.activeUntil){P.date(s.activeUntil);if(s.activeUntil<s.activeFrom)P.fail('invalid-argument','Invalid weekly interval');}
 }
 const list=Object.values(slots);
 for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i],b=list[j];if(a.weekday===b.weekday&&a.start<b.end&&a.end>b.start&&(a.activeFrom||'0001-01-01')<=(b.activeUntil||'9999-12-31')&&(b.activeFrom||'0001-01-01')<=(a.activeUntil||'9999-12-31'))P.fail('already-exists','Student weekly slots overlap');}
 return value;
}
const assignment=s=>s?JSON.stringify([Number(s.weekday),s.start,s.end,s.teacherUid,s.activeFrom||'',s.activeUntil||'']):'missing';
function nextDay(key,n=1){const d=P.date(key);d.setUTCDate(d.getUTCDate()+n);const v=d.toISOString().slice(0,10);return /^\d{4}-/.test(v)?v:null;}
// Between every change boundary, all inputs are constant except weekday.
// The first seven days of each interval therefore cover unbounded weekly tails.
function verificationDates(beforeStudents,afterStudents,tables,windows){
 const boundaries=new Set();let slotCount=0;
 const add=d=>{if(d){P.date(d);boundaries.add(d)}};
 for(const student of [...beforeStudents,...afterStudents])for(const s of Object.values(student.regularSlots||{})){
  if(++slotCount>4000)P.fail('resource-exhausted','Weekly dataset exceeds validated bound');
  add(s.activeFrom||'2000-01-01');if(s.activeUntil)add(nextDay(s.activeUntil));
 }
 for(const c of tables.courses){add(c.startDate);add(nextDay(c.endDate));}
 for(const r of [...tables.entries,...tables.daily,...tables.absences,...tables.closures,...tables.open,...tables.exams]){add(r.date||r.id);add(nextDay(r.date||r.id));}
 for(const s of windows){add(s.activeFrom||'2000-01-01');if(s.activeUntil)add(nextDay(s.activeUntil));}
 const result=new Set();
 for(const point of boundaries)for(let n=0;n<7;n++){const d=nextDay(point,n);if(d&&windows.some(s=>(s.activeFrom||'2000-01-01')<=d&&d<=(s.activeUntil||'9999-12-31')))result.add(d);}
 if(result.size>1500)P.fail('resource-exhausted','Weekly verification exceeds 1500 representative dates');
 return [...result].sort();
}
module.exports={cleanStudent,gradeAt,academicYear,assignment,verificationDates};
