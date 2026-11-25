export const lessonEnded = (date, end) =>
  Date.parse(`${date}T${end}:00+09:00`) <= Date.now();

export function askCorrectionReason(date) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog';
  dialog.setAttribute('aria-labelledby', 'ranking-correction-title');
  const title = document.createElement('h2');
  title.id = 'ranking-correction-title';
  title.textContent = `${date}の授業を事後訂正`;
  const form = document.createElement('form');
  form.method = 'dialog';
  const label = document.createElement('label');
  label.className = 'field';
  label.textContent = '訂正理由';
  const input = document.createElement('textarea');
  input.rows = 3;
  input.maxLength = 300;
  input.required = true;
  label.append(input);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'キャンセル';
  cancel.addEventListener('click', () => dialog.close());
  const save = document.createElement('button');
  save.className = 'primary';
  save.value = 'save';
  save.textContent = '訂正を保存する';
  input.addEventListener('input', () => input.setCustomValidity(''));
  form.addEventListener('submit', event => {
    if (input.value.trim()) return;
    event.preventDefault();
    input.setCustomValidity('訂正理由を入力してください。');
    input.reportValidity();
  });
  actions.append(cancel, save);
  form.append(label, actions);
  dialog.append(title, form);
  document.body.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const reason = dialog.returnValue === 'save' ? input.value.trim() : '';
      dialog.remove();
      resolve(reason || null);
    }, {once: true});
    dialog.showModal();
    input.focus();
  });
}
