import { renderPractice } from './help-practice.js?v=20261126-tutorial-modal';
// Static, role-filtered Shiftly-T operation guide. No Firebase access or writes.
const topics = [
  [
    'employee',
    'calendar-days',
    '時間割を確認する',
    '毎日の授業・週予定・月予定を確認します。',
    [
      '「時間割」を開く。',
      '「自分の担当授業」または「全教師の授業」を選択する。',
      '日付を押してカレンダーを開き、日・週・月の表示範囲と日付を選択する。左右の矢印でも期間を移動できる。',
      '授業カードを押すと授業詳細を確認できる。',
    ],
    '赤い授業カードは生徒欠席。連続授業はコマごとに表示されます。「要振替」がある場合は管理者に確認してください。',
  ],
  [
    'employee',
    'users',
    '生徒情報・通常授業を確認する',
    '生徒一覧から教材・曜日・時間・担当講師・備考を確認します。',
    [
      '「生徒一覧」を開く。',
      '生徒名・学年・学校・教材で検索する。',
      '校種や並び替えを必要に応じて選択する。',
    ],
    '講師は閲覧専用です。登録内容を変更したい場合は管理者へ連絡してください。',
  ],
  [
    'employee',
    'book',
    '伝達事項と次回授業を確認する',
    '授業詳細に表示される生徒の情報を授業前に確認します。',
    [
      '時間割から該当の授業カードを押す。',
      '授業日時・教科・担当講師・学年を確認する。',
      '今後の来塾予定と伝達事項を読む。',
    ],
    '講師は伝達事項を編集できません。内容の訂正は管理者に依頼してください。',
  ],
  [
    'employee',
    'calendar-off',
    '休校日・模試・講習期間を確認する',
    '休校日カレンダーで教室の予定を確認します。',
    [
      '休校日カレンダーを開く。',
      '月を移動して対象日を選択する。',
      '休校・模試・講習の詳細と備考を確認する。',
    ],
    '日曜・祝日は原則休校です。特別開校日・模試等による例外があるため実際のカレンダーを確認してください。',
  ],
  [
    'employee',
    'clock',
    '講習の勤務希望を提出する',
    '春期・夏期・冬期講習の出勤可能な日時を登録します。',
    [
      '「勤務希望登録」を開き、対象の講習を選択する。',
      '横にスクロールして講習の全日程を確認する。',
      '出勤可能なコマを選択する（緑＝出勤可能）。',
      '「勤務希望を提出」を押し、保存結果を確認する。',
    ],
    '勤務希望は出勤確定ではありません。締切までは変更可能ですが、締切後は管理者へ連絡してください。',
  ],
  [
    'employee',
    'bell',
    '通知とお知らせを確認する',
    '通知ベルから授業変更などの連絡を確認します。',
    [
      '画面右上の通知ベルを押す。',
      '通常通知と運営からのお知らせを確認する。',
      '対象の通知を選択し、必要に応じて時間割を確認する。',
    ],
    '通常通知は直近10件。運営のお知らせは掲載期間中に固定表示されます。',
  ],
  [
    'employee',
    'help',
    '困ったとき・よくある質問',
    'ログイン・表示・操作の問題への基本対応です。',
    [
      'ログインできない：メールアドレスとパスワードを確認する。',
      '授業が見つからない：日付、表示対象（自分／全教師）、休校・講習期間を確認する。',
      '読み込みが終わらない：通信環境を確認し、未保存の変更がない場合は再読み込みする。',
      '改善しない場合は、画面の状況とエラー内容を管理者に伝える。',
    ],
    '個人情報・パスワード・QRコードを不用意に共有しないでください。',
  ],
  [
    'admin',
    'users',
    '生徒を登録・編集する',
    '毎週の基本授業を生徒管理で設定します。',
    [
      '「生徒管理」→「＋ 生徒を登録」または既存生徒の「編集」。',
      '生徒名・学年・学校・教材・備考を入力する。',
      '「＋ 通常授業を追加」で曜日・開始／終了時刻・担当講師・適用開始日を入力する。',
      '週2回以上の場合は必要な授業を追加し、「保存する」を押す。',
    ],
    '登録した基本授業は毎週の時間割に反映されます。特定日だけの変更は時間割を使用してください。',
  ],
  [
    'admin',
    'archive',
    '退塾・非表示と完全削除',
    '退塾時は履歴を残す操作を優先します。',
    [
      '「生徒管理」から該当生徒を編集する。',
      '「退塾・非表示」を押し、対象を確認する。',
      '「退塾として保存する」で確定する。',
      '必要な場合は「退塾者を含める」で確認する。',
    ],
    '退塾は過去の授業を保持しQRを失効させます。完全削除は関連データも削除する別操作です。通常の退塾処理には使用しないでください。',
  ],
  [
    'admin',
    'calendar-days',
    '時間割と日別の授業編集',
    '登録済みの時間割を確認し、必要な日だけ授業を調整します。',
    [
      '「時間割」を押すと時間割が表示される。',
      '対象の日付を選択する。',
      '「＋ 授業を登録」または授業詳細の「授業を編集」で内容を入力する。',
      '「授業を保存」で反映する。',
    ],
    '通常授業の個別日編集はその日だけに適用されます。毎週の変更は生徒管理から行ってください。',
  ],
  [
    'admin',
    'grid',
    '通常授業エディター・振替・講師欠席',
    '担当振替と欠席を日単位で調整します。',
    [
      '「時間割」→「時間割を編集」を開く。',
      '講師名を押し、欠席コマを選択する。',
      '授業カードをドラッグするか、カード→移動先のマスの順にタップする。',
      '未振替・担当上限の警告を確認し、「変更を確定」を押す。',
    ],
    '黒いマスは配置不可。原則1講師1コマ2人まで。同じ時間帯で担当を変更します。欠席・振替は確定前は仮変更で、毎週の基本設定は変わりません。',
  ],
  [
    'admin',
    'clock',
    '講師の通常勤務・臨時出勤を設定する',
    '毎週の勤務時間と特定日だけの例外を分けて管理します。',
    [
      '「講師管理」を開いて講師を選択する。',
      '曜日ごとに勤務可能なコマを選択する。',
      '「通常勤務時間を保存」を押す。',
      '特定日の変更は対象日を選び、出勤コマを選択して「この日の出勤コマを保存」を押す。',
    ],
    '日別設定は通常勤務より優先されますが、コマ別欠席が優先されます。勤務外になった既存授業は削除されず要振替になります。',
  ],
  [
    'admin',
    'calendar-off',
    '休校日・特別開校・模試の管理',
    '教室の営業日と特別予定を登録します。',
    [
      '「休校日管理」で対象日を選ぶ。',
      '休校登録・開校指定・模試登録のうち目的に合う操作を選ぶ。',
      '日付や備考、模試の時刻を確認して保存する。',
    ],
    '休校によって元の授業データは削除されません。解除すると元の授業が再表示されます。予約への影響も確認してください。',
  ],
  [
    'admin',
    'calendar-range',
    '講習期間と提出締切を設定する',
    '年度ごとの講習期間・専用コマ・勤務希望締切を登録します。',
    [
      '「講習期間管理」→「＋ 講習期間を登録」。',
      '講習の種類・開始日・終了日・勤務希望提出締切を入力する。',
      '講習専用の授業コマを追加し、時刻が重ならないことを確認する。',
      '「講習期間を保存」を押す。',
    ],
    '講習期間中は通常授業を削除せず非表示にします。終了後は通常授業に戻ります。締切未設定では講師本人の希望提出を受け付けません。',
  ],
  [
    'admin',
    'clipboard',
    '講習勤務希望の確認・代理修正',
    '講師の提出状況と出勤可能なコマを確認します。',
    [
      '「講習期間管理」→「勤務希望登録・提出状況」。',
      '対象の講習・講師を選択する。',
      '提出状況、締切、出勤可能コマを確認する。',
      '必要に応じて希望を変更し、「勤務希望を提出」を押す。',
    ],
    '通常勤務時間と講習勤務希望は別設定です。講師本人は締切後に変更できませんが管理者は修正できます。',
  ],
  [
    'admin',
    'grid',
    '講習配置エディターで配置を確定する',
    '講習専用授業を登録・配置変更します。',
    [
      '「講習期間管理」→「講習配置エディター」。',
      '対象講習・日付または週を選ぶ。',
      '「＋ 講習授業を登録」で仮登録するか、授業カードを移動する。',
      '重複・休校・勤務希望・担当上限を確認し、「確定して反映」を押す。',
    ],
    '仮登録・移動は確定まで講師の時間割に反映されません。保護者QR予約からの授業は講習予約管理の公開手順も確認してください。',
  ],
  [
    'admin',
    'qr',
    '講習予約の受付設定・QR印刷',
    '保護者用予約画面と受入枠を準備します。',
    [
      '講習期間・休校日・講師勤務希望を先に設定する。',
      '「講習予約管理」で対象講習を選び受付開始／締切を設定する。',
      '「受付期間を保存して予約枠を同期する」を押す。',
      '生徒詳細から初回QR発行・印刷、または全生徒のQRを一括印刷する。',
    ],
    '受入枠は勤務可能講師の担当上限の合計（最大2人／講師）で自動計算されます。QRは生徒ごとに配布し、他人に共有しないでください。再発行すると旧QRは無効になります。',
  ],
  [
    'admin',
    'clipboard',
    '予約希望の確認・授業確定・公開',
    '希望から実際の授業へ反映する手順です。',
    [
      '「講習予約管理」で生徒別希望一覧または日時別希望一覧を開く。',
      '生徒詳細の希望日時を確認する。',
      '担当講師・教科を設定し「このコマを確定」を押す。',
      '確定内容を確認して「この授業を公開」またはまとめて公開する。',
    ],
    '希望は授業確定ではなく、確定だけでは保護者への公開は完了しません。公開済み授業を変更した場合は保護者の確認状況も確認してください。',
  ],
  [
    'admin',
    'help',
    '保存・仮登録・確定・公開の違い',
    '操作の状態を区別して誤操作を防ぎます。',
    [
      '保存：基本情報・設定を記録する。',
      '仮登録：エディターの作業中の変更。未確定なら反映されない。',
      '確定：エディターでは時間割へ反映、QR予約では担当等を確定する。',
      '公開：QR予約で確定済みの授業を教室の時間割と保護者画面に反映する。',
    ],
    'エラー時は表示された指示に従い、送信結果が不明なときは重複登録を避けるため再送前に保存結果を確認してください。',
  ],
  [
    'owner',
    'settings',
    'メンテナンスモードを操作する',
    'システム更新時に一般利用を一時停止します。',
    [
      '「システム管理」を開く。',
      '案内文と対象バージョンを設定する。',
      '「メンテナンスを開始」を押し停止状態を確認する。',
      '更新・安全確認後に「メンテナンスを終了・利用再開」を押す。',
    ],
    '停止中は管理者・講師の利用を制限します。運営が動作確認し、安全を確認してから再開してください。',
  ],
  [
    'owner',
    'history',
    '変更履歴を確認する',
    'いつ・誰が・何を変更したかを確認します。',
    [
      '「変更履歴・バックアップ」を開く。',
      '「最新を取得」で履歴を更新する。',
      '対象の日時・変更者・変更内容を確認する。',
    ],
    '履歴からの復元は影響範囲を確認してから行ってください。履歴はバックアップそのものではありません。',
  ],
  [
    'owner',
    'archive',
    'バックアップを作成・保管する',
    '本番業務データのバックアップを作成します。',
    [
      '「変更履歴・バックアップ」を開く。',
      '識別できるバックアップ名を入力する。',
      '「今のデータをバックアップ」を押し、作成結果を確認する。',
      '必要に応じてJSONを安全な場所に保存する。',
    ],
    'バックアップには生徒等の個人情報が含まれます。ログインアカウントや個人通知は保存対象外です。',
  ],
  [
    'owner',
    'history',
    '全体復元の注意事項',
    '復元は重大な障害時に限り慎重に行います。',
    [
      'メンテナンスを開始し、業務を停止する。',
      '復元前の安全バックアップを作成する。',
      '対象バックアップと復元範囲を確認する。',
      '復元結果・データの整合性を確認し、必要なQRを再発行してから再開する。',
    ],
    '復元後は発行済みQRが無効になります。処理中に失敗した場合は画面の指示に従い、安易に再送や利用再開をしないでください。',
  ],
  [
    'owner',
    'bell',
    '公式お知らせを配信する',
    'スタッフ全員に掲載期間付きのお知らせを表示します。',
    [
      '右上の通知ベルを開く。',
      '運営専用のお知らせ欄に案内文を入力する。',
      '掲載開始・掲載終了を設定する。',
      '「期間を指定して掲載」を押し、掲載したお知らせの管理欄で確認する。',
    ],
    '掲載中のお知らせは管理者・講師が削除できません。必要に応じて運営が掲載を取り消してください。',
  ],
];
const labels = { employee: '講師向け', admin: '管理者向け', owner: '運営向け' };
export function guideRoles(role) {
  return role === 'owner'
    ? ['employee', 'admin', 'owner']
    : role === 'admin'
      ? ['employee', 'admin']
      : role === 'employee'
        ? ['employee']
        : [];
}
export function guideTopics(role, selected, query) {
  const allowed = guideRoles(role);
  const q = String(query || '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return topics.filter(
    (t) =>
      allowed.includes(t[0]) &&
      (q.length
        ? q.every((w) => t.flat(Infinity).join(' ').normalize('NFKC').toLowerCase().includes(w))
        : t[0] === selected),
  );
}
export function installHelpGuide({ getRole, getUser }) {
  const $ = (id) => document.getElementById(id);
  const button = $('helpGuideButton'),
    dialog = $('helpGuideDialog'),
    search = $('helpGuideSearch'),
    tabs = $('helpGuideTabs'),
    list = $('helpGuideList'),
    count = $('helpGuideCount');
  const bell = $('notificationButton'),
    app = $('appPanel'),
    practice = $('helpPracticeHost'),
    supplement = $('helpGuideSupplement');
  let selected = '',
    session = '';
  const make = (tag, cls, value) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (value !== undefined) e.textContent = value;
    return e;
  };
  const available = () => Boolean(getUser() && guideRoles(getRole()).length && !bell.hidden && !app.hidden);
  function clear() {
    search.value = '';
    selected = '';
    session = '';
    tabs.replaceChildren();
    list.replaceChildren();
    practice.replaceChildren();
    supplement.open = false;
    count.textContent = '';
    if (dialog.open) dialog.close();
  }
  function sync() {
    button.hidden = !available();
    if (button.hidden) {
      clear();
      return;
    }
    const next = getUser() + ':' + getRole();
    if (session && session !== next) clear();
  }
  function render() {
    if (!available()) {
      sync();
      return;
    }
    const role = getRole(),
      allowed = guideRoles(role);
    if (!allowed.includes(selected)) selected = role;
    tabs.replaceChildren();
    for (const value of allowed) {
      const b = make('button', 'help-guide-tab', labels[value]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(value === selected && !search.value.trim()));
      b.addEventListener('click', () => {
        selected = value;
        search.value = '';
        render();
      });
      tabs.append(b);
    }
    tabs.hidden = allowed.length < 2;
    const query = search.value.trim(),
      items = guideTopics(role, selected, query);
    count.textContent =
      (query ? '閲覧可能な全ガイドから検索' : labels[selected]) + ' · ' + items.length + '件';
    renderPractice(practice, { allowed, selected, query });
    supplement.open = false;
    list.replaceChildren();
    for (const [group, icon, title, desc, steps, tip] of items) {
      const details = make('details', 'help-guide-item'),
        summary = make('summary', 'help-guide-summary'),
        heading = make('span', 'help-guide-heading');
      heading.append(
        make('small', 'help-guide-category', labels[group]),
        make('strong', '', title),
        make('span', 'help-guide-desc', desc),
      );
      summary.append(heading, make('span', 'help-guide-chevron', '⌄'));
      details.append(summary);
      const content = make('div', 'help-guide-content'),
        ol = make('ol', 'help-guide-steps');
      steps.forEach((step) => ol.append(make('li', '', step)));
      const caution = make('div', 'help-guide-tip');
      caution.append(make('strong', '', '注意・ポイント'), make('p', '', tip));
      content.append(ol, caution);
      details.append(content);
      list.append(details);
    }
    if (!items.length)
      list.append(
        make('p', 'help-guide-empty', '該当する操作が見つかりません。別のキーワードを入力してください。'),
      );
  }
  button.addEventListener('click', () => {
    if (!available()) return;
    session = getUser() + ':' + getRole();
    selected = getRole();
    search.value = '';
    render();
    if (!dialog.open) dialog.showModal();
  });
  search.addEventListener('input', render);
  $('helpGuideClear').addEventListener('click', () => {
    search.value = '';
    render();
    search.focus();
  });
  const observer = new MutationObserver(sync);
  observer.observe(bell, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(app, { attributes: true, attributeFilter: ['hidden'] });
  sync();
}
