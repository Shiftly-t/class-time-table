const BOOKING_CHECK_ID = 'bookingResultCheck';
const NORMAL_RETRY_ID = 'normalAuthorityRetry';
const INLINE_SUCCESS_CLASS = 'shiftly-inline-success';
const MESSAGE_TIMEOUT_MS = 7000;

export function installWorkspaceMessages({
  messageHost,
  seasonalAuthority,
  bookingTransport,
  normalAuthority,
}) {
  let messageTimer;
  let actionGeneration = 0;

  const getNotice = () => document.getElementById('shiftlyNotice');
  const openDialog = () => document.querySelector('dialog[open]:not(#shiftlyNotice)');
  const actionIds = [BOOKING_CHECK_ID, NORMAL_RETRY_ID];

  function createNotice() {
    const notice = document.createElement('dialog');
    notice.id = 'shiftlyNotice';
    notice.setAttribute('role', 'alertdialog');
    notice.setAttribute('aria-modal', 'true');
    notice.setAttribute('aria-labelledby', 'shiftlyNoticeTitle');
    notice.setAttribute('aria-describedby', 'shiftlyNoticeText');
    notice.innerHTML = `
      <div class="shiftly-notice-heading">
        <span aria-hidden="true">!</span>
        <h2 id="shiftlyNoticeTitle">内容をご確認ください</h2>
      </div>
      <p id="shiftlyNoticeText"></p>
      <div id="shiftlyNoticeActions"></div>
      <button id="shiftlyNoticeClose" type="button" autofocus>閉じる</button>
    `;
    document.body.append(notice);
    notice.querySelector('#shiftlyNoticeClose').addEventListener('click', () => notice.close());
    notice.addEventListener('close', () => {
      if (notice.open) return;
      const host = openDialog() || messageHost.parentElement;
      for (const id of [NORMAL_RETRY_ID, BOOKING_CHECK_ID]) {
        const button = notice.querySelector('#' + id);
        if (button) host.append(button);
      }
    });
    return notice;
  }

  function clearInlineSuccess() {
    document.querySelectorAll('.' + INLINE_SUCCESS_CLASS).forEach((node) => node.remove());
  }

  function clearActions() {
    for (const id of actionIds) document.getElementById(id)?.remove();
  }

  function reset() {
    actionGeneration++;
    clearTimeout(messageTimer);
    messageHost.textContent = '';
    clearInlineSuccess();
    clearActions();
  }

  function addAction({ id, label, run, success, onError }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = 'ghost';
    button.textContent = label;
    button.addEventListener('click', async () => {
      const generation = actionGeneration;
      button.disabled = true;
      try {
        await run();
        if (generation !== actionGeneration) return;
        const notice = getNotice();
        if (notice?.open) notice.close();
        showMessage.success(success);
      } catch (error) {
        if (generation === actionGeneration) onError(error);
      }
    });
    const notice = getNotice();
    const host = notice?.open
      ? notice.querySelector('#shiftlyNoticeActions')
      : openDialog() || messageHost.parentElement;
    host.append(button);
  }

  function renderMessage(message, modal = false) {
    messageHost.textContent = modal ? '' : message;
    clearTimeout(messageTimer);
    clearInlineSuccess();
    if (!modal && message) {
      const active = document.activeElement?.closest('dialog[open]');
      const top = active || [...document.querySelectorAll('dialog[open]')].at(-1);
      const content = top?.querySelector('.modal-content');
      if (content && top.id !== 'shiftlyNotice') {
        const status = document.createElement('p');
        status.className = INLINE_SUCCESS_CLASS;
        status.textContent = String(message);
        status.setAttribute('role', 'status');
        const head = content.querySelector('.modal-head');
        if (head) head.after(status);
        else content.prepend(status);
        messageHost.textContent = '';
      }
    }

    clearActions();
    if (seasonalAuthority.hasPending()) {
      addAction({
        id: BOOKING_CHECK_ID,
        label: '講習APIの送信結果を確認',
        run: () => seasonalAuthority.confirmPending(),
        success: '保存済みです。画面を開き直して最新の内容を確認してください。',
        onError: (error) => showMessage(error.message),
      });
    } else if (bookingTransport.hasPending()) {
      addAction({
        id: BOOKING_CHECK_ID,
        label: '送信結果を確認',
        run: () => bookingTransport.confirmPending(),
        success: '保存済みです。再送せず、画面を開き直して最新の内容を確認してください。',
        onError: (error) => showMessage(error.message),
      });
    }

    if (normalAuthority.hasPending()) {
      addAction({
        id: NORMAL_RETRY_ID,
        label: '保存結果を確認・同じ処理を再送',
        run: () => normalAuthority.retryPending(),
        success: '保存済みの結果を確認しました。画面を閉じて最新の内容を確認してください。',
        onError: (error) => trapError(error, '保存結果を確認できません。同じ処理を再送できます'),
      });
    } else if (message) {
      messageTimer = setTimeout(() => {
        messageHost.textContent = '';
        clearInlineSuccess();
      }, MESSAGE_TIMEOUT_MS);
    }
  }

  function showMessage(message, kind = 'warning') {
    if (!message) return renderMessage(message);

    const notice = getNotice() || createNotice();
    notice.querySelector('#shiftlyNoticeTitle').textContent =
      kind === 'error' ? '操作できませんでした' : '内容をご確認ください';
    notice.querySelector('#shiftlyNoticeText').textContent = String(message);
    if (!notice.open) notice.showModal();
    renderMessage(message, true);
  }

  showMessage.success = (message) => renderMessage(message);
  showMessage.error = (message) => showMessage(message, 'error');

  function trapError(error, fallback) {
    console.error(error);
    showMessage.error(friendlyShiftlyError(error, fallback));
  }

  return { showMessage, trapError, reset };
}

function friendlyShiftlyError(e, fallback = '処理に失敗しました') {
  const code = String(e?.code || '')
    .split('/')
    .pop();
  const message = String(e?.message || '');

  if (e?.userMessage) return e.userMessage;
  if (e?.code === 'normal-authority/blocked') return message;

  const reasons = {
    'Teacher cannot work at this time':
      '担当講師は指定日時に勤務できません。勤務時間と欠席設定を確認してください。',
    'Weekly slot is outside teacher workdays': '担当講師の通常勤務時間外です。勤務コマを確認してください。',
    'Teacher capacity exceeded': '担当講師の受講人数上限を超えています。',
    'Student already has an overlapping lesson': '同じ生徒の授業時間が重複しています。',
    'School is closed': '指定日は休校日です。',
    'Move target is closed': '移動先は休校日です。',
    'Reload work settings and revision': '勤務設定が変更されています。再読み込みしてください。',
    'Reload updated work settings': '勤務設定を再読み込みしてください。',
    'Weekly source changed; reload': '通常授業の設定が変更されています。',
    'Administrator permission required': '管理者権限が必要です。',
    'Verified App Check required': 'アプリの認証を確認できません。',
  };

  if (Object.hasOwn(reasons, message)) return reasons[message];

  const hints = {
    'permission-denied': '操作権限がありません。',
    'unauthenticated': '再ログインしてください。',
    'aborted': 'データが変更された可能性があります。再読み込みしてください。',
    'invalid-argument': '入力内容を確認してください。',
    'already-exists': '登録内容が重複していないか確認してください。',
    'failed-precondition': '操作に必要な条件を満たしていません。設定を確認してください。',
    'resource-exhausted': '処理可能な上限を超えています。',
    'unavailable': '通信状態と保存結果を確認してください。',
    'deadline-exceeded': '保存結果を確認してください。',
    'internal': '保存結果を確認し、解決しない場合は運営に連絡してください。',
  };

  const hint = Object.hasOwn(hints, code) ? hints[code] : '解決しない場合は運営に連絡してください。';

  return [fallback, hint].join(String.fromCharCode(10));
}
