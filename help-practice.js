// Standalone training UI. Uses only fictional data and DOM-local state.
// Never imports Firebase, calls APIs, or interacts with the operational workspace.
const btn=(label,action,cls='ghost')=>'<button type="button" class="'+cls+'" data-practice-action="'+action+'">'+label+'</button>';
const target=(label,action,cls='primary')=>btn(label,action,cls+' practice-target');
const panel=(title,content)=>'<section class="practice-panel"><h3>'+title+'</h3>'+content+'</section>';
const field=(label,type,id,placeholder='')=>'<label>'+label+'<input type="'+type+'" data-practice-field="'+id+'" placeholder="'+placeholder+'"></label>';
const select=(label,id,opts)=>'<label>'+label+'<select data-practice-field="'+id+'"><option value="">選択してください</option>'+opts.map(x=>'<option>'+x+'</option>').join('')+'</select></label>';
const table=(head,rows)=>'<div class="practice-table-wrap"><table><thead><tr>'+head.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const row=(...x)=>'<div class="practice-actions">'+x.join('')+'</div>';
const studentTable=()=>table(['生徒名','学年','通常授業'],[['練習 花子','中2','水曜 2限'],['練習 一郎','高1','金曜 3限']]);
const nav=(active,items)=>'<div class="practice-nav">'+items.map(x=>x===active?'<span class="active">'+x+'</span>':btn(x,'wrong')).join('')+'</div>';
const s=(hint,action,html,valid)=>({hint,action,html,valid});
const required=(...keys)=>values=>keys.every(k=>String(values[k]||'').trim());

// The templates below originate in the production HTML/normal-editor.js.
// They are parsed in a detached template, never cloned from live user data.
const templates={"header":"<header class=\"topbar\"><div class=\"brand\"><span class=\"brand-mark\">S</span><span>Shiftly-T<small>練習モード</small></span></div><div class=\"header-actions\"><button data-practice-action=\"wrong\"  class=\"icon-button help-guide-button\" type=\"button\" title=\"使い方\" aria-label=\"使い方ガイドを開く\"><svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 7c-2.5-2-5.5-2.6-9-1.4v13c3.5-1.2 6.5-.6 9 1.4 2.5-2 5.5-2.6 9-1.4v-13C17.5 4.4 14.5 5 12 7Z\"/><path d=\"M12 7v13\"/></svg><span>使い方</span></button><button data-practice-action=\"wrong\"  class=\"icon-button\" type=\"button\" title=\"通知\" aria-label=\"通知を表示\"><svg class=\"bell-icon\" viewBox=\"0 0 24 24\" width=\"23\" height=\"23\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9\"/><path d=\"M10 21h4\"/></svg><span class=\"notification-label\">通知</span></button><button data-practice-action=\"wrong\"  class=\"icon-button ghost\" type=\"button\" title=\"ログアウト\" aria-label=\"ログアウト\"><svg viewBox=\"0 0 24 24\" width=\"22\" height=\"22\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M13 5V3H4v18h9v-2\"/><path d=\"M9 12h12m-4-4 4 4-4 4\"/></svg><span>ログアウト</span></button></div></header>","schedule":"<section id=\"lessonsPage\" class=\"page\" hidden><div class=\"section-title\"><div><p class=\"eyebrow\">DAILY SCHEDULE</p><h2 id=\"scheduleHeading\">今日の時間割</h2><p class=\"muted\" id=\"scheduleDescription\">自分の担当授業と全教師の授業を切り替えられます。</p></div><div class=\"stack compact\"><button id=\"openNormalEditor\" type=\"button\" class=\"primary\" hidden>時間割を編集</button><button id=\"addLesson\" type=\"button\" class=\"ghost\" hidden>＋ 授業を登録</button></div></div><div id=\"teacherFilterWrap\" class=\"teacher-filter\" hidden><label>表示する時間割 <select id=\"teacherFilter\"><option value=\"mine\">自分の担当授業</option><option value=\"all\">全教師の授業</option></select></label></div><div class=\"datebar\"><button id=\"prevDay\" type=\"button\" class=\"date-arrow\" aria-label=\"前の期間\">‹</button><div class=\"date-center\"><button id=\"scheduleDateOpen\" class=\"schedule-date-open\" type=\"button\" aria-label=\"日付をカレンダーから選択\" aria-haspopup=\"dialog\"><strong id=\"displayDate\" aria-live=\"polite\"></strong><svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M16 3v4M8 3v4M3 10h18\"/></svg></button><button id=\"today\" type=\"button\" class=\"link-button\">今日に戻る</button></div><button id=\"nextDay\" type=\"button\" class=\"date-arrow\" aria-label=\"次の期間\">›</button></div><p class=\"absence-legend\"><span class=\"absence-legend-mark\" aria-hidden=\"true\"></span>欠席の授業は赤色で表示します</p><p class=\"slot-display-hint\">連続授業は1コマずつ表示します。伝達事項と欠席状態は共通です。</p><div id=\"lessonList\" class=\"lesson-list\"></div></section>","student":"<dialog id=\"studentDialog\" class=\"modal\"><form id=\"studentForm\" class=\"modal-content\"><div class=\"modal-head\"><h2 id=\"studentDialogTitle\">生徒を登録</h2><button type=\"button\" class=\"close-modal\" data-close=\"studentDialog\" aria-label=\"閉じる\">×</button></div><input type=\"hidden\" id=\"studentId\"><div class=\"form-grid\"><label>生徒名<input id=\"studentName\" maxlength=\"80\" required></label><label>学年<input id=\"studentGrade\" maxlength=\"30\" list=\"gradePresets\" required placeholder=\"例：中2\"><datalist id=\"gradePresets\"><option value=\"小1\"><option value=\"小2\"><option value=\"小3\"><option value=\"小4\"><option value=\"小5\"><option value=\"小6\"><option value=\"中1\"><option value=\"中2\"><option value=\"中3\"><option value=\"高1\"><option value=\"高2\"><option value=\"高3\"></datalist></label><label>学校<input id=\"studentSchool\" maxlength=\"80\" placeholder=\"学校名\"></label><div class=\"regular-editor full\"><div class=\"regular-heading\"><div><strong>通常授業（毎週の時間割へ自動反映）</strong><p class=\"muted\">曜日・時間・担当教師・教科を登録してください。複数登録できます。</p></div><button id=\"addRegularRow\" type=\"button\" class=\"mini-button\">＋ 通常授業を追加</button></div><div id=\"regularRows\" class=\"regular-rows\"></div><p id=\"legacyRegularNote\" class=\"legacy-note\" hidden></p></div><label class=\"full\">教材<input id=\"studentTextbook\" maxlength=\"300\"></label><label class=\"full\">備考（全教師に公開）<textarea id=\"studentRemarks\" maxlength=\"1500\" rows=\"3\"></textarea></label></div><div class=\"modal-actions\"><button id=\"withdrawStudent\" class=\"danger-soft\" type=\"button\" hidden>退塾・非表示</button><button id=\"deleteStudent\" class=\"danger\" type=\"button\" hidden>生徒を削除</button><button class=\"primary\" type=\"submit\">保存する</button></div></form></dialog>","count":"<section id=\"adminCountPage\" class=\"page\" hidden><div class=\"section-title\"><div><p class=\"eyebrow\">STUDENT MANAGEMENT</p><h2>生徒管理</h2><p class=\"muted\">曜日・時間・担当講師を登録すると、毎週の時間割に自動反映されます。</p></div><button id=\"addStudent\" class=\"primary\" type=\"button\">＋ 生徒を登録</button></div><div class=\"toolbar student-toolbar\"><label class=\"grow\">生徒検索<input id=\"studentSearch\" type=\"search\" placeholder=\"生徒名・学年・学校・教材で検索\"></label><label><input id=\"includeWithdrawn\" type=\"checkbox\">退塾者を含める</label><label>校種で絞り込み<select id=\"studentLevel\"><option value=\"all\">すべて</option><option value=\"elementary\">小学生</option><option value=\"middle\">中学生</option><option value=\"high\">高校生</option><option value=\"other\">その他・未分類</option></select></label><label>並び替え<select id=\"studentSort\"><option value=\"gradeAsc\">学年順（小1 → 高3）</option><option value=\"gradeDesc\">学年順（高3 → 小1）</option><option value=\"nameAsc\">名前順（あいうえお）</option><option value=\"nameDesc\">名前順（逆）</option><option value=\"schoolAsc\">学校名順</option><option value=\"lessonCountDesc\">週の授業数が多い順</option></select></label></div><p id=\"studentResults\" class=\"result-count\"></p><div class=\"panel table-wrap\"><table><thead><tr><th>生徒名</th><th>学年</th><th>学校</th><th>通常授業（曜日・時間・担当）</th><th>教材</th><th>備考</th><th>操作</th></tr></thead><tbody id=\"countRows\"></tbody></table><p class=\"table-help\">学年は毎年4月1日（日本時間）を基準に表示計算します。登録データの自動書き換えは行いません（小6→中1・中3→高1・高3→卒業）。学校名は進学先を自動判定できないため、必要に応じて編集してください。「編集」から通常授業を追加できます。</p></div></section>","detail":"<dialog id=\"detailDialog\" class=\"modal\"><div class=\"modal-content\"><div class=\"modal-head\"><h2 id=\"detailTitle\">授業詳細</h2><button type=\"button\" class=\"close-modal\" data-close=\"detailDialog\">×</button></div><div class=\"detail-grid\"><div><span>授業日時</span><strong id=\"detailDate\"></strong><span id=\"detailAbsenceStatus\" class=\"detail-absence-status\" hidden>欠席</span></div><div><span>教科</span><strong id=\"detailSubject\"></strong></div><div><span>担当教師</span><strong id=\"detailTeacher\"></strong></div><div><span>学年</span><strong id=\"detailGrade\"></strong></div></div><h3>今後の来塾予定</h3><div id=\"futureDates\" class=\"future-dates\"></div><h3>伝達事項</h3><div id=\"memoReadOnly\" class=\"memo-readonly\" hidden aria-label=\"伝達事項\"></div><form id=\"memoForm\" class=\"stack compact\"><textarea id=\"memoContent\" maxlength=\"2000\" rows=\"5\" placeholder=\"伝達事項を入力してください\"></textarea><button class=\"primary\" type=\"submit\">伝達事項を保存</button></form><div class=\"modal-actions\"><button id=\"editLesson\" class=\"ghost\" type=\"button\" hidden>授業を編集</button></div></div></dialog>","absence":"\n    <form class=\"modal-content\" id=\"normalAbsenceForm\">\n      <div class=\"modal-head\"><h2 id=\"normalAbsenceTitle\">講師の欠席コマ</h2>\n      <button type=\"button\" id=\"normalAbsenceClose\" class=\"close-modal\" aria-label=\"閉じる\">×</button></div>\n      <p class=\"muted\" id=\"normalAbsenceDate\"></p>\n      <p class=\"muted\">欠席にすると該当コマが黒くなり、新たな授業は配置できません。ここでの選択は「変更を確定」するまで仮変更です。</p><p class=\"normal-editor-warning\" id=\"normalAbsenceScheduleHint\"></p>\n      <div class=\"normal-absence-options\" id=\"normalAbsenceOptions\"></div>\n      <div class=\"normal-absence-quick\">\n        <button type=\"button\" class=\"mini-button\" data-normal-preset=\"none\">全コマ出勤可能</button>\n        <button type=\"button\" class=\"mini-button\" data-normal-preset=\"all\">全コマ欠席</button>\n        <button type=\"button\" class=\"mini-button\" data-normal-preset=\"late\">1・2限のみ出勤</button>\n        <button type=\"button\" class=\"mini-button\" data-normal-preset=\"early\">3・4限のみ出勤</button>\n      </div>\n      <div class=\"modal-actions\"><button class=\"primary\" type=\"submit\">仮設定に反映</button></div>\n    </form>","normal":"\n    <div class=\"section-title normal-editor-title\">\n      <div><p class=\"eyebrow\">REGULAR SCHEDULE EDITOR</p>\n        <h2>通常授業エディター</h2>\n        <p class=\"muted\">講師の欠席はコマ単位。授業を別講師へドラッグ、または授業をタップして移動先をタップします。毎週の基本設定は変更しません。</p></div>\n      <button id=\"normalPreview\" class=\"ghost\" type=\"button\">時間割に戻る</button>\n    </div>\n    <div class=\"normal-editor-toolbar\">\n      <div class=\"normal-date-nav\">\n        <button id=\"normalPrev\" type=\"button\" class=\"ghost\" aria-label=\"前の日\">‹</button>\n        <input id=\"normalDate\" type=\"date\" aria-label=\"編集する日付\">\n        <button id=\"normalNext\" type=\"button\" class=\"ghost\" aria-label=\"次の日\">›</button>\n        <button id=\"normalToday\" type=\"button\" class=\"ghost\">今日</button>\n      </div>\n      <div class=\"normal-editor-actions\">\n        <button id=\"normalAdd\" type=\"button\" class=\"ghost\">＋ 授業を登録</button>\n        <button id=\"normalEditSelected\" type=\"button\" class=\"ghost\" hidden>選択授業を詳しく編集</button>\n        <button id=\"normalUndo\" type=\"button\" class=\"ghost\" disabled>↶ 取り消す</button>\n        <button id=\"normalDiscard\" type=\"button\" class=\"ghost\" disabled>変更を破棄</button>\n        <button id=\"normalPublish\" type=\"button\" class=\"primary\" disabled>変更を確定</button>\n      </div>\n    </div>\n    <p id=\"normalEditorWarning\" class=\"normal-editor-warning\" role=\"status\"></p>\n    <div class=\"normal-editor-scroll\" id=\"normalGrid\"></div>\n    <p class=\"normal-editor-footnote\">黒いコマには配置できません。黒いコマに残っている授業は、別の出勤可能な講師へ移動できます。原則、担当講師1人につき1コマ2人まで。授業時間の変更・削除は「詳しく編集」から行います。</p>\n  "};
function mockTemplate(key,edit){
 const t=document.createElement('template');t.innerHTML=templates[key];
 const root=t.content;
 const get=id=>root.querySelector('[id="'+id+'"]');
 const set=(id,value)=>{const el=get(id);if(el)el.textContent=value;};
 const reveal=id=>{const el=get(id);if(el)el.hidden=false;};
 const hide=id=>{const el=get(id);if(el)el.hidden=true;};
 const action=(id,value,highlight=true)=>{const el=get(id);if(!el)return;el.disabled=false;el.dataset.practiceAction=value;if(highlight)el.classList.add('practice-target');};
 const field=(id,value,initial)=>{const el=get(id);if(!el)return;el.dataset.practiceField=value;if(initial!==undefined)el.value=initial;};
 edit({root,get,set,reveal,hide,action,field});
 // All operational IDs, submit actions and navigation targets are removed.
 // Simulated controls are handled only by the practice screen event listener.
 root.querySelectorAll('form').forEach(el=>{const div=document.createElement('div');div.className=el.className;div.append(...el.childNodes);el.replaceWith(div);});
 root.querySelectorAll('dialog').forEach(el=>{const div=document.createElement('div');div.className='practice-mock-dialog';div.append(...el.childNodes);el.replaceWith(div);});
 root.querySelectorAll('[id]').forEach(el=>{if(el.tagName==='DATALIST'){el.remove();return;}el.removeAttribute('id');});
 root.querySelectorAll('[list],[data-close],[data-schedule-view],[data-normal-preset]').forEach(el=>{for(const x of ['list','data-close','data-schedule-view','data-normal-preset'])el.removeAttribute(x);});
 root.querySelectorAll('button').forEach(el=>{el.type='button';if(!el.dataset.practiceAction&&!el.dataset.practiceField)el.dataset.practiceAction='wrong';});
 root.querySelectorAll('a').forEach(el=>el.removeAttribute('href'));
 root.querySelectorAll('[autofocus]').forEach(el=>el.removeAttribute('autofocus'));
 return t.innerHTML;
}
const menuItems={employee:['今日の時間割','生徒一覧','休校日管理','勤務希望登録'],admin:['生徒管理','授業管理','休校日管理','講師管理','講習期間管理','講習予約管理'],owner:['生徒管理','授業管理','休校日管理','講師管理','講習期間管理','講習予約管理','変更履歴・バックアップ','システム管理']};
const menuTarget=t=>t.title==='今日の時間割を確認する'?'今日の時間割':t.title==='講習の勤務希望を提出する'?'勤務希望登録':t.title==='生徒を登録する'?'生徒管理':t.title==='通常授業の担当を振り替える'?'授業管理':t.title==='講習予約を確定・公開する'?'講習予約管理':t.title==='メンテナンス開始・終了'?'システム管理':'変更履歴・バックアップ';
function mockMenu(t,index){
 const label=menuTarget(t),active=index===0?menuItems[t.role][0]:label;
 return '<section class="welcome-line practice-menu-bar"><nav class="nav-tabs practice-role-'+t.role+'" aria-label="練習用メニュー">'+menuItems[t.role].map(name=>btn(name,index===0&&name===label?t.steps[0].action:'wrong','nav-tab'+(name===active?' active':'')+(index===0&&name===label?' practice-target':''))).join('')+'</nav></section>';
}
const lessonCard=(name,grade,teacher,time,action,highlight=false)=>'<button type="button" class="lesson-card'+(highlight?' practice-target':'')+'" data-practice-action="'+action+'"><div class="lesson-topline"><span class="lesson-time">'+time+'</span><span class="state-tag">予定</span><span class="origin-tag">通常授業</span></div><div class="lesson-student">'+grade+' '+name+'</div><div class="lesson-meta">数学　/　'+teacher+'</div><div class="lesson-meta">伝達事項なし</div></button>';
function scheduleMock(mode='teacher',all=false,highlight=''){
 return mockTemplate('schedule',({root,get,set,reveal,action,field})=>{
  root.querySelector('section').hidden=false;
  set('displayDate','2026年11月25日（水）');
  set('scheduleHeading',mode==='teacher'?'今日の時間割':'時間割');
  set('scheduleDescription',mode==='teacher'?'全教師の時間割と伝達事項を閲覧できます。':'全教師の授業を確認・変更できます。');
  if(mode==='teacher'){reveal('teacherFilterWrap');field('teacherFilter','filter');const el=get('teacherFilter');for(const opt of el.options)opt.selected=opt.value===(all?'all':'mine');if(highlight==='all')el.classList.add('practice-target');}
  else{reveal('openNormalEditor');action('openNormalEditor','edit',highlight==='edit');}
  get('lessonList').innerHTML='<div class="lesson-group"><h3 class="lesson-group-title">1限　17:30 – 18:25</h3>'+lessonCard('練習 花子','中2','練習講師A','1限　17:30 – 18:25',highlight==='detail'?'detail':'wrong',highlight==='detail')+'</div>'+(all?'<div class="lesson-group"><h3 class="lesson-group-title">2限　18:30 – 19:25</h3>'+lessonCard('練習 一郎','高1','練習講師B','2限　18:30 – 19:25','wrong')+'</div>':'');
 });
}
function studentListMock(highlight=false){
 return mockTemplate('count',({root,get,action})=>{
  root.querySelector('section').hidden=false;action('addStudent',highlight?'new':'wrong',highlight);
  get('countRows').innerHTML='<tr><td>練習 花子</td><td>中2</td><td>練習中学校</td><td>水曜 2限／練習講師A</td><td>数学問題集</td><td>—</td><td>'+btn('編集','wrong','mini-button')+'</td></tr><tr><td>練習 一郎</td><td>高1</td><td>練習高校</td><td>金曜 3限／練習講師B</td><td>英語</td><td>—</td><td>'+btn('編集','wrong','mini-button')+'</td></tr>';
 });
}
function studentFormMock(stage){
 return mockTemplate('student',({root,get,action,field})=>{
  for(const [id,key] of [['studentName','name'],['studentGrade','grade'],['studentSchool','school'],['studentTextbook','textbook'],['studentRemarks','remarks']])field(id,key);
  get('studentName').placeholder='練習 太郎';get('studentSchool').placeholder='練習中学校';get('studentGrade').placeholder='例：中2';
  action('addRegularRow',stage==='add'?'add':'wrong',stage==='add');
  const save=root.querySelector('button[type="submit"]');save.dataset.practiceAction=stage==='save'?'save':'wrong';if(stage==='save')save.classList.add('practice-target');
  if(stage==='save')get('regularRows').innerHTML='<div class="regular-row">'+select('曜日','weekday',['月','火','水','木','金','土'])+fieldHtml('開始時刻','time','start')+fieldHtml('終了時刻','time','end')+select('担当教師','teacher',['練習講師A','練習講師B'])+fieldHtml('教科（任意）','text','subject','数学')+fieldHtml('適用開始','date','date')+'</div>';
 });
}
const fieldHtml=field;
function lessonDetailMock(){
 return mockTemplate('detail',({get,set,reveal,hide,root})=>{
  set('detailTitle','授業詳細');set('detailDate','11月25日（水） 17:30〜18:25');set('detailSubject','数学');set('detailTeacher','練習講師A');set('detailGrade','中2');set('futureDates','12月2日（水） 17:30〜18:25');set('memoReadOnly','問題集を持参してください（模擬）。');reveal('memoReadOnly');hide('memoForm');const close=root.querySelector('.close-modal');close.dataset.practiceAction='close';close.classList.add('practice-target');
 });
}
function normalMock(stage){
 return mockTemplate('normal',({get,set,action})=>{
  get('normalDate').setAttribute('value','2026-11-25');
  const moved=stage==='save',absent=['pick','move','save'].includes(stage);
  if(moved){action('normalPublish','save');set('normalEditorWarning','仮変更：担当振替1件、欠席設定1講師分。');}
  const nameA=btn('練習講師A',stage==='teacher'?'teacher':'wrong','normal-teacher-button'+(stage==='teacher'?' practice-target':''));
  const nameB=btn('練習講師B','wrong','normal-teacher-button');
  const entry=btn('練習 花子　数学'+(absent&&!moved?' / 要振替':''),stage==='pick'?'pick':'wrong','normal-entry'+(stage==='pick'?' practice-target':'')+(stage==='move'?' is-selected':''));
  get('normalGrid').innerHTML='<table class="normal-table"><thead><tr><th class="normal-time-head">時間・コマ</th><th class="normal-teacher-head">'+nameA+'<small>講師名をタップして欠席設定</small></th><th class="normal-teacher-head">'+nameB+'<small>講師名をタップして欠席設定</small></th></tr></thead><tbody>'+['17:30〜18:25','18:30〜19:25','19:30〜20:25','20:30〜21:25'].map((time,i)=>'<tr><th class="normal-period"><strong>'+(i+1)+'限</strong><small>'+time+'</small></th><td class="normal-cell'+(i===2&&absent?' is-absent':'')+'">'+(i===2?(absent?'<div class="normal-cell-label">⛔ 欠席・配置不可</div>':'')+(moved?'':entry):'<div class="normal-empty">空き</div>')+'</td><td class="normal-cell">'+(i===2?(moved?entry:stage==='move'?btn('空き','move','ghost practice-target'):'<div class="normal-empty">空き</div>'):'<div class="normal-empty">空き</div>')+'</td></tr>').join('')+'</tbody></table>';
 });
}
function absenceMock(){
 return mockTemplate('absence',({get,set,root})=>{
  set('normalAbsenceTitle','練習講師A｜コマ別欠席');set('normalAbsenceDate','11月25日（水）');get('normalAbsenceOptions').innerHTML=['17:30〜18:25','18:30〜19:25','19:30〜20:25','20:30〜21:25'].map((time,i)=>'<label class="normal-absence-row'+(i===2?' practice-target':'')+'"><strong>'+(i+1)+'限　'+time+'</strong><span>欠席</span><input type="checkbox" data-practice-field="a'+(i+1)+'"></label>').join('');const save=root.querySelector('button[type="submit"]');save.dataset.practiceAction='absent';save.classList.add('practice-target');
 });
}
function availabilityMock(stage){
 const course='<label>講習<select data-practice-field="course" class="'+(stage==='course'?'practice-target':'')+'"><option value="">選択してください</option><option value="winter"'+(stage!=='course'?' selected':'')+'>2026年度冬期講習（練習）　12月26日〜12月28日</option></select></label>';
 const table='<div class="availability-grid-wrap"><table class="availability-table"><thead><tr><th class="availability-corner" rowspan="2">コマ / 時間</th><th class="availability-month-label" colspan="3">2026年12月</th></tr><tr><th class="availability-date-header">12月26日（土）</th><th class="availability-date-header is-closed-date">12月27日（日）</th><th class="availability-date-header">12月28日（月）</th></tr></thead><tbody>'+['17:30〜18:25','18:30〜19:25','19:30〜20:25','20:30〜21:25'].map((time,i)=>'<tr><th class="availability-period-head">'+(i+1)+'限　'+time+'</th>'+['d','closed','e'].map(d=>'<td class="availability-day-cell">'+(d==='closed'?'休校':'<button type="button" class="availability-slot practice-availability'+(d==='d'&&i<2?' practice-target':'')+'" data-practice-toggle="'+d+(i+1)+'" aria-pressed="false">出勤不可</button>')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 return '<section class="page"><div class="section-title"><div><p class="eyebrow">SEASONAL WORK AVAILABILITY</p><h2>勤務希望登録</h2><p class="muted">出勤できる日・コマを選択して、締切までに提出してください。</p></div></div><div class="panel availability-toolbar">'+course+'<div class="availability-period-controls"><span class="availability-period-kicker">講習の全期間</span><strong>2026年12月26日〜12月28日</strong><span class="availability-period-subline">週の切り替えは不要です</span></div><p class="availability-deadline">勤務希望提出締切：12月20日　｜　受付中・編集可能</p></div><div class="availability-period-overview"><div class="availability-overview-main"><strong class="availability-overview-course">2026年度冬期講習（練習）</strong><span class="availability-overview-dates">2026年12月26日〜12月28日</span></div><div class="availability-overview-emphasis"><strong>勤務希望提出締切：12月20日</strong><span>受付中</span><span>未提出</span></div></div><div class="availability-legend"><span>✓ 緑：出勤可能</span><span>白：出勤不可</span><span>⇆ 表を左右にスクロールして全日程を確認</span></div>'+table+'<div class="availability-actions">'+btn('変更を破棄','wrong')+target('勤務希望を提出・更新','submit')+'</div><p class="muted">※ 希望提出は出勤確定ではありません。</p></section>';
}

const lessons=[
{role:'employee',title:'今日の時間割を確認する',desc:'表示対象を切り替えて、授業の詳細を確認します。',steps:[
s('「今日の時間割」を押してください。','schedule',()=>panel('ワークスペース',row(target('今日の時間割','schedule'),btn('生徒一覧','wrong'),btn('勤務希望登録','wrong')))),
s('全教師の授業に切り替えてください。','all',()=>panel('今日の時間割',row(btn('自分の担当授業','wrong'),target('全教師の授業','all'))+'<p>表示範囲　日 / 週 / 月</p><p>11月25日（水）</p>')),
s('練習 花子さんの授業カードを押してください。','detail',()=>panel('今日の時間割','<p>全教師の授業　11月25日（水）</p>'+row(target('1限 17:30〜18:25　練習 花子　数学','detail'),btn('2限　練習 一郎','wrong')))),
s('伝達事項と次回予定を確認し、右上の「×」を押してください。','close',()=>panel('授業詳細','<p>練習 花子　中学2年</p><p>数学／練習講師A</p><p>今後の来塾予定：12月2日（水）</p><p>伝達事項：問題集を持参してください（模擬）。</p>'+row(target('閉じる','close'))))
]},
{role:'employee',title:'講習の勤務希望を提出する',desc:'出勤できるコマを選び、希望を提出します。',steps:[
s('「勤務希望登録」を押してください。','open',()=>panel('ワークスペース',row(btn('今日の時間割','wrong'),target('勤務希望登録','open')))),
s('対象の講習を選択してください。','course',()=>panel('勤務希望登録',select('講習','course',['2026年度冬期講習（練習）'])+row(target('選択した講習を表示','course'))),required('course')),
s('12月26日の1限と2限を選択し、勤務希望を提出してください。','submit',()=>panel('勤務希望登録','<p>緑：出勤可能　白：出勤不可</p>'+table(['コマ','12/26（土）','12/28（月）'],[1,2,3,4].map(n=>[n+'限','<label class="practice-check"><input type="checkbox" data-practice-field="d'+n+'">出勤可</label>','<label class="practice-check"><input type="checkbox" data-practice-field="e'+n+'">出勤可</label>']))+row(target('勤務希望を提出','submit'))),v=>v.d1&&v.d2&&!v.d3&&!v.d4&&!v.e1&&!v.e2&&!v.e3&&!v.e4)
]},
{role:'admin',title:'生徒を登録する',desc:'基本情報と毎週の通常授業を設定して保存します。',steps:[
s('「生徒管理」を押してください。','open',()=>panel('ワークスペース',row(target('生徒管理','open'),btn('授業管理','wrong'),btn('講師管理','wrong')))),
s('「＋ 生徒を登録」を押してください。','new',()=>panel('生徒管理',row(target('＋ 生徒を登録','new'))+studentTable())),
s('練習用の生徒名、学年、学校を入力して「＋ 通常授業を追加」を押してください。','add',()=>panel('生徒を登録','<div class="practice-fields">'+field('生徒名','text','name','練習 太郎')+select('学年','grade',['中学1年','中学2年','中学3年','高校1年'])+field('学校','text','school','練習中学校')+'</div>'+row(target('＋ 通常授業を追加','add'))),required('name','grade','school')),
s('曜日・時刻・担当講師・適用開始日を入力し、「保存する」を押してください。','save',()=>panel('生徒を登録','<p>通常授業（毎週の時間割へ自動反映）</p><div class="practice-fields">'+select('曜日','weekday',['月','火','水','木','金','土'])+field('開始時刻','time','start')+field('終了時刻','time','end')+select('担当教師','teacher',['練習講師A','練習講師B'])+field('教科（任意）','text','subject','数学')+field('適用開始','date','date')+'</div>'+row(target('保存する','save'))),v=>required('weekday','start','end','teacher','date')(v)&&v.start<v.end)
]},
{role:'admin',title:'通常授業の担当を振り替える',desc:'講師の欠席を設定し、授業カードを別講師へ移動します。',steps:[
s('「授業管理」を押してください。','open',()=>panel('ワークスペース',row(btn('生徒管理','wrong'),target('授業管理','open'),btn('講師管理','wrong')))),
s('「時間割を編集」を押してください。','edit',()=>panel('時間割',row(target('時間割を編集','edit'),btn('＋ 授業を登録','wrong'))+'<p>11月25日（水）</p><p>3限　練習 花子／練習講師A</p>')),
s('欠席する練習講師Aの名前を押してください。','teacher',()=>panel('通常授業エディター',table(['時間・コマ',target('練習講師A','teacher','ghost'),btn('練習講師B','wrong')],[['3限','練習 花子','空き']]))),
s('3限の欠席を選択し、「仮設定に反映」を押してください。','absent',()=>panel('講師の欠席コマ','<p>練習講師A</p>'+[1,2,3,4].map(n=>'<label class="practice-check"><input type="checkbox" data-practice-field="a'+n+'">'+n+'限 欠席</label>').join('')+row(target('欠席設定を反映','absent'))),v=>v.a3&&!v.a1&&!v.a2&&!v.a4),
s('欠席コマに残っている授業カードを押してください。','pick',()=>panel('通常授業エディター',table(['時間・コマ','練習講師A','練習講師B'],[['3限','<div class="practice-blocked">'+target('練習 花子（要振替）','pick','ghost')+'</div>','空き']]))),
s('練習講師Bの空いている3限を押してください。','move',()=>panel('通常授業エディター',table(['時間・コマ','練習講師A','練習講師B'],[['3限','<div class="practice-blocked">練習 花子（選択中）</div>',target('空き','move','ghost')]]))),
s('振替後の担当と欠席を確認し、「変更を確定」を押してください。','save',()=>panel('通常授業エディター',table(['時間・コマ','練習講師A','練習講師B'],[['3限','<div class="practice-blocked">欠席・配置不可</div>','練習 花子']])+ '<p>仮変更：担当振替1件、欠席設定1講師分</p>'+row(target('変更を確定','save'))))
]},
{role:'admin',title:'講習予約を確定・公開する',desc:'保護者の希望から担当講師を決め、公開まで練習します。',steps:[
s('「講習予約管理」を押してください。','open',()=>panel('ワークスペース',row(btn('講習期間管理','wrong'),target('講習予約管理','open')))),
s('対象の講習を選択してください。','course',()=>panel('講習予約管理',select('講習を選択','course',['2026年度冬期講習（練習）'])+row(target('表示','course'))),required('course')),
s('練習 花子さんの詳細を開いてください。','detail',()=>panel('生徒別希望一覧',table(['生徒','状況','希望','確定','詳細'],[['練習 花子','提出済み','1','0',target('詳細','detail','ghost')]]))),
s('担当講師を選び、このコマを確定してください。','confirm',()=>panel('練習 花子さんの希望詳細','<p>12月26日 1限　未確定</p><div class="practice-fields">'+select('担当講師','teacher',['練習講師A','練習講師B'])+field('教科（任意）','text','subject','数学')+'</div>'+row(target('このコマを確定','confirm'))),required('teacher')),
s('確定済み・未公開の授業を公開してください。','publish',()=>panel('練習 花子さんの希望詳細','<p>12月26日 1限　確定済み・未公開</p>'+row(target('この授業を公開','publish')))),
s('公開すると教室の時間割と保護者画面に反映されます。確認して公開してください。','ok',()=>panel('授業を公開しますか？','<p>これは練習画面です。実際の時間割やQR予約には反映されません。</p>'+row(btn('キャンセル','wrong'),target('公開する','ok'))))
]},
{role:'owner',title:'メンテナンス開始・終了',desc:'運営専用の利用停止と再開の流れを練習します。',steps:[
s('「システム管理」を押してください。','open',()=>panel('ワークスペース',row(btn('変更履歴・バックアップ','wrong'),target('システム管理','open')))),
s('案内文とバージョンを入力し、「メンテナンスを開始」を押してください。','start',()=>panel('本番サイトの利用状況（模擬）','<p>通常運用中</p><div class="practice-fields">'+field('利用者に表示する案内文','text','notice','システム更新中')+field('システムバージョン','text','version','26.1')+'</div>'+row(target('メンテナンスを開始','start'))),required('notice','version')),
s('メンテナンス中の表示を確認し、利用を再開してください。','end',()=>panel('本番サイトの利用状況（模擬）','<p class="practice-warning">メンテナンス中（練習）</p>'+row(target('メンテナンスを終了・利用再開','end'))))
]},
{role:'owner',title:'バックアップを作成する',desc:'バックアップ名を入力し、作成結果を確認します。',steps:[
s('「変更履歴・バックアップ」を押してください。','open',()=>panel('ワークスペース',row(target('変更履歴・バックアップ','open'),btn('システム管理','wrong')))),
s('練習用のバックアップ名を入力し、作成ボタンを押してください。','save',()=>panel('クラウドバックアップ',field('バックアップ名','text','name','練習用バックアップ')+row(target('＋ 今のデータをバックアップ','save'))),required('name'))
]}
];
export function practiceTopics(allowed,selected,query){
 const words=String(query||'').normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
 return lessons.filter(t=>allowed.includes(t.role)&&(words.length?words.every(w=>(t.title+' '+t.desc+' '+t.steps.map(s=>s.hint).join(' ')).normalize('NFKC').toLowerCase().includes(w)):t.role===selected));
}
export function renderPractice(host,{allowed,selected,query}){
 host.closest('.help-guide-shell')?.classList.remove('is-practicing');
 host.replaceChildren();
 const topics=practiceTopics(allowed,selected,query);
 const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 const button=(label,fn,cls='ghost')=>{const el=make('button',cls,label);el.type='button';el.addEventListener('click',fn);return el;};
 function menu(){
  host.closest('.help-guide-shell')?.classList.remove('is-practicing');
  host.replaceChildren();
  const intro=make('div','practice-intro');intro.append(make('h3','','模擬操作チュートリアル'),make('p','','黄色い枠と指示を参考に、実際に操作して覚えます。練習データは保存されません。'));host.append(intro);
  const grid=make('div','practice-menu');
  topics.forEach(t=>{const card=make('div','practice-menu-card');card.append(make('strong','',t.title),make('p','',t.desc),make('small','',t.steps.length+'ステップ'),button('練習を開始 →',()=>start(t),'primary'));grid.append(card);});
  if(!topics.length)grid.append(make('p','help-guide-empty','該当する模擬チュートリアルはありません。補足の操作説明もご確認ください。'));
  host.append(grid);
 }
 function start(t){
  host.closest('.help-guide-shell')?.classList.add('is-practicing');
  let index=0,values={};
  function render(){
   host.replaceChildren();
   const top=make('div','practice-top');top.append(button('← 一覧に戻る',menu),make('strong','',t.title),button('最初から',()=>{index=0;values={};render();}));host.append(top);
   const progress=make('progress','practice-progress');progress.max=t.steps.length;progress.value=index;host.append(progress);
   const info=make('div','practice-instruction');info.setAttribute('role','status');info.append(make('strong','',index===t.steps.length?'チュートリアル完了！':'STEP '+(index+1)+' / '+t.steps.length),make('p','',index===t.steps.length?'操作の練習が完了しました。実際のデータは変更されていません。':t.steps[index].hint));host.append(info);
   const frame=make('div','practice-frame');
   const header=make('div','practice-live-header');header.innerHTML=templates.header;frame.append(header);
   if(index===t.steps.length){const done=make('div','practice-complete');done.append(make('strong','','✓ 操作完了'),make('p','','本番への保存は一切行われていません。'),button('一覧へ戻る',menu,'primary'));frame.append(done);host.append(frame);return;}
   const step=t.steps[index],screen=make('div','practice-screen practice-live-screen');
   let markup=step.html();
   const title=t.title;
   if(title==='今日の時間割を確認する')markup=index===0?scheduleMock():index===1?scheduleMock('teacher',false,'all'):index===2?scheduleMock('teacher',true,'detail'):scheduleMock('teacher',true)+lessonDetailMock();
   if(title==='講習の勤務希望を提出する')markup=index===0?scheduleMock():availabilityMock(index===1?'course':'submit');
   if(title==='生徒を登録する')markup=index<2?studentListMock(index===1):studentListMock()+studentFormMock(index===2?'add':'save');
   if(title==='通常授業の担当を振り替える')markup=index<2?scheduleMock('admin',true,index===1?'edit':''):index===2?normalMock('teacher'):index===3?normalMock('teacher')+absenceMock():normalMock(index===4?'pick':index===5?'move':'save');
   if(index===0&&title==='講習予約を確定・公開する')markup=studentListMock();
   if(index===0&&t.role==='owner')markup=studentListMock();
   screen.innerHTML=mockMenu(t,index)+markup;frame.append(screen);host.append(frame);
   const feedback=make('p','practice-feedback');feedback.setAttribute('role','status');host.append(feedback);
   screen.querySelectorAll('[data-practice-field]').forEach(el=>{
    const k=el.dataset.practiceField;if(k in values){if(el.type==='checkbox')el.checked=values[k];else el.value=values[k];}
    const change=()=>{values[k]=el.type==='checkbox'?el.checked:el.value;};el.addEventListener('input',change);el.addEventListener('change',()=>{change();if((step.action==='all'&&k==='filter'&&el.value==='all')||(step.action==='course'&&k==='course'&&t.role==='employee'&&el.value)){index++;render();}});
   });
   screen.addEventListener('click',e=>{
    const toggle=e.target.closest('[data-practice-toggle]');if(toggle){const k=toggle.dataset.practiceToggle;values[k]=!values[k];toggle.setAttribute('aria-pressed',String(values[k]));toggle.textContent=values[k]?'出勤可能':'出勤不可';return;}
    const b=e.target.closest('[data-practice-action]');if(!b)return;
    if(b.dataset.practiceAction!==step.action){feedback.textContent='先に黄色い枠の操作を行ってください。';return;}
    if(step.valid&&!step.valid(values)){feedback.textContent='入力内容・選択内容を確認してからもう一度押してください。';return;}
    index++;render();
   });
  }
  render();
 }
 menu();
}
