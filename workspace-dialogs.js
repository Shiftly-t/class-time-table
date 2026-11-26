const guardedDialogIds = new Set([
  'closureDialog',
  'examDialog',
  'editorNewDialog',
  'courseDeadlineDialog',
  'courseDialog',
  'studentDialog',
  'lessonFormDialog',
]);

const ignoredControlTypes = new Set(['button', 'submit', 'reset', 'hidden']);

function draftFingerprint(dialog) {
  const controls = [...dialog.querySelectorAll('input, select, textarea')];
  return JSON.stringify(
    controls
      .filter((control) => !ignoredControlTypes.has(control.type))
      .map((control) => {
        let value = control.value;
        if (control.type === 'checkbox' || control.type === 'radio') value = control.checked;
        if (control.type === 'select-multiple')
          value = [...control.selectedOptions].map((option) => option.value);
        return [control.id || control.name || '', control.type, value];
      }),
  );
}

export function installWorkspaceDialogs(document, window) {
  const baselines = new WeakMap();

  function hasDraft(dialog) {
    return dialog.open && baselines.has(dialog) && baselines.get(dialog) !== draftFingerprint(dialog);
  }

  function canDismiss(dialog) {
    return !hasDraft(dialog) || window.confirm('未保存の入力内容があります。保存せず閉じますか？');
  }

  function showDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog.open) return;
    if (guardedDialogIds.has(id)) baselines.set(dialog, draftFingerprint(dialog));
    dialog.showModal();
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog.open) dialog.close();
  }

  function closeAllDialogs() {
    for (const dialog of document.querySelectorAll('dialog')) {
      if (dialog.open) dialog.close();
    }
  }

  function hasOpenDialogDraft() {
    return [...document.querySelectorAll('dialog[open]')].some(hasDraft);
  }

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.close);
      if (dialog?.open && canDismiss(dialog)) dialog.close();
    });
  }

  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && canDismiss(dialog)) dialog.close();
    });
    dialog.addEventListener('cancel', (event) => {
      if (!canDismiss(dialog)) event.preventDefault();
    });
    dialog.addEventListener('close', () => {
      // close イベントが届く前に再度開いた場合は、新しい初期値を保持する。
      if (!dialog.open) baselines.delete(dialog);
    });
  }

  function enableOneTapSave(formId) {
    const form = document.getElementById(formId);
    const save = form?.querySelector('button[type="submit"]');
    if (!save) return;

    function submitFromFocusedField(event) {
      // iPad Safariでは、キーボードを閉じる最初のタップで保存ボタンが反応しないことがある。
      if (event.type === 'pointerdown' && event.pointerType !== 'touch') return;
      const active = document.activeElement;
      if (
        event.isPrimary === false ||
        save.disabled ||
        !active ||
        !form.contains(active) ||
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) ||
        active.type === 'hidden'
      )
        return;
      if (event.cancelable) event.preventDefault();
      if (!form.reportValidity()) return;
      // 入力中の文字を確定してから、通常の submit ハンドラーを呼び出す。
      active.blur();
      form.requestSubmit(save);
    }

    const eventType = window.PointerEvent ? 'pointerdown' : 'touchstart';
    save.addEventListener(eventType, submitFromFocusedField, { passive: false });
  }

  return { showDialog, closeDialog, closeAllDialogs, hasOpenDialogDraft, enableOneTapSave };
}
