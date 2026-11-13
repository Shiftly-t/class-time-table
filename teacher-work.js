// Teacher weekly working days and date-specific temporary attendance.
// The module never changes schoolStudents.regularSlots or seasonal course availability.
// The date key is local calendar date (YYYY-MM-DD); using UTC date-only arithmetic avoids time-zone drift.
export function teacherCanWork(weeklyRecords,exceptionRecords,weekStatus,dayStatus,uid,date,period){
  if(weekStatus==='disabled'&&dayStatus==='disabled')return true;
  if(weekStatus!=='ready'||dayStatus!=='ready')return false; // enabled but unverified: block new assignments
  const [year,month,day]=String(date||'').split('-').map(Number);
  const parsed=new Date(Date.UTC(year,month-1,day));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||parsed.getUTCFullYear()!==year||parsed.getUTCMonth()!==month-1||parsed.getUTCDate()!==day)return false;
  const exception=exceptionRecords?.[date+'_'+uid];
  if(exception)return Array.isArray(exception.availablePeriods)&&exception.availablePeriods.includes(period);
  const weekly=weeklyRecords?.[uid];
  if(!weekly)return true;
  const weekday=parsed.getUTCDay();
  return Array.isArray(weekly.weekdays)&&weekly.weekdays.includes(weekday);
}

export function installTeacherWorkPage(ctx){
  const {state,$,db,collection,doc,runTransaction,serverTimestamp,auditChange,isAdmin,
    isAssignableTeacher,showMessage,trapError,nav,prettyDate,todayKey,CLASS_PERIODS,featureEnabled=false}=ctx;
  const days=[{n:1,t:'月'},{n:2,t:'火'},{n:3,t:'水'},{n:4,t:'木'},
    {n:5,t:'金'},{n:6,t:'土'},{n:0,t:'日'}];
  const allWeekdays=days.map(x=>x.n);
  const allPeriods=CLASS_PERIODS.map(x=>x.number);
  const sorted=a=>[...a].sort((x,y)=>x-y);
  const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
  const teachers=()=>state.people.filter(p=>isAssignableTeacher(p.role))
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ja'));
  const storedWeek=uid=>state.teacherWeeklyWork?.[uid]||null;
  const dayId=(date,uid)=>date+'_'+uid;
  const storedDay=(date,uid)=>state.teacherDateWork?.[dayId(date,uid)]||null;
  const weekKey=rec=>rec?JSON.stringify(sorted(rec.weekdays||[])):'missing';
  const dateKey=rec=>rec?JSON.stringify(sorted(rec.availablePeriods||[])):'missing';
  const dayOfWeek=date=>{const v=String(date||'').split('-').map(Number);return new Date(v[0],v[1]-1,v[2]).getDay();};
  // An unconfigured teacher retains the old "all weekdays permitted" behavior.
  function works(uid,date,period){
    if(!featureEnabled)return true;
    return teacherCanWork(state.teacherWeeklyWork,state.teacherDateWork,
      state.teacherWeeklyWorkStatus,state.teacherDateWorkStatus,uid,date,period);
  }
  const navButton=document.createElement('button');
  navButton.id='navTeacherManagement';navButton.type='button';
  navButton.className='nav-tab';navButton.textContent='講師管理';navButton.hidden=true;
  $('navAdminLessons').after(navButton);
  const page=document.createElement('section');
  page.id='teacherManagementPage';page.className='page teacher-work-page';page.hidden=true;
  page.innerHTML='<div class="section-title"><div><p class="eyebrow">TEACHER WORK SCHEDULE</p>'+
    '<h2>講師管理・通常勤務曜日</h2><p class="muted">毎週の出勤曜日を設定します。講習の勤務希望とは別の設定です。'+
    '既存の授業は削除せず、勤務曜日外の授業には要振替の警告を出します。</p></div></div>'+
    '<div class="teacher-work-grid"><section class="panel">'+
    '<h3>通常勤務曜日（毎週）</h3><label>講師<select id="workTeacher"></select></label>'+
    '<p id="workWeekInfo" class="teacher-work-note"></p>'+
    '<div id="workWeekDays" class="teacher-work-days"></div>'+
    '<button type="button" class="primary" id="workWeekSave">通常勤務曜日を保存</button>'+
    '<p class="muted">未設定の講師は従来通り全曜日を出勤可能として扱います。'+
    '通常授業の4コマすべてに適用されます。</p></section>'+
    '<section class="panel"><h3>指定日の臨時出勤・臨時休み</h3>'+
    '<label>例外を設定する日付<input id="workSpecialDate" type="date"></label>'+
    '<p id="workDayInfo" class="teacher-work-note"></p>'+
    '<div id="workDayPeriods" class="teacher-work-days"></div>'+
    '<div class="teacher-work-buttons"><button type="button" class="primary" id="workDaySave">この日の出勤コマを保存</button>'+
    '<button type="button" class="ghost" id="workDayClear">通常勤務曜日に戻す</button></div>'+
    '<p class="muted">臨時出勤したいコマだけ選択できます。従来の「コマ別欠席」が設定されているコマは、そちらの欠席が優先されます。</p>'+
    '</section></div><p id="workError" class="teacher-work-error" role="status"></p>';
  $('adminCountPage').after(page);
  const weekOptions=$('workWeekDays'),dateOptions=$('workDayPeriods'),teacherSelect=$('workTeacher');
  let selected='',specialDate=todayKey(),weekDraft=[],dateDraft=[],weekBaseline='missing',
    dayBaseline='missing',weekDirty=false,dayDirty=false,busy=false,opened=false,generation=0;
  function checkbox(container,value,title,checked,change){
    const row=document.createElement('label');row.className='teacher-work-choice';
    const input=document.createElement('input');input.type='checkbox';input.value=String(value);
    input.checked=checked;input.addEventListener('change',change);
    const span=document.createElement('span');span.textContent=title;
    row.append(input,span);container.append(row);
  }
  function refreshDrafts(){
    const w=storedWeek(selected);
    weekDraft=w?sorted(w.weekdays||[]):sorted(allWeekdays);
    weekBaseline=weekKey(w);weekDirty=false;
    const d=storedDay(specialDate,selected);
    dateDraft=d?sorted(d.availablePeriods||[]):allPeriods.filter(p=>works(selected,specialDate,p));
    dayBaseline=dateKey(d);dayDirty=false;
  }
  function dateDefaults(){
    const w=storedWeek(selected);
    return allPeriods.filter(()=>!w||w.weekdays?.includes(dayOfWeek(specialDate)));
  }
  function resetDayDraft(){
    const d=storedDay(specialDate,selected);
    dateDraft=d?sorted(d.availablePeriods||[]):dateDefaults();
    dayBaseline=dateKey(d);dayDirty=false;
  }
  function render(){
    if(!isAdmin())return;
    const list=teachers();
    if(!list.some(x=>x.id===selected)){
      selected=list[0]?.id||'';refreshDrafts();
    }
    // Refresh clean drafts after Firestore listeners deliver updated schedules.
    // Preserve unsaved changes; the transaction will reject concurrent edits.
    if(!weekDirty && weekKey(storedWeek(selected))!==weekBaseline){
      const value=storedWeek(selected);
      weekDraft=value?sorted(value.weekdays||[]):sorted(allWeekdays);
      weekBaseline=weekKey(value);
    }
    if(!dayDirty){
      const value=storedDay(specialDate,selected);
      dateDraft=value?sorted(value.availablePeriods||[]):dateDefaults();
      dayBaseline=dateKey(value);
    }
    teacherSelect.replaceChildren();
    for(const p of list){
      const o=document.createElement('option');o.value=p.id;o.textContent=p.name||p.id;teacherSelect.append(o);
    }
    teacherSelect.value=selected;
    const ready=featureEnabled&&state.teacherWeeklyWorkStatus==='ready'&&state.teacherDateWorkStatus==='ready';
    $('workError').textContent=!featureEnabled?'この機能はまだ有効になっていません。':!ready?'勤務設定を確認できません。保存と新規配置を停止しています。運営に確認してください。':'';
    $('workWeekInfo').textContent=storedWeek(selected)
      ?'保存済み：'+(sorted(storedWeek(selected).weekdays||[]).map(n=>days.find(d=>d.n===n)?.t+'曜').join('・')||'出勤曜日なし')
      :'未設定：従来通り全曜日が出勤可能です';
    $('workDayInfo').textContent=storedDay(specialDate,selected)
      ?'この日は特別設定あり（通常勤務曜日より優先）'
      :'特別設定なし（通常勤務曜日を使用）';
    $('workSpecialDate').value=specialDate;
    weekOptions.replaceChildren();dateOptions.replaceChildren();
    for(const d of days)checkbox(weekOptions,d.n,d.t+'曜',weekDraft.includes(d.n),e=>{
      weekDraft=e.target.checked?sorted([...new Set([...weekDraft,d.n])]):weekDraft.filter(n=>n!==d.n);
      weekDirty=true;
    });
    for(const p of CLASS_PERIODS)checkbox(dateOptions,p.number,
      p.number+'限 '+p.start+'〜'+p.end,dateDraft.includes(p.number),e=>{
        dateDraft=e.target.checked?sorted([...new Set([...dateDraft,p.number])]):dateDraft.filter(n=>n!==p.number);
        dayDirty=true;
      });
    teacherSelect.disabled=busy||!list.length;
    $('workSpecialDate').disabled=busy||!list.length;
    $('workWeekSave').disabled=busy||!selected||!ready;
    $('workDaySave').disabled=busy||!selected||!ready;
    $('workDayClear').disabled=busy||!selected||!ready||!storedDay(specialDate,selected);
    for(const node of page.querySelectorAll('input[type=checkbox]'))node.disabled=busy||!ready;
  }
  function confirmDiscard(){return !weekDirty&&!dayDirty||confirm('未保存の通常勤務曜日・臨時出勤設定を破棄しますか？');}
  teacherSelect.addEventListener('change',()=>{
    const uid=teacherSelect.value;
    if(!confirmDiscard()){teacherSelect.value=selected;return;}
    selected=uid;refreshDrafts();render();
  });
  $('workSpecialDate').addEventListener('change',()=>{
    const date=$('workSpecialDate').value;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){render();return;}
    if((weekDirty||dayDirty)&&!confirmDiscard()){render();return;}
    specialDate=date;refreshDrafts();render();
  });
  async function transactionSave(type,clear=false){
    if(busy||!isAdmin()||!selected||!featureEnabled)return;
    if(state.teacherWeeklyWorkStatus!=='ready'||state.teacherDateWorkStatus!=='ready'){
      showMessage('勤務曜日の読込・Firestoreルールを確認してください。');return;
    }
    if(!state.people.some(p=>p.id===selected&&isAssignableTeacher(p.role))){
      showMessage('講師アカウントがありません。再読み込みしてください。');return;
    }
    const uid=selected,day=specialDate,week=sorted(weekDraft),periods=sorted(dateDraft);
    if(!days.every(d=>!week.includes(d.n)||Number.isInteger(d.n))||!week.every(n=>allWeekdays.includes(n)))return;
    if(!periods.every(n=>allPeriods.includes(n)))return;
    if(type==='weekly'){
      const affected=state.students.flatMap(s=>Object.values(s.regularSlots||{}))
        .filter(slot=>slot?.teacherUid===uid&&!week.includes(Number(slot.weekday)));
      if(affected.length&&!confirm('現在の通常授業 '+affected.length+
        '件が新しい勤務曜日から外れます。授業は削除されず「要振替」と表示されます。続行しますか？'))return;
    }
    const session=generation,actorUid=state.user?.uid;
    const baseline=type==='weekly'?weekBaseline:dayBaseline;
    const after=clear?null:type==='weekly'
      ?{weekdays:week,updatedBy:actorUid,updatedAt:serverTimestamp()}
      :{date:day,teacherUid:uid,availablePeriods:periods,updatedBy:actorUid,updatedAt:serverTimestamp()};
    busy=true;render();
    try{
      const ref=type==='weekly'?doc(db,'teacherWeeklyWork',uid):doc(db,'teacherDateWork',dayId(day,uid));
      await runTransaction(db,async tx=>{
        const snap=await tx.get(ref);
        if(session!==generation||state.user?.uid!==actorUid||!isAdmin())throw Error('ログイン状態が変わったため保存を中止しました。');
        const before=snap.exists()?snap.data():null;
        const latest=type==='weekly'?weekKey(before):dateKey(before);
        if(latest!==baseline)throw Error('他の端末で勤務曜日が変更されました。再読み込みして確認してください。');
        if(after)tx.set(ref,after);else if(before)tx.delete(ref);
        if(after||before)auditChange(tx,ref.path,before,after,after?'変更':'解除',
          (state.people.find(p=>p.id===uid)?.name||'講師')+'の'+(type==='weekly'?'通常勤務曜日':prettyDate(day)+'臨時出勤'));
      });
      if(session!==generation||state.user?.uid!==actorUid)return;
      if(type==='weekly'){state.teacherWeeklyWork={...state.teacherWeeklyWork,[uid]:after};weekDirty=false;weekBaseline=JSON.stringify(week);}
      else {state.teacherDateWork={...state.teacherDateWork};if(after)state.teacherDateWork[dayId(day,uid)]=after;else delete state.teacherDateWork[dayId(day,uid)];dayDirty=false;dayBaseline=clear?'missing':JSON.stringify(periods);if(clear)dateDraft=dateDefaults();}
      showMessage(type==='weekly'?'通常勤務曜日を保存しました。':'この日の例外設定を保存しました。');
    }catch(error){if(session===generation)trapError(error,'勤務曜日の保存に失敗しました。Firestoreルールと他の端末の変更を確認してください。');}
    finally{if(session===generation){busy=false;render();}}
  }
  $('workWeekSave').addEventListener('click',()=>transactionSave('weekly'));
  $('workDaySave').addEventListener('click',()=>transactionSave('day'));
  $('workDayClear').addEventListener('click',()=>{
    if(confirm('この日の臨時出勤設定を解除して、通常勤務曜日に戻しますか？'))transactionSave('day',true);
  });
  navButton.addEventListener('click',()=>nav('teacherManagement'));
  function open(){if(!isAdmin())return;if(!opened){refreshDrafts();opened=true;}render();}
  function discard(){refreshDrafts();opened=false;}
  function reset(){generation++;opened=false;selected='';specialDate=todayKey();weekDraft=[];dateDraft=[];weekDirty=false;dayDirty=false;busy=false;}
  return {works,render,open,reset,discard,isBusy:()=>busy,hasChanges:()=>weekDirty||dayDirty};
}
