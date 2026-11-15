// Shiftly-T: day-scoped regular lesson reassignment editor.
// Does not modify schoolStudents.regularSlots. All edits are staged until Publish.
// The parent module injects Firestore access and existing permission helpers.
export function installNormalEditor(ctx){
  const {state,$,make,db,collection,doc,getDocs,query,where,writeBatch,serverTimestamp,
    auditChange,lessonNoticePayload,isAdmin,isAssignableTeacher,lessonsOnDate,
    courseFor,closureFor,CLASS_PERIODS,todayKey,prettyDate,canTeacherWork,teacherWorkReady,showMessage,
    trapError,openLessonForm,openCourseEditor,nav,renderAll}=ctx;
  const normalAuthority=ctx.normalAuthority;
  const capacity=2;
  const page=document.createElement('section');
  page.id='normalEditorPage';
  page.className='page normal-editor-page';
  page.hidden=true;
  page.innerHTML=`
    <div class="section-title normal-editor-title">
      <div><p class="eyebrow">REGULAR SCHEDULE EDITOR</p>
        <h2>通常授業エディター</h2>
        <p class="muted">講師の欠席はコマ単位。授業を別講師へドラッグ、または授業をタップして移動先をタップします。毎週の基本設定は変更しません。</p></div>
      <button id="normalPreview" class="ghost" type="button">時間割をプレビュー</button>
    </div>
    <div class="normal-editor-toolbar">
      <div class="normal-date-nav">
        <button id="normalPrev" type="button" class="ghost" aria-label="前の日">‹</button>
        <input id="normalDate" type="date" aria-label="編集する日付">
        <button id="normalNext" type="button" class="ghost" aria-label="次の日">›</button>
        <button id="normalToday" type="button" class="ghost">今日</button>
      </div>
      <div class="normal-editor-actions">
        <button id="normalAdd" type="button" class="ghost">＋ 授業を登録</button>
        <button id="normalEditSelected" type="button" class="ghost" hidden>選択授業を詳しく編集</button>
        <button id="normalUndo" type="button" class="ghost" disabled>↶ 取り消す</button>
        <button id="normalDiscard" type="button" class="ghost" disabled>変更を破棄</button>
        <button id="normalPublish" type="button" class="primary" disabled>変更を確定</button>
      </div>
    </div>
    <p id="normalEditorWarning" class="normal-editor-warning" role="status"></p>
    <div class="normal-editor-scroll" id="normalGrid"></div>
    <p class="normal-editor-footnote">黒いコマには配置できません。黒いコマに残っている授業は、別の出勤可能な講師へ移動できます。原則、担当講師1人につき1コマ2人まで。授業時間の変更・削除は「詳しく編集」から行います。</p>
  `;
  $('coursesPage').after(page);
  const absenceDialog=document.createElement('dialog');
  absenceDialog.className='modal';
  absenceDialog.id='normalAbsenceDialog';
  absenceDialog.innerHTML=`
    <form class="modal-content" id="normalAbsenceForm">
      <div class="modal-head"><h2 id="normalAbsenceTitle">講師の欠席コマ</h2>
      <button type="button" id="normalAbsenceClose" class="close-modal" aria-label="閉じる">×</button></div>
      <p class="muted" id="normalAbsenceDate"></p>
      <p class="muted">欠席にすると該当コマが黒くなり、新たな授業は配置できません。ここでの選択は「変更を確定」するまで仮変更です。</p><p class="normal-editor-warning" id="normalAbsenceScheduleHint"></p>
      <div class="normal-absence-options" id="normalAbsenceOptions"></div>
      <div class="normal-absence-quick">
        <button type="button" class="mini-button" data-normal-preset="none">全コマ出勤可能</button>
        <button type="button" class="mini-button" data-normal-preset="all">全コマ欠席</button>
        <button type="button" class="mini-button" data-normal-preset="late">1・2限のみ出勤</button>
        <button type="button" class="mini-button" data-normal-preset="early">3・4限のみ出勤</button>
      </div>
      <div class="modal-actions"><button class="primary" type="submit">仮設定に反映</button></div>
    </form>`;
  document.body.append(absenceDialog);
  // A touch selection re-renders the card. Its synthesized click may target the
  // replacement node, so a closure on the removed button cannot suppress it.
  let pointerClickGuard=null;
  $('normalGrid').addEventListener('click',event=>{
    const g=pointerClickGuard;if(!g||performance.now()>g.until)return;
    const samePointer=('pointerId' in event)?event.pointerId===g.id:Math.hypot(event.clientX-g.x,event.clientY-g.y)<25;
    if(samePointer&&Math.hypot(event.clientX-g.x,event.clientY-g.y)<25){pointerClickGuard=null;event.preventDefault();event.stopImmediatePropagation();}
  },true);
  const m={date:todayKey(),loadedDate:'',draft:new Map(),originals:new Map(),
    absent:new Map(),absentOriginals:new Map(),baseline:'',history:[],
    selected:'',drag:null,busy:false,external:false,openUid:''};
  const cloneLessons=map=>new Map([...map].map(([id,e])=>[id,{...e}]));
  const cloneAbsences=map=>new Map([...map].map(([uid,periods])=>[uid,new Set(periods)]));
  const teacherList=()=>state.people.filter(p=>isAssignableTeacher(p.role))
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ja'));
  const periodNumbers=e=>CLASS_PERIODS.filter(p=>e.start<p.end&&e.end>p.start).map(p=>p.number);
  const absentKey=(date,uid)=>`${date}_${uid}`;
  const statusReady=()=>state.entriesStatus==='ready'&&state.coursesStatus==='ready'
    &&state.closuresStatus==='ready'&&state.openDaysStatus==='ready'
    &&state.teacherAbsencesStatus==='ready'
    &&teacherWorkReady();
  const activeEntries=()=>lessonsOnDate(m.date).filter(e=>!e.courseId);
  function absenceSource(){
    const out=new Map();
    for(const teacher of teacherList()){
      const record=state.teacherAbsences?.[absentKey(m.date,teacher.id)];
      out.set(teacher.id,new Set((record?.absentPeriods||[]).map(Number).filter(n=>n>=1&&n<=4)));
    }
    return out;
  }
  function liveSignature(){
    const lessons=activeEntries().map(e=>[e.id,e.studentId,e.start,e.end,e.teacherUid,e.status,e.subject,e.studentName,e.teacherName])
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    const absent=[...absenceSource()].map(([uid,set])=>[uid,[...set].sort()]).sort((a,b)=>a[0].localeCompare(b[0]));
    const weekly=teacherList().map(p=>[p.id,CLASS_PERIODS.map(period=>canTeacherWork(p.id,m.date,period.number))]);
    return JSON.stringify([lessons,absent,weekly]);
  }
  function load(){
    if(!statusReady())return false;
    m.loadedDate=m.date;
    m.originals=new Map(activeEntries().map(e=>[e.id,{...e}]));
    m.draft=cloneLessons(m.originals);
    m.absentOriginals=absenceSource();
    m.absent=cloneAbsences(m.absentOriginals);
    m.baseline=liveSignature();
    m.history=[];
    m.selected='';m.external=false;
    return true;
  }
  const lessonKey=e=>JSON.stringify([e?.studentId,e?.date,e?.start,e?.end,e?.teacherUid,e?.status]);
  function entryChanges(){
    return [...m.draft.values()].filter(e=>lessonKey(e)!==lessonKey(m.originals.get(e.id)));
  }
  const normalizedAbsence=set=>JSON.stringify([...set].sort());
  function absenceChanges(){
    return [...m.absent].filter(([uid,periods])=>normalizedAbsence(periods)!==normalizedAbsence(m.absentOriginals.get(uid)||new Set()));
  }
  const hasChanges=()=>entryChanges().length>0||absenceChanges().length>0;
  function snapshot(){
    m.history.push({draft:cloneLessons(m.draft),absent:cloneAbsences(m.absent)});
    if(m.history.length>40)m.history.shift();
  }
  function teacherAbsent(uid,number){
    return m.absent.get(uid)?.has(number)===true || !canTeacherWork(uid,m.date,number);
  }
  function pendingLessons(){
    return [...m.draft.values()].filter(e=>e.status!=='cancelled'&&periodNumbers(e).some(n=>teacherAbsent(e.teacherUid,n)));
  }
  function checkMove(item,teacherUid,targetPeriod){
    if(item.status!=='scheduled')return '実施済み・生徒欠席の授業はエディターから移動できません。';
    if(!periodNumbers(item).includes(targetPeriod))return '授業と同じ時間帯の講師へ移動してください。授業時間の変更は「詳しく編集」から行います。';
    const teacher=teacherList().find(p=>p.id===teacherUid);
    if(!teacher)return '担当可能な講師を選択してください。';
    if(periodNumbers(item).some(n=>teacherAbsent(teacherUid,n)))return '欠席（黒いコマ）の講師には授業を配置できません。';
    for(const n of periodNumbers(item)){
      const period=CLASS_PERIODS.find(p=>p.number===n);
      const overlap=[...m.draft.values()].filter(e=>e.id!==item.id&&e.status!=='cancelled'
        &&e.teacherUid===teacherUid&&e.start<period.end&&e.end>period.start);
      if(overlap.length>=capacity)return `${n}限の担当上限（講師1人あたり${capacity}人）を超えます。`;
    }
    return '';
  }
  function move(id,teacherUid,targetPeriod){
    if(!isAdmin()||m.busy)return;
    const item=m.draft.get(id);
    if(!item)return;
    const validation=checkMove(item,teacherUid,targetPeriod);
    if(validation){showMessage(validation);return;}
    if(item.teacherUid===teacherUid){m.selected='';render();return;}
    snapshot();
    const teacher=teacherList().find(p=>p.id===teacherUid);
    m.draft.set(id,{...item,teacherUid,teacherName:teacher?.name||teacherUid});
    m.selected='';render();
  }
  function selectLesson(id){
    if(!m.draft.has(id))return;
    const item=m.draft.get(id);
    if(item.status!=='scheduled'){showMessage('この授業は移動できません。詳細編集を使用してください。');return;}
    m.selected=m.selected===id?'':id;
    render();
  }
  function changeDate(date){
    if(m.busy)return false;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return false;
    if(m.date===date)return true;
    if(hasChanges()&&!confirm('未確定の授業振替・欠席設定があります。破棄して日付を変えますか？'))return false;
    m.date=date;state.date=date;m.loadedDate='';m.selected='';
    render();return true;
  }
  function open(date){
    if(!isAdmin())return;
    changeDate(date||state.date||todayKey());
    render();
  }
  function reset(){m.renderedDate='';m.loadedDate='';m.history=[];m.selected='';m.draft=new Map();m.originals=new Map();
    m.absent=new Map();m.absentOriginals=new Map();m.external=false;}
  function onData(){
    if(!isAdmin())return;
    if(!hasChanges()&&m.loadedDate===m.date&&statusReady()&&m.baseline!==liveSignature())m.loadedDate='';
    render();
  }
  function card(entry,periodNumber){
    const selected=m.selected===entry.id;
    const blocked=periodNumbers(entry).some(n=>teacherAbsent(entry.teacherUid,n));
    const b=make('button','normal-entry'+(selected?' is-selected':'')+(entry.status==='cancelled'?' is-cancelled':'')+(blocked?' is-pending':''));
    b.type='button';
    b.dataset.entryId=entry.id;
    b.append(make('strong','',`${entry.studentName||'生徒'}${periodNumbers(entry).length>1?'（連続）':''}`));
    b.append(make('small','',`${entry.subject||'教科未設定'}${blocked?' / ⚠ 要振替':''}${entry.status==='cancelled'?' / 生徒欠席':''}`));
    b.title='タップで選択、移動先をタップ。iPadではドラッグ操作も可能です。';
    b.setAttribute('aria-pressed',String(selected));
    let suppressClick=false;
    b.addEventListener('click',event=>{
      event.stopPropagation();
      if(suppressClick){suppressClick=false;return;}
      selectLesson(entry.id);
    });
    if(entry.status!=='scheduled')return b;
    b.addEventListener('pointerdown',event=>{
      if(m.busy||(!event.isPrimary)|| (event.pointerType==='mouse'&&event.button!==0))return;
      m.drag={id:entry.id,pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false,target:null};
      try{b.setPointerCapture(event.pointerId);}catch(_e){}
    });
    b.addEventListener('pointermove',event=>{
      const drag=m.drag;
      if(!drag||drag.id!==entry.id||drag.pointerId!==event.pointerId)return;
      if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<10)return;
      drag.moved=true;b.classList.add('is-dragging');
      document.querySelectorAll('.normal-cell.is-drop-target').forEach(el=>el.classList.remove('is-drop-target'));
      const node=document.elementFromPoint(event.clientX,event.clientY);
      const target=node?.closest?.('.normal-cell');
      if(target&&!target.classList.contains('is-absent')&&!target.classList.contains('is-closed')){
        target.classList.add('is-drop-target');drag.target=target;
      }else drag.target=null;
    });
    b.addEventListener('pointerup',event=>{
      const drag=m.drag;
      if(!drag||drag.id!==entry.id||drag.pointerId!==event.pointerId)return;
      if(drag.moved||event.pointerType==='touch')pointerClickGuard={id:event.pointerId,x:event.clientX,y:event.clientY,until:performance.now()+650};
      m.drag=null;b.classList.remove('is-dragging');
      document.querySelectorAll('.normal-cell.is-drop-target').forEach(el=>el.classList.remove('is-drop-target'));
      if(drag.moved){
        suppressClick=true;
        if(drag.target)move(entry.id,drag.target.dataset.uid,Number(drag.target.dataset.period));
        else showMessage('移動先の講師の出勤可能なコマまでドラッグしてください。');
      }else if(event.pointerType==='touch'){
        suppressClick=true;event.preventDefault();selectLesson(entry.id);
      }
    });
    b.addEventListener('pointercancel',()=>{
      m.drag=null;b.classList.remove('is-dragging');
      document.querySelectorAll('.normal-cell.is-drop-target').forEach(el=>el.classList.remove('is-drop-target'));
    });
    return b;
  }
  function renderGrid(teachers){
    const host=$('normalGrid');
    host.replaceChildren();
    const table=make('table','normal-table');
    const thead=make('thead');
    const row=make('tr');
    const corner=make('th','normal-time-head','時間・コマ');
    corner.scope='col';row.append(corner);
    for(const teacher of teachers){
      const th=make('th','normal-teacher-head');
      th.scope='col';
      const label=make('button','normal-teacher-button',teacher.name||teacher.id);
      label.type='button';label.title='タップしてコマ別欠席を設定';
      label.addEventListener('click',()=>showAbsence(teacher.id));
      const count=m.absent.get(teacher.id)?.size||0;
      if(count)th.classList.add('has-absences');
      th.append(label,make('small','',count?`欠席 ${count}コマ・タップして変更`:'講師名をタップして欠席設定'));
      row.append(th);
    }
    thead.append(row);table.append(thead);
    const body=make('tbody');
    for(const period of CLASS_PERIODS){
      const tr=make('tr');
      const time=make('th','normal-period');
      time.scope='row';time.append(make('strong','',`${period.number}限`),make('small','',`${period.start}〜${period.end}`));
      tr.append(time);
      for(const teacher of teachers){
        const absent=teacherAbsent(teacher.id,period.number);
        const td=make('td','normal-cell'+(absent?' is-absent':''));
        td.dataset.uid=teacher.id;
        td.dataset.period=String(period.number);
        td.title=absent?'欠席：ドロップ不可':'授業の移動先（タップ可能）';
        td.tabIndex=0;td.setAttribute('role','button');
        td.setAttribute('aria-label',`${teacher.name||'講師'} ${period.number}限 ${absent?'欠席・配置不可':'配置可能'}`);
        const label=make('div','normal-cell-label',absent?'⛔ 欠席・配置不可':'');
        td.append(label);
        const entries=[...m.draft.values()].filter(e=>e.teacherUid===teacher.id&&e.start<period.end&&e.end>period.start)
          .sort((x,y)=>String(x.studentName||'').localeCompare(String(y.studentName||''),'ja'));
        for(const entry of entries)td.append(card(entry,period.number));
        if(!absent&&!entries.length)td.append(make('div','normal-empty','空き'));
        function activate(){
          if(m.busy||absent)return;
          if(m.selected)move(m.selected,teacher.id,period.number);
          else {
            if(hasChanges()){showMessage('先に変更を確定するか破棄してから、新しい授業を登録してください。');return;}
            state.date=m.date;openLessonForm();
            if($('lessonTeacher'))$('lessonTeacher').value=teacher.id;
            if($('lessonStart'))$('lessonStart').value=period.start;
            if($('lessonEnd'))$('lessonEnd').value=period.end;
          }
        }
        td.addEventListener('click',activate);
        td.addEventListener('keydown',event=>{
          if(event.target!==td)return;
          if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}
        });
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);host.append(table);
    const extras=[...m.draft.values()].filter(e=>!periodNumbers(e).length);
    if(extras.length){
      const extra=make('div','normal-extra');
      extra.append(make('strong','','通常の4コマ以外の授業（従来の編集画面から変更）'));
      for(const e of extras){
        const b=make('button','mini-button',`${e.start}〜${e.end}　${e.studentName||'生徒'} / ${e.teacherName||'講師'}`);
        b.type='button';b.addEventListener('click',()=>openLessonForm(e.id));extra.append(b);
      }
      host.append(extra);
    }
  }
  function render(){
    if(!isAdmin()||state.page!=='adminLessons')return;
    if(m.date!==state.date) m.date=state.date;
    for(const id of ['normalDate','normalPrev','normalNext','normalToday','normalPreview'])$(id).disabled=m.busy;
    $('normalDate').value=m.date;
    const grid=$('normalGrid'),keepScroll=m.renderedDate===m.date;
    const scrollLeft=keepScroll?grid.scrollLeft:0,scrollTop=keepScroll?grid.scrollTop:0;
    grid.replaceChildren();
    $('normalEditorWarning').textContent='';
    $('normalAdd').disabled=m.busy;
    if(!statusReady()){
      $('normalEditorWarning').textContent=!teacherWorkReady()?'勤務設定を確認できないため、新規配置を停止しています。':state.teacherAbsencesStatus==='error'
        ?'講師の欠席情報を読み込めません。FirestoreのteacherDayAbsencesルールを設定してください。'
        :'生徒・授業・勤務情報を読み込んでいます。';
      $('normalPublish').disabled=true;return;
    }
    if(courseFor(m.date)){
      const banner=make('div','normal-editor-banner',`${prettyDate(m.date)}は講習期間中です。通常授業の変更は行わず、講習配置エディターを使ってください。`);
      const button=make('button','primary','講習配置エディターへ');
      button.type='button';
      button.addEventListener('click',()=>{const course=courseFor(m.date);if(openCourseEditor(course.id))nav('courseEditor');});
      $('normalGrid').append(banner,button);
      $('normalPublish').disabled=true;return;
    }
    if(closureFor(m.date)){
      $('normalGrid').append(make('div','normal-editor-banner','この日は休校日です。休校日管理から開校設定を行ってください。'));
      $('normalPublish').disabled=true;return;
    }
    if(m.loadedDate!==m.date){
      if(!load())return;
    }else if(m.baseline!==liveSignature()){
      if(hasChanges())m.external=true;
      else load();
    }
    const teachers=teacherList();
    if(!teachers.length){
      $('normalGrid').append(make('div','empty','担当講師が登録されていません。'));
      $('normalPublish').disabled=true;return;
    }
    renderGrid(teachers);
    grid.scrollLeft=scrollLeft;grid.scrollTop=scrollTop;m.renderedDate=m.date;
    const changes=entryChanges(),aChanges=absenceChanges(),pending=pendingLessons();
    const warnings=[];
    if(m.external)warnings.push('⚠ 他の端末で時間割または欠席設定が変更されました。変更を破棄して再読み込みしてください。');
    if(pending.length)warnings.push(`⚠ 欠席コマに未振替の授業が${pending.length}件残っています（担当調整中）。`);
    if(changes.length||aChanges.length)warnings.push(`仮変更：担当振替${changes.length}件、欠席設定${aChanges.length}講師分。`);
    $('normalEditorWarning').textContent=warnings.join('　');
    $('normalUndo').disabled=!m.history.length||m.busy;
    $('normalDiscard').disabled=!hasChanges()||m.busy;
    $('normalPublish').disabled=!hasChanges()||m.busy||m.external;
    $('normalEditSelected').hidden=!m.selected;
    $('normalAdd').disabled=hasChanges()||m.busy;
    $('normalEditSelected').disabled=hasChanges()||m.busy;
  }
  function showAbsence(uid){
    if(!isAdmin()||m.busy)return;
    m.openUid=uid;
    const teacher=state.people.find(p=>p.id===uid);
    $('normalAbsenceTitle').textContent=`${teacher?.name||'講師'}｜コマ別欠席`;
    $('normalAbsenceDate').textContent=`${m.date.slice(0,4)}年${prettyDate(m.date)}`;
    const off=CLASS_PERIODS.filter(p=>!canTeacherWork(uid,m.date,p.number));
    $('normalAbsenceScheduleHint').textContent=off.length?'通常勤務曜日・臨時出勤設定により'+off.map(p=>p.number+'限').join('・')+'は勤務不可です。出勤を認める場合は「講師管理」でこの日の臨時出勤を設定してください。':'';
    const options=$('normalAbsenceOptions');options.replaceChildren();
    for(const p of CLASS_PERIODS){
      const row=make('label','normal-absence-row');
      const input=make('input');input.type='checkbox';input.value=String(p.number);
      input.checked=m.absent.get(uid)?.has(p.number)===true; // explicit absence only; weekly off-days stay separate
      row.append(make('strong','',`${p.number}限　${p.start}〜${p.end}`),make('span','', '欠席'),input);
      options.append(row);
    }
    absenceDialog.showModal();
  }
  $('normalAbsenceClose').addEventListener('click',()=>absenceDialog.close());
  absenceDialog.querySelectorAll('[data-normal-preset]').forEach(b=>b.addEventListener('click',()=>{
    const preset=b.dataset.normalPreset;
    const nums=preset==='all'?[1,2,3,4]:preset==='late'?[3,4]:preset==='early'?[1,2]:[];
    $('normalAbsenceOptions').querySelectorAll('input').forEach(input=>{input.checked=nums.includes(Number(input.value));});
  }));
  $('normalAbsenceForm').addEventListener('submit',event=>{
    event.preventDefault();
    const uid=m.openUid;if(!uid||m.busy||!isAdmin())return;
    const next=new Set([...$('normalAbsenceOptions').querySelectorAll('input:checked')].map(e=>Number(e.value)));
    if(normalizedAbsence(next)!==normalizedAbsence(m.absent.get(uid)||new Set())){
      snapshot();m.absent.set(uid,next);
    }
    absenceDialog.close();render();
  });
  $('normalPrev').addEventListener('click',()=>changeDate(ctx.datePlus(m.date,-1)));
  $('normalNext').addEventListener('click',()=>changeDate(ctx.datePlus(m.date,1)));
  $('normalToday').addEventListener('click',()=>changeDate(todayKey()));
  $('normalDate').addEventListener('change',event=>{if(!changeDate(event.target.value))event.target.value=m.date;});
  $('normalPreview').addEventListener('click',()=>nav('adminSchedule'));
  $('normalAdd').addEventListener('click',()=>{if(!hasChanges()){state.date=m.date;openLessonForm();}});
  $('normalEditSelected').addEventListener('click',()=>{if(!hasChanges()&&m.selected)openLessonForm(m.selected);});
  $('normalUndo').addEventListener('click',()=>{
    if(!m.history.length||m.busy)return;
    const prev=m.history.pop();m.draft=prev.draft;m.absent=prev.absent;m.selected='';render();
  });
  $('normalDiscard').addEventListener('click',()=>{if(m.busy||!confirm('未確定の振替と欠席設定をすべて破棄しますか？'))return;load();render();});
  async function publish(){
    if(!isAdmin()||m.busy||!statusReady()||m.external||courseFor(m.date)||closureFor(m.date))return;
    const moves=entryChanges(),absences=absenceChanges();
    if(!moves.length&&!absences.length)return;
    if(m.baseline!==liveSignature()){m.external=true;render();showMessage('他の端末でデータが変更されました。再読み込みしてください。');return;}
    const pending=pendingLessons();
    if(pending.length&&!confirm(`欠席コマに未振替の授業が${pending.length}件残っています。担当調整中として保存しますか？（授業は削除されず、講師側にも要振替と表示されます）`))return;
    if(moves.length+absences.length>100){showMessage('変更が多すぎます。数回に分けて保存してください。');return;}
    m.busy=true;render();
    try{
      if(normalAuthority?.enabled()){
        await normalAuthority.saveDay({date:m.date,
          changes:moves.map(entry=>({id:entry.id,before:m.originals.get(entry.id),value:entry})),
          absences:absences.map(([teacherUid,ps])=>({teacherUid,periods:[...ps].sort(),before:state.teacherAbsences?.[absentKey(m.date,teacherUid)]||null}))});
        m.history=[];m.selected='';m.external=false;m.loadedDate='';
        showMessage(`担当振替${moves.length}件、講師欠席設定${absences.length}件を保存しました。毎週の通常授業設定は変更していません。`);
        renderAll();return;
      }
      // Re-read currently stored lessons for this day before any write.
      const latest=await getDocs(query(collection(db,'timetableEntries'),where('date','==',m.date)));
      if(m.baseline!==liveSignature())throw Error('保存中に時間割が変更されました。変更を破棄して再読み込みしてください。');
      const currentDateRows=state.entries.filter(e=>e.date===m.date);
      const live=latest.docs.map(s=>({id:s.id,...s.data()}));
      const key=rows=>JSON.stringify(rows.map(e=>[e.id,e.teacherUid,e.date,e.start,e.end,e.status,e.regularId||'',e.courseId||'']).sort((a,b)=>a[0].localeCompare(b[0])));
      if(key(currentDateRows)!==key(live))throw Error('別の端末から授業が変更されました。再読み込みして確認してください。');
      const absFresh=await getDocs(query(collection(db,'teacherDayAbsences'),where('date','==',m.date)));
      const oldAbs=Object.values(state.teacherAbsences||{}).filter(e=>e.date===m.date);
      const absKey=rows=>JSON.stringify(rows.map(e=>[e.teacherUid,[...(e.absentPeriods||[])].sort()]).sort((a,b)=>a[0].localeCompare(b[0])));
      if(absKey(absFresh.docs.map(x=>x.data()))!==absKey(oldAbs))throw Error('別の端末で講師の欠席情報が変更されました。');
      if(m.baseline!==liveSignature())throw Error('保存中に時間割が変更されました。変更を破棄して再読み込みしてください。');
      for(const entry of moves){
        for(const p of periodNumbers(entry)){
          if(teacherAbsent(entry.teacherUid,p))throw Error('欠席コマの講師へ授業を移動できません。');
          const period=CLASS_PERIODS.find(x=>x.number===p);
          const peers=[...m.draft.values()].filter(e=>e.id!==entry.id&&e.status!=='cancelled'
            &&e.teacherUid===entry.teacherUid&&e.start<period.end&&e.end>period.start);
          if(peers.length>=capacity)throw Error(`${p}限で担当上限を超えています。`);
        }
      }
      const batch=writeBatch(db);
      const group=doc(collection(db,'auditLogs')).id;
      for(const entry of moves){
        const before=m.originals.get(entry.id);
        const teacher=state.people.find(p=>p.id===entry.teacherUid);
        const next={...entry,teacherName:teacher?.name||entry.teacherName};
        const ref=doc(db,'timetableEntries',entry.id);
        if(before?.virtual){
          const data={studentId:entry.studentId,studentName:entry.studentName||'',grade:entry.grade||'',school:entry.school||'',
            teacherUid:entry.teacherUid,teacherName:next.teacherName,date:entry.date,start:entry.start,end:entry.end,
            subject:entry.subject||'',status:entry.status||'scheduled',memo:entry.memo||'',
            memoUpdatedAt:entry.memoUpdatedAt||null,nextDates:entry.nextDates||[],regularId:entry.regularId};
          batch.set(ref,data);
          auditChange(batch,ref.path,null,data,'追加',`${prettyDate(m.date)} ${entry.studentName||'生徒'}さんの日別担当変更`,group);
        }else{
          batch.update(ref,{teacherUid:entry.teacherUid,teacherName:next.teacherName});
          auditChange(batch,ref.path,before,{...before,teacherUid:entry.teacherUid,teacherName:next.teacherName},'変更',`${prettyDate(m.date)} ${entry.studentName||'生徒'}さんの日別担当変更`,group);
        }
        for(const uid of new Set([before?.teacherUid,entry.teacherUid].filter(Boolean))){
          batch.set(doc(collection(db,'notifications',uid,'items')),lessonNoticePayload(before,{...next,id:entry.id}));
        }
      }
      for(const [uid,periods] of absences){
        const ref=doc(db,'teacherDayAbsences',absentKey(m.date,uid));
        const before=state.teacherAbsences?.[absentKey(m.date,uid)]||null;
        const after=periods.size?{date:m.date,teacherUid:uid,absentPeriods:[...periods].sort(),
          updatedBy:state.user.uid,updatedAt:serverTimestamp()}:null;
        if(after)batch.set(ref,after);else batch.delete(ref);
        auditChange(batch,ref.path,before,after,after?'変更':'解除',`${prettyDate(m.date)}の講師欠席コマ`,group);
      }
      await batch.commit();
      m.history=[];m.selected='';m.external=false;m.loadedDate='';
      showMessage(`担当振替${moves.length}件、講師欠席設定${absences.length}件を保存しました。毎週の通常授業設定は変更していません。`);
      renderAll();
    }catch(error){
      console.error('通常授業エディター確定エラー',error);
      trapError(error,'通常授業エディターを保存できません。Firestoreルールと他の端末の変更を確認してください。');
    }finally{m.busy=false;render();}
  }
  $('normalPublish').addEventListener('click',publish);
  return {open,render,onData,reset,hasChanges,isBusy:()=>m.busy};
}
