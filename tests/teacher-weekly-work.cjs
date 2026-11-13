#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');

(async()=>{
  const root=path.join(__dirname,'..');
  const file=name=>fs.readFileSync(path.join(root,name),'utf8');
  const moduleSource=file('teacher-work.js');
  // Import only this local helper module from memory; no Firebase or real network.
  const impl=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
  const work=impl.teacherCanWork;
  const weekly={teacherA:{weekdays:[1,4]}}; // Mon & Thu
  const dates={};
  const check=(date,period,want,overrides=dates,ws='ready',ds='ready')=>
    assert.equal(work(weekly,overrides,ws,ds,'teacherA',date,period),want,
      date+' period '+period);
  check('2026-11-16',1,true);  // Monday
  check('2026-11-19',4,true);  // Thursday
  check('2026-11-17',1,false); // Tuesday
  check('2026-11-18',2,false); // Wednesday
  check('2026-11-20',3,false); // Friday
  check('2026-11-17',1,true,{'2026-11-17_teacherA':{availablePeriods:[1,2]}});
  check('2026-11-17',2,true,{'2026-11-17_teacherA':{availablePeriods:[1,2]}});
  check('2026-11-17',3,false,{'2026-11-17_teacherA':{availablePeriods:[1,2]}});
  check('2026-11-24',1,false); // next Tuesday is not changed
  check('2026-11-16',1,false,{'2026-11-16_teacherA':{availablePeriods:[]}});
  check('2026-11-17',1,true,{},'unavailable','ready'); // legacy fallback on missing rules
  assert.equal(work({}, {},'ready','ready','newTeacher','2026-11-17',1),true);
  assert.equal(work({'teacherA':{weekdays:[]}}, {},'ready','ready','teacherA','2026-11-19',1),false);
  // App integration contracts: avoid accidental regression when refactoring.
  const app=file('app.js'),editor=file('normal-editor.js'),html=file('index.html');
  for(const token of ['installTeacherWorkPage','teacherWeeklyWork','teacherDateWork',
    'teacherWorkPage?.works','teacherManagementPage','teacherWeeklyWorkStatus',
    'teacherWorkPage?.reset','teacherWorkPage?.render'])
    assert.ok(app.includes(token),'app.js misses '+token);
  assert.ok(editor.includes('!canTeacherWork(uid,m.date,number)'),'regular editor must respect weekly off-days');
  assert.ok(editor.includes('canTeacherWork(p.id,m.date,period.number)'),'external change signature missing');
  assert.ok(html.includes('teacher-work.css'),'teacher workday stylesheet missing');
  const guide=file('TEACHER_WEEKLY_WORK_GUIDE.md');
  assert.ok(guide.includes('allow read: if isMember()'));
  assert.ok(guide.includes('正式導入')||guide.includes('未導入'));
  console.log('teacher workday behavior and integration contracts: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
