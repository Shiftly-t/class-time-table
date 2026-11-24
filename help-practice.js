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
const lessons=[
{role:'employee',title:'今日の時間割を確認する',desc:'表示対象を切り替えて、授業の詳細を確認します。',steps:[
s('「今日の時間割」を押してください。','schedule',()=>panel('ワークスペース',row(target('今日の時間割','schedule'),btn('生徒一覧','wrong'),btn('勤務希望登録','wrong')))),
s('全教師の授業に切り替えてください。','all',()=>panel('今日の時間割',row(btn('自分の担当授業','wrong'),target('全教師の授業','all'))+'<p>表示範囲　日 / 週 / 月</p><p>11月25日（水）</p>')),
s('練習 花子さんの授業カードを押してください。','detail',()=>panel('今日の時間割','<p>全教師の授業　11月25日（水）</p>'+row(target('1限 17:30〜18:25　練習 花子　数学','detail'),btn('2限　練習 一郎','wrong')))),
s('伝達事項と次回予定を確認し、「閉じる」を押してください。','close',()=>panel('授業詳細','<p>練習 花子　中学2年</p><p>数学／練習講師A</p><p>今後の来塾予定：12月2日（水）</p><p>伝達事項：問題集を持参してください（模擬）。</p>'+row(target('閉じる','close'))))
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
s('3限の欠席を選択し、仮変更を反映してください。','absent',()=>panel('講師の欠席コマ','<p>練習講師A</p>'+[1,2,3,4].map(n=>'<label class="practice-check"><input type="checkbox" data-practice-field="a'+n+'">'+n+'限 欠席</label>').join('')+row(target('欠席設定を反映','absent'))),v=>v.a3&&!v.a1&&!v.a2&&!v.a4),
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
 host.replaceChildren();
 const topics=practiceTopics(allowed,selected,query);
 const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 const button=(label,fn,cls='ghost')=>{const el=make('button',cls,label);el.type='button';el.addEventListener('click',fn);return el;};
 function menu(){
  host.replaceChildren();
  const intro=make('div','practice-intro');intro.append(make('h3','','模擬操作チュートリアル'),make('p','','黄色い枠と指示を参考に、実際に操作して覚えます。練習データは保存されません。'));host.append(intro);
  const grid=make('div','practice-menu');
  topics.forEach(t=>{const card=make('div','practice-menu-card');card.append(make('strong','',t.title),make('p','',t.desc),make('small','',t.steps.length+'ステップ'),button('練習を開始 →',()=>start(t),'primary'));grid.append(card);});
  if(!topics.length)grid.append(make('p','help-guide-empty','該当する模擬チュートリアルはありません。補足の操作説明もご確認ください。'));
  host.append(grid);
 }
 function start(t){
  let index=0,values={};
  function render(){
   host.replaceChildren();
   const top=make('div','practice-top');top.append(button('← 一覧に戻る',menu),make('strong','',t.title),button('最初から',()=>{index=0;values={};render();}));host.append(top);
   const progress=make('progress','practice-progress');progress.max=t.steps.length;progress.value=index;host.append(progress);
   const info=make('div','practice-instruction');info.setAttribute('role','status');info.append(make('strong','',index===t.steps.length?'チュートリアル完了！':'STEP '+(index+1)+' / '+t.steps.length),make('p','',index===t.steps.length?'操作の練習が完了しました。実際のデータは変更されていません。':t.steps[index].hint));host.append(info);
   const frame=make('div','practice-frame');
   const header=make('div','practice-brand');header.append(make('strong','','Shiftly-T'),make('span','','練習モード｜架空データ'));frame.append(header);
   if(index===t.steps.length){const done=make('div','practice-complete');done.append(make('strong','','✓ 操作完了'),make('p','','本番への保存は一切行われていません。'),button('一覧へ戻る',menu,'primary'));frame.append(done);host.append(frame);return;}
   const step=t.steps[index],screen=make('div','practice-screen');screen.innerHTML=step.html();frame.append(screen);host.append(frame);
   const feedback=make('p','practice-feedback');feedback.setAttribute('role','status');host.append(feedback);
   screen.querySelectorAll('[data-practice-field]').forEach(el=>{
    const k=el.dataset.practiceField;if(k in values){if(el.type==='checkbox')el.checked=values[k];else el.value=values[k];}
    const change=()=>{values[k]=el.type==='checkbox'?el.checked:el.value;};el.addEventListener('input',change);el.addEventListener('change',change);
   });
   screen.addEventListener('click',e=>{
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
