// Uses the existing QA Auth and App Check context for all ranking requests.
const metrics = [
  ['slots', '担当授業コマ数（延べ）', 'コマ'],
  ['regular', '通常授業コマ数（延べ）', 'コマ'],
  ['seasonal', '講習授業コマ数（延べ）', 'コマ'],
  ['days', '授業担当日数', '日'],
  ['students', '担当生徒数（実人数）', '人'],
];
const periods = [['month', '月間'], ['year', '年度'], ['cumulative', '累計']];
const roles = ['employee', 'admin', 'owner'];
const method = '集計方法：担当した生徒の人数分をカウントします（1コマで2人担当した場合は2コマ分として集計）。';
const japaneseDate = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
});

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(label, action, className = 'ghost') {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function toggle(label, active, action, focusKey) {
  const node = button(label, action, 'ranking-tab' + (active ? ' active' : ''));
  node.setAttribute('aria-pressed', String(active));
  node.dataset.rankingFocus = focusKey;
  return node;
}

function avatar() {
  const node = el('span', 'ranking-avatar');
  node.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>';
  return node;
}

function status(message, className = 'ranking-demo') {
  const node = el('p', className, message);
  node.setAttribute('role', 'status');
  return node;
}

function select(options, value) {
  const input = el('select');
  for (const [id, label] of options) {
    const option = el('option', '', label);
    option.value = id;
    input.append(option);
  }
  if (value !== undefined) input.value = value;
  return input;
}

function field(label, control) {
  const node = el('label', '', label);
  node.append(control);
  return node;
}

function input(type, value = '') {
  const node = el('input');
  node.type = type;
  node.value = value;
  return node;
}

function submit(label) {
  const node = el('button', 'primary', label);
  node.type = 'submit';
  return node;
}

function section(title) {
  const node = el('section', 'ranking-profile');
  node.append(el('h3', '', title));
  return node;
}

function formatDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? japaneseDate.format(timestamp) : '';
}

function periodLabel(kind, key) {
  if (kind === 'month' && /^\d{4}-\d{2}$/.test(key)) {
    const [year, month] = key.split('-').map(Number);
    return `${year}年${month}月`;
  }
  return kind === 'year' ? `${key}年度` : '累計';
}

function metricLabel(key) {
  return metrics.find(([metric]) => metric === key)?.[1] || '';
}

function validStats(row) {
  return row && metrics.every(([metric]) => Number.isSafeInteger(row[metric]) && row[metric] >= 0);
}

function validCoverage(coverage) {
  return coverage && typeof coverage.complete === 'boolean' &&
    Number.isSafeInteger(coverage.recorded) && Number.isSafeInteger(coverage.expected) &&
    coverage.recorded >= 0 && coverage.expected >= coverage.recorded &&
    coverage.complete === (coverage.recorded === coverage.expected);
}

function validResponse(view, data) {
  if (!data) return false;
  if (view === 'rank') {
    return validCoverage(data.coverage) && typeof data.period === 'string' && Array.isArray(data.rows) &&
      data.rows.every(row => validStats(row) && typeof row.name === 'string' && typeof row.teacherUid === 'string' &&
        Number.isSafeInteger(row.rank) && row.rank >= 1);
  }
  if (view === 'profile') {
    if (data.profile === null) return true;
    const profile = data.profile;
    return validCoverage(data.coverage) && typeof profile?.name === 'string' && typeof profile?.teacherUid === 'string' &&
      (data.coverage.complete ? validStats(profile.totals) : profile.totals === null) &&
      Array.isArray(profile.monthly) && profile.monthly.every(month => validStats(month) && /^\d{4}-\d{2}$/.test(month.key));
  }
  if (view === 'badges') return Array.isArray(data.badges);
  if (view === 'history') return Array.isArray(data.history) && (data.nextCursor === null || typeof data.nextCursor === 'string');
  return ['badges', 'teachers', 'grants', 'rules'].every(key => Array.isArray(data[key]));
}

function failureMessage(error, fallback, precondition = '現在の公開設定や実績の確定状況により、この操作はできません。') {
  switch (error?.code) {
    case 'functions/failed-precondition':
      return precondition;
    case 'functions/unauthenticated':
    case 'functions/permission-denied':
      return '認証・アクセス権限・アプリの確認に失敗しました。';
    case 'functions/unavailable':
      return '現在ランキングを利用できません。時間をおいて再試行してください。';
    case 'functions/invalid-argument':
      return '入力内容を確認してください。';
    default:
      return fallback;
  }
}

function coverageNotice(coverage) {
  return status(`未確定の日付があります。確定済み ${coverage.recorded} / ${coverage.expected} 日`);
}

function renderProfile(data, showBadges) {
  const card = el('section', 'ranking-profile');
  const profile = data.profile;
  if (!profile) {
    card.append(el('p', 'empty', '表示できるプロフィール実績はありません。'));
    return card;
  }

  const who = el('div', 'ranking-profile-head');
  who.append(avatar(), el('h3', '', profile.name));
  card.append(who);
  if (data.coverage.complete) {
    const totals = el('div', 'ranking-summary');
    for (const [key, label, unit] of metrics) {
      const cell = el('div', 'ranking-stat');
      cell.append(el('span', '', label), el('strong', '', String(profile.totals[key])), el('small', '', unit));
      totals.append(cell);
    }
    const {from, to} = data.coverage;
    const range = from && to ? `累計 · ${from} ～ ${to}` : '累計';
    card.append(el('p', 'ranking-note', range), totals);
    if (profile.monthly.length) {
      const heading = el('h4', '', '月別の担当授業コマ数（延べ）');
      const chart = el('div', 'ranking-chart');
      const max = Math.max(1, ...profile.monthly.map(row => row.slots));
      for (const month of profile.monthly) {
        const row = el('div', 'ranking-chart-row');
        const track = el('span', 'ranking-chart-track');
        const bar = el('span', 'ranking-chart-bar');
        track.setAttribute('aria-hidden', 'true');
        bar.style.width = `${month.slots / max * 100}%`;
        track.append(bar);
        row.append(el('span', '', periodLabel('month', month.key)), track, el('strong', '', `${month.slots} コマ`));
        chart.append(row);
      }
      card.append(heading, chart);
    }
  } else {
    card.append(coverageNotice(data.coverage));
  }
  card.append(button('獲得バッジを見る', () => showBadges(profile.teacherUid, profile.name)));
  return card;
}

function badgeMark(item) {
  const mark = el('span', 'ranking-badge-mark', item.icon || '★');
  mark.setAttribute('aria-hidden', 'true');
  if (/^#[a-f0-9]{6}$/i.test(item.color)) mark.style.setProperty('--badge-color', item.color);
  return mark;
}

function renderBadges(data, teacherName) {
  const card = section(teacherName ? `${teacherName}の獲得バッジ` : '自分の獲得バッジ');
  if (!data.badges.length) {
    card.append(el('p', 'empty', '獲得したバッジはありません。'));
    return card;
  }
  const overview = el('div', 'ranking-badge-overview');
  overview.append(avatar(), el('strong', '', `獲得バッジ：${data.badges.length}個`));
  const gallery = el('div', 'ranking-badge-gallery');
  const list = el('ul', 'ranking-achievements');
  for (const badge of data.badges) {
    const tile = el('div', 'ranking-badge-tile');
    tile.append(badgeMark(badge), el('strong', '', badge.name));
    gallery.append(tile);
    const item = el('li', 'ranking-achievement');
    const details = el('div', 'ranking-achievement-detail');
    const source = badge.source === 'manual' ? '運営による付与' : '自動付与';
    details.append(el('strong', '', badge.name), el('span', 'ranking-note', [source, formatDate(badge.awardedAt)].filter(Boolean).join(' · ')));
    if (badge.description) details.append(el('span', 'ranking-badge-description', badge.description));
    item.append(badgeMark(badge), details);
    list.append(item);
  }
  card.append(overview, gallery, list);
  return card;
}

function renderHistory(data, loadMore) {
  const card = section('表彰履歴');
  if (!data.history.length) {
    card.append(el('p', 'empty', '表彰履歴はありません。'));
    return card;
  }
  const list = el('ul', 'ranking-achievements');
  for (const award of data.history) {
    const item = el('li', 'ranking-achievement');
    const details = el('div', 'ranking-achievement-detail');
    const label = [award.teacherName, periodLabel(award.kind, award.key), metricLabel(award.metric), `${award.rank}位`].filter(Boolean);
    const date = formatDate(award.at);
    const event = {granted: '表彰', revised: '更新', revoked: '取消'}[award.action];
    details.append(el('strong', '', award.name), el('span', '', label.join(' · ')),
      el('span', 'ranking-note', [event, date].filter(Boolean).join(' · ')));
    item.append(badgeMark(award), details);
    list.append(item);
  }
  card.append(list);
  if (data.nextCursor) card.append(button('過去の表彰をさらに表示', () => loadMore(data.nextCursor)));
  return card;
}

// The callable rechecks the session and owner role. The form only submits explicit actions.
function definitionForm({type, definitions, save}) {
  const auto = type === 'automatic';
  const idKey = auto ? 'ruleId' : 'badgeId';
  const form = el('form', 'ranking-owner-form');
  const picker = select([['', auto ? '新しい自動ルール' : '新しい手動バッジ'],
    ...definitions.map(item => [item[idKey], item.name])]);
  const name = input('text');
  name.required = true;
  name.maxLength = 60;
  const color = input('color', '#4f63e9');
  const icon = input('text');
  icon.required = true;
  icon.maxLength = 16;
  const active = input('checkbox');
  const activeLabel = field(auto ? 'ルールを有効にする' : '新規付与を許可する', active);
  activeLabel.className = 'ranking-checkbox';
  const heading = el('h3', '', auto ? '自動バッジ・表彰ルール' : '手動バッジの作成・編集');
  const fields = el('div', 'ranking-owner-grid');
  fields.append(field('編集対象', picker), field('名称', name), field('色', color), field('アイコン文字', icon));

  const category = select([['badge', 'バッジ'], ['award', '表彰']]);
  const kind = select([['month', '月間'], ['year', '年度'], ['all', '累計']]);
  const metric = select(metrics.map(([key, label]) => [key, label]));
  const criterion = select([['minimum', '実績が指定値以上'], ['rank', '指定順位以内']]);
  const value = input('number');
  value.min = '1';
  value.step = '1';
  value.required = auto;

  function constrainAward() {
    const award = category.value === 'award';
    kind.querySelector('[value="all"]').disabled = award;
    criterion.querySelector('[value="minimum"]').disabled = award;
    if (award && kind.value === 'all') kind.value = 'month';
    if (award) criterion.value = 'rank';
    value.max = criterion.value === 'rank' ? '300' : '1000000';
  }

  function populate() {
    const item = definitions.find(entry => entry[idKey] === picker.value);
    name.value = item?.name || '';
    color.value = item?.color || '#4f63e9';
    icon.value = item?.icon || '';
    active.checked = item?.active === true;
    if (auto) {
      category.value = item?.category || 'badge';
      kind.value = item?.kind || 'month';
      metric.value = item?.metric || 'slots';
      criterion.value = item?.criterion || 'minimum';
      value.value = item?.value ?? '';
      constrainAward();
    }
  }

  if (auto) {
    category.addEventListener('change', constrainAward);
    criterion.addEventListener('change', constrainAward);
    fields.append(field('種類', category), field('対象期間', kind), field('集計部門', metric),
      field('付与条件', criterion), field('基準値', value));
    form.append(heading, el('p', 'ranking-note', '表彰は締め済みの月間・年度実績を対象にします。'));
  } else {
    form.append(heading);
  }

  const saveButton = submit('保存する');
  const message = status('', 'ranking-form-status');
  let newId;
  picker.addEventListener('change', () => {
    newId = undefined;
    populate();
  });
  populate();
  form.append(fields, activeLabel, saveButton, message);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!name.value.trim() || !icon.value.trim()) {
      message.textContent = '名称とアイコン文字を入力してください。';
      (name.value.trim() ? icon : name).focus();
      return;
    }
    const badgeId = picker.value || (newId ||= crypto.randomUUID());
    const data = {action: auto ? 'saveAutomaticRule' : 'saveManualBadge', [idKey]: badgeId,
      name: name.value.trim(), color: color.value, icon: icon.value.trim(), active: active.checked};
    if (auto) Object.assign(data, {category: category.value, kind: kind.value, metric: metric.value,
      criterion: criterion.value, value: Number(value.value)});
    save(data, form, message, auto ? '自動ルールを保存しました。' : '手動バッジを保存しました。');
  });
  return form;
}

const badgeIcons = ['🏆','🥇','👑','💎','⭐','🤝','🌸','🔥','🎖️','🛡️','🚀','🎓'];
const badgeColors = ['#c89c38','#98a3b3','#b87947','#4f63e9','#238c74','#9062bd','#ce536b','#344155'];

function manualBadgeForm({definitions, save}) {
  const form = el('form', 'ranking-owner-form ranking-badge-builder');
  const picker = select([['','新しい手動バッジ'],...definitions.map(x=>[x.badgeId,x.name+(x.active?'':'（停止中）')])]);
  const name = input('text'); name.required=true; name.maxLength=60; name.placeholder='例：特別功労賞';
  const description = el('textarea'); description.rows=3; description.maxLength=300; description.placeholder='バッジの説明（任意）';
  const active = input('checkbox');
  const activeLabel = field('新規付与を許可する',active); activeLabel.className='ranking-checkbox';
  const preview = el('div','ranking-badge-preview');
  const medal = el('div','ranking-medal-preview');
  const mark = badgeMark({icon:badgeIcons[1],color:badgeColors[0]});
  medal.append(mark);
  const title = el('strong','ranking-preview-title');
  const detail = el('p','ranking-badge-description');
  preview.append(medal,title,detail,el('small','ranking-note','プレビュー'));
  const icons = el('div','ranking-icon-options');
  const colors = el('div','ranking-color-options');
  const custom = input('text'); custom.maxLength=16; custom.setAttribute('aria-label','その他のアイコン');
  const customColor = input('color','#c89c38'); customColor.setAttribute('aria-label','その他の色');
  let icon=badgeIcons[1], color=badgeColors[0], newId;
  const iconButtons=badgeIcons.map(value=>{
    const b=button(value,()=>{icon=value;custom.value='';refresh()},'ranking-icon-choice');
    b.setAttribute('aria-label',value); icons.append(b); return b;
  });
  const colorButtons=badgeColors.map((value,i)=>{
    const b=button('',()=>{color=value;customColor.value=value;refresh()},'ranking-color-choice');
    b.style.setProperty('--badge-color',value); b.setAttribute('aria-label',['金','銀','銅','青','緑','紫','赤','濃紺'][i]);
    colors.append(b); return b;
  });
  function refresh(){
    mark.textContent=icon||'★'; mark.style.setProperty('--badge-color',color);
    medal.style.setProperty('--badge-color',color);
    title.textContent=name.value.trim()||'バッジ名';
    detail.textContent=description.value.trim()||'バッジの説明';
    iconButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(icon===badgeIcons[i])));
    colorButtons.forEach((b,i)=>{const selected=color===badgeColors[i];b.setAttribute('aria-pressed',String(selected));b.textContent=selected?'✓':''});
  }
  function populate(){
    const item=definitions.find(x=>x.badgeId===picker.value);
    name.value=item?.name||''; description.value=item?.description||'';
    icon=item?.icon||badgeIcons[1]; color=item?.color||badgeColors[0]; active.checked=item?item.active===true:true;
    custom.value=badgeIcons.includes(icon)?'':icon;customColor.value=color;
    newId=undefined;refresh();
  }
  picker.addEventListener('change',populate);
  name.addEventListener('input',refresh);description.addEventListener('input',refresh);
  custom.addEventListener('input',()=>{icon=custom.value.trim()||badgeIcons[1];refresh()});
  customColor.addEventListener('input',()=>{color=customColor.value;refresh()});
  const more=el('details','ranking-custom-options'); more.append(el('summary','','その他のアイコン・色'),field('アイコン文字',custom),field('カスタムカラー',customColor));
  const message=status('','ranking-form-status');
  form.append(el('h3','','オリジナルバッジを作成・編集'),field('編集対象',picker),preview,field('バッジ名称',name),
    el('strong','ranking-field-title','アイコン'),icons,el('strong','ranking-field-title','バッジカラー'),colors,more,
    field('バッジの説明',description),activeLabel,submit('バッジを保存する'),message);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(!name.value.trim()||!icon.trim()){message.textContent='名称とアイコンを入力してください。';return;}
    save({action:'saveManualBadge',badgeId:picker.value||(newId||=crypto.randomUUID()),name:name.value.trim(),description:description.value.trim().replace(/\s*\n\s*/g,' '),color,icon,active:active.checked},form,message,'手動バッジを保存しました。');
  });
  populate();
  return form;
}

function grantForm({data, save}) {
  const form=el('form','ranking-owner-form');
  const badge=select([['','選択してください'],...data.badges.map(x=>[x.badgeId,x.name+(x.active?'':'（停止中）')])]); badge.required=true;
  const mode=select([['grant','付与する'],['revoke','取り消す']]);
  const reason=input('text');reason.required=true;reason.maxLength=500;
  const list=el('div','ranking-recipient-list');
  const action=submit('0名にバッジを付与する');
  const message=status('','ranking-form-status');
  const selected=new Set();
  const preview=el('div','ranking-grant-preview');
  function update(){
    action.textContent=mode.value==='grant'?`${selected.size}名にバッジを付与する`:`${selected.size}名の付与を取り消す`;
    action.disabled=!badge.value||!selected.size||selected.size>100;
  }
  function populate(){
    selected.clear();list.replaceChildren();preview.replaceChildren();
    const def=data.badges.find(x=>x.badgeId===badge.value);
    if(def)preview.append(badgeMark(def),el('strong','',def.name));
    for(const teacher of data.teachers){
      const granted=data.grants.some(x=>x.badgeId===badge.value&&x.teacherUid===teacher.teacherUid);
      const can=!!def&&(mode.value==='revoke'?granted:def.active&&!granted&&teacher.canGrant!==false);
      const cb=input('checkbox');cb.disabled=!can;
      const label=el('label','ranking-recipient');
      label.append(cb,el('span','',teacher.name),el('small','ranking-note',granted?'付与済み':teacher.canGrant===false?'履歴のみ':'未付与'));
      cb.addEventListener('change',()=>{if(cb.checked)selected.add(teacher.teacherUid);else selected.delete(teacher.teacherUid);update()});
      list.append(label);
    }
    if(!data.teachers.length)list.append(el('p','empty','対象者がいません。'));
    update();
  }
  badge.addEventListener('change',populate);mode.addEventListener('change',populate);
  form.append(el('h3','','講師への一括付与・取消'),field('手動バッジ',badge),preview,field('操作',mode),
    el('strong','ranking-field-title','対象者（複数選択可能）'),list,field('理由',reason),action,message);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(action.disabled||!reason.value.trim())return;
    const count=selected.size;
    save({action:mode.value==='grant'?'grantManualBadges':'revokeManualBadges',badgeId:badge.value,teacherUids:[...selected].sort(),reason:reason.value.trim()},form,message,
      mode.value==='grant'?`${count}名にバッジを付与しました。`:`${count}名の付与を取り消しました。`);
  });
  populate();return form;
}

function manualHistory(data){
  const card=section('手動バッジ操作履歴');
  card.append(el('p','ranking-note','最新100件の表彰・バッジイベント内の手動操作を表示します。'));
  const events=data.manualHistory||[];
  const badge=select([['','すべてのバッジ'],...new Map(events.map(x=>[x.badgeId,x.name]))]);
  const teacher=select([['','すべての対象者'],...new Map(events.map(x=>[x.teacherUid,x.teacherName]))]);
  const month=input('month');
  const rows=el('div','ranking-manual-history');
  function refresh(){
    rows.replaceChildren();
    const filtered=events.filter(x=>(!badge.value||x.badgeId===badge.value)&&(!teacher.value||x.teacherUid===teacher.value)&&(!month.value||(Number.isFinite(Date.parse(x.at))&&new Date(Date.parse(x.at)+9*3600000).toISOString().slice(0,7)===month.value)));
    for(const x of filtered){
      const row=el('div','ranking-history-row');
      row.append(el('strong','',x.name+' · '+(x.action==='granted'?'付与':x.action==='revoked'?'取消':'更新')),
        el('span','',x.teacherName+' · '+formatDate(x.at)),el('span','ranking-note','操作者：'+x.actorName),el('span','ranking-badge-description',x.reason));
      rows.append(row);
    }
    if(!filtered.length)rows.append(el('p','empty','該当する履歴はありません。'));
  }
  badge.addEventListener('change',refresh);teacher.addEventListener('change',refresh);month.addEventListener('change',refresh);
  card.append(field('バッジ',badge),field('対象者',teacher),field('対象月（任意）',month),rows);refresh();return card;
}

export function installRankingLive({trigger, dialog, host, call, callAchievement, getSession, getRole, getAvailable, today}) {
  let kind = 'month';
  let key = '';
  let metric = 'slots';
  let expanded = false;
  let view = 'rank';
  let target;
  let result;
  let error;
  let success;
  let loading = false;
  let serial = 0;
  let session;
  let role;
  let pendingMutation;
  const allowed = () => Boolean(getSession() && getAvailable() && roles.includes(getRole()));
  const available = () => allowed() && dialog.open && (view !== 'owner' || getRole() === 'owner');

  function clear() {
    serial++;
    target = result = error = success = pendingMutation = undefined;
    loading = false;
    host.replaceChildren();
  }

  function sync() {
    const nextSession = getSession();
    const nextRole = getRole();
    if (nextSession !== session || nextRole !== role || !allowed()) {
      clear();
      if (dialog.open) dialog.close();
      session = nextSession;
      role = nextRole;
    }
    trigger.hidden = !allowed();
  }

  function resetKey() {
    const date = today();
    if (kind === 'cumulative') key = '';
    else if (kind === 'month') key = date.slice(0, 7);
    else key = String(Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0));
  }

  function go(nextView, teacher) {
    if (!available() || (nextView === 'owner' && getRole() !== 'owner')) return;
    view = nextView;
    target = teacher;
    success = undefined;
    load();
  }

  function fetchView(cursor) {
    switch (view) {
      case 'rank':
        return call({kind, key, metric});
      case 'profile':
        return call({kind: 'profile', ...(target ? {teacherUid: target.teacherUid} : {})});
      case 'badges':
        return callAchievement({action: 'listBadges', ...(target ? {teacherUid: target.teacherUid} : {})});
      case 'history':
        return callAchievement({action: 'listHistory', ...(cursor ? {cursor} : {})});
      default:
        return callAchievement({action: 'manage'});
    }
  }

  function current(seq, uid, currentRole) {
    return seq === serial && uid === getSession() && currentRole === getRole() && available();
  }

  async function load(cursor) {
    if (!available()) return;
    const seq = ++serial;
    const uid = getSession();
    const currentRole = getRole();
    const previous = cursor ? result : null;
    loading = true;
    error = undefined;
    result = undefined;
    expanded = false;
    render();

    try {
      const {data} = await fetchView(cursor);
      if (!current(seq, uid, currentRole)) return;
      if (!validResponse(view, data)) throw Error('INVALID_RESPONSE');
      result = previous ? {...data, history: [...previous.history, ...data.history]} : data;
    } catch (failure) {
      if (!current(seq, uid, currentRole)) return;
      const unpublished = view === 'rank' || view === 'profile' ? 'ランキングはまだ公開されていません。' : undefined;
      error = failureMessage(failure, 'データを取得できませんでした。', unpublished);
      result = previous;
    } finally {
      if (current(seq, uid, currentRole)) {
        loading = false;
        render();
      }
    }
  }

  async function save(data, form, message, successMessage) {
    if (!available() || view !== 'owner' || getRole() !== 'owner' || pendingMutation?.busy) return;
    const signature = JSON.stringify(data);
    const operationId = pendingMutation?.signature === signature ? pendingMutation.operationId : crypto.randomUUID();
    const mutation = {signature, operationId, busy: true};
    pendingMutation = mutation;
    const seq = serial;
    const uid = getSession();
    const currentRole = getRole();
    const controls = [...host.querySelectorAll('.ranking-owner-form :is(button,input,select,textarea):enabled')];
    for (const control of controls) control.disabled = true;
    message.textContent = '保存しています…';
    try {
      const reply = await callAchievement({...data, operationId});
      if (!['committed', 'replayed'].includes(reply?.data?.state)) throw Error('INVALID_RESPONSE');
      if (pendingMutation === mutation) pendingMutation = undefined;
      if (!current(seq, uid, currentRole)) return;
      success = successMessage;
      load();
    } catch (failure) {
      if (pendingMutation === mutation) mutation.busy = false;
      if (!current(seq, uid, currentRole) || !form.isConnected) return;
      message.textContent = failureMessage(failure, '保存を確認できませんでした。同じ内容で再試行できます。');
      for (const control of controls) control.disabled = false;
    }
  }

  function renderRank() {
    const switcher = el('div', 'ranking-period-switch');
    for (const [id, label] of periods) {
      switcher.append(toggle(label, kind === id, () => {
        if (kind === id) return;
        kind = id;
        resetKey();
        load();
      }, id));
    }
    host.append(switcher);

    const filters = el('div', 'ranking-filters');
    if (kind !== 'cumulative') {
      const period = input(kind === 'month' ? 'month' : 'number', key);
      period.dataset.rankingFocus = 'period';
      period.required = true;
      if (kind === 'year') {
        period.min = '2000';
        period.max = String(Number(today().slice(0, 4)) - (Number(today().slice(5, 7)) < 4 ? 1 : 0));
      } else {
        period.min = '2000-01';
        period.max = today().slice(0, 7);
      }
      period.addEventListener('change', () => {
        if (period.reportValidity() && period.value !== key) {
          key = period.value;
          load();
        }
      });
      filters.append(field('対象期間', period));
    }
    const department = select(metrics.map(([id, label]) => [id, label]), metric);
    department.dataset.rankingFocus = 'metric';
    department.addEventListener('change', () => {
      metric = department.value;
      load();
    });
    filters.append(field('ランキング部門', department));
    host.append(filters);

    if (result) {
      host.append(el('h3', 'ranking-period-title', result.period + ' · ' + metricLabel(metric)));
      if (!result.coverage.complete) host.append(coverageNotice(result.coverage));
      else if (!result.rows.length) host.append(el('p', 'empty', '集計対象の確定実績はありません。'));
      else renderRows();
    }
    host.append(el('p', 'ranking-method', method),
      el('p', 'ranking-note', '勤務量の参考情報です。指導力や人事評価を示すものではありません。'));
  }

  function renderRows() {
    const unit = metrics.find(([id]) => id === metric)[2];
    const top = result.rows.filter(row => row.rank <= 3);
    const rest = result.rows.filter(row => row.rank > 3);
    const podium = el('div', 'ranking-podium');
    const ordered = top.length === 3 && top.map(row => row.rank).join(',') === '1,2,3'
      ? [top[1], top[0], top[2]] : top;
    for (const row of ordered) {
      const tile = button('', () => go('profile', row), `ranking-podium-person rank-${row.rank}`);
      tile.append(el('span', 'ranking-medal', ['🥇', '🥈', '🥉'][row.rank - 1]),
        avatar(), el('strong', 'ranking-name', row.name), el('span', 'ranking-count', `${row[metric]} ${unit}`),
        el('span', 'ranking-podium-base', String(row.rank)));
      podium.append(tile);
    }
    host.append(podium);

    if (!rest.length) return;
    if (expanded) {
      const list = el('div', 'ranking-list');
      for (const row of rest) {
        const tile = button('', () => go('profile', row), 'ranking-person-row');
        tile.append(el('strong', 'ranking-position', String(row.rank)), avatar(),
          el('strong', 'ranking-name', row.name), el('span', 'ranking-count', `${row[metric]} ${unit}`));
        list.append(tile);
      }
      host.append(list);
    }
    const more = button(expanded ? '↑ 閉じる' : `↓ 全員を表示（${result.rows.length}名）`, () => {
      expanded = !expanded;
      render();
    }, 'ghost ranking-expand');
    more.dataset.rankingFocus = 'show-all';
    more.setAttribute('aria-expanded', String(expanded));
    host.append(more);
  }

  function render() {
    if (!available()) return;
    const focusKey = document.activeElement?.dataset.rankingFocus;
    host.replaceChildren();

    const head = el('div', 'ranking-head');
    const heading = el('h2', '', '講師ランキング');
    const close = button('×', () => dialog.close(), 'close-modal');
    close.setAttribute('aria-label', '閉じる');
    head.append(heading, close);

    const tabs = el('div', 'ranking-tabs');
    const tabItems = [['rank', 'ランキング'], ['profile', 'プロフィール'], ['badges', '獲得バッジ'], ['history', '表彰履歴']];
    if (getRole() === 'owner') tabItems.push(['owner', 'バッジ管理']);
    for (const [id, label] of tabItems) tabs.append(toggle(label, view === id, () => go(id), id));
    host.append(head, status('QA検証版 · 確定済み実績', 'ranking-demo'), tabs);

    if (success) host.append(status(success, 'ranking-success'));
    if (view === 'rank') renderRank();
    else if (result && view === 'profile') {
      host.append(renderProfile(result, (teacherUid, name) => go('badges', {teacherUid, name})),
        button('← ランキングに戻る', () => go('rank')));
    } else if (result && view === 'badges') {
      host.append(renderBadges(result, target?.name));
    } else if (result && view === 'history') {
      host.append(renderHistory(result, load));
    } else if (result && view === 'owner') {
      host.append(manualBadgeForm({definitions: result.badges, save}),
        grantForm({data: result, save}), manualHistory(result), definitionForm({type: 'automatic', definitions: result.rules, save}));
    }

    if (loading) host.append(status('取得しています…', 'empty'));
    else if (error) {
      host.append(status(error));
      if (!result?.nextCursor) host.append(button('再取得', () => load()));
    }
    if (focusKey) host.querySelector(`[data-ranking-focus="${focusKey}"]`)?.focus({preventScroll: true});
  }

  function open(initialView, beforeOpen) {
    if (!allowed() || dialog.open) return;
    beforeOpen?.();
    clear();
    kind = 'month';
    metric = 'slots';
    view = initialView;
    resetKey();
    dialog.showModal();
    load();
    host.querySelector('.close-modal')?.focus();
  }
  trigger.addEventListener('click', () => open('rank'));
  dialog.addEventListener('close', () => {
    if (!dialog.open) clear();
  });
  sync();
  return {
    sync,
    openAchievement: (target, beforeOpen) => {
      if (target === 'badges' || target === 'history') open(target, beforeOpen);
    },
  };
}
