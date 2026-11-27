const assert = require('node:assert/strict');
const { before, mock, test } = require('node:test');

let installWorkspaceDialogs;
before(async () => {
  ({ installWorkspaceDialogs } = await import('../workspace-dialogs.js'));
});

class Dialog extends EventTarget {
  open = false;
  controls = [];

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  querySelectorAll() {
    return this.controls;
  }
}

function fire(target, type, details = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), details);
  target.dispatchEvent(event);
  return event;
}

function mount({ pointerEvents = true } = {}) {
  const student = new Dialog();
  const detail = new Dialog();
  const close = Object.assign(new EventTarget(), { dataset: { close: 'studentDialog' } });
  const elements = { studentDialog: student, detailDialog: detail };
  const dialogs = [student, detail];
  const document = {
    getElementById: id => elements[id] ?? null,
    querySelectorAll: selector => {
      if (selector === '[data-close]') return [close];
      return selector === 'dialog[open]' ? dialogs.filter(dialog => dialog.open) : dialogs;
    },
  };
  const confirm = mock.fn(() => false);
  const controller = installWorkspaceDialogs(document, { confirm, PointerEvent: pointerEvents });
  return { student, detail, close, elements, document, confirm, controller };
}

test('registered dialogs guard button, backdrop and Escape dismissal when a draft changes', () => {
  const { student, close, confirm, controller } = mount();
  const name = { id: 'name', type: 'text', value: '' };
  const hidden = { id: 'recordId', type: 'hidden', value: '' };
  student.controls = [name, hidden];
  controller.showDialog('studentDialog');

  hidden.value = 'existing';
  assert.equal(controller.hasOpenDialogDraft(), false);
  name.value = '下書き';
  controller.showDialog('studentDialog');
  assert.equal(controller.hasOpenDialogDraft(), true);

  fire(close, 'click');
  assert.equal(student.open, true);
  fire(student, 'click');
  assert.equal(student.open, true);
  assert.equal(fire(student, 'cancel').defaultPrevented, true);
  assert.equal(confirm.mock.callCount(), 3);

  confirm.mock.mockImplementation(() => true);
  fire(close, 'click');
  assert.equal(student.open, false);
  assert.equal(controller.hasOpenDialogDraft(), false);
});

test('forced closure skips confirmation and a delayed close event preserves a reopened dialog baseline', () => {
  const { student, detail, confirm, controller } = mount();
  const checkbox = { id: 'enabled', type: 'checkbox', checked: false };
  const subjects = { id: 'subjects', type: 'select-multiple', selectedOptions: [{ value: '国語' }] };
  student.controls = [checkbox, subjects];
  detail.controls = [{ type: 'textarea', value: '' }];
  controller.showDialog('studentDialog');
  controller.showDialog('detailDialog');

  detail.controls[0].value = '対象外';
  assert.equal(controller.hasOpenDialogDraft(), false);
  checkbox.checked = true;
  assert.equal(controller.hasOpenDialogDraft(), true);
  controller.closeAllDialogs();
  assert.equal(student.open, false);
  assert.equal(detail.open, false);
  assert.equal(confirm.mock.callCount(), 0);

  controller.showDialog('studentDialog');
  fire(student, 'close');
  assert.equal(controller.hasOpenDialogDraft(), false);
  subjects.selectedOptions = [{ value: '国語' }, { value: '数学' }];
  assert.equal(controller.hasOpenDialogDraft(), true);
  controller.closeDialog('studentDialog');
  assert.equal(student.open, false);
  assert.equal(confirm.mock.callCount(), 0);
});

test('an operation is scoped to the dialog opening that started it', () => {
  const { student, controller } = mount();
  const beforeOpening = controller.captureOpening('studentDialog');
  controller.showDialog('studentDialog');
  const first = controller.captureOpening('studentDialog');
  assert.equal(beforeOpening(), false);
  assert.equal(first(), true);

  controller.closeDialog('studentDialog');
  assert.equal(first(), false);
  controller.showDialog('studentDialog');
  const reopened = controller.captureOpening('studentDialog');
  fire(student, 'close');
  assert.equal(first(), false);
  assert.equal(reopened(), true);

  controller.closeAllDialogs();
  assert.equal(reopened(), false);
});

for (const pointerEvents of [true, false]) {
  const eventType = pointerEvents ? 'pointerdown' : 'touchstart';
  test(`${eventType} saves a focused form through native validation and submission`, () => {
    const { document, elements, controller } = mount({ pointerEvents });
    const save = new EventTarget();
    const calls = [];
    const input = { type: 'text', tagName: 'INPUT', blur: () => calls.push('blur') };
    const form = {
      querySelector: () => save,
      contains: element => element === input,
      reportValidity: () => {
        calls.push('validate');
        return calls.includes('valid');
      },
      requestSubmit: submitter => {
        assert.equal(submitter, save);
        calls.push('submit');
      },
    };
    elements.studentForm = form;
    document.activeElement = input;
    controller.enableOneTapSave('studentForm');

    fire(save, 'pointerdown', { pointerType: 'mouse' });
    fire(save, eventType, { pointerType: 'touch', isPrimary: false });
    assert.deepEqual(calls, []);

    assert.equal(fire(save, eventType, { pointerType: 'touch' }).defaultPrevented, true);
    assert.deepEqual(calls, ['validate']);
    calls.push('valid');
    fire(save, eventType, { pointerType: 'touch' });
    assert.deepEqual(calls, ['validate', 'valid', 'validate', 'blur', 'submit']);

    save.disabled = true;
    assert.equal(fire(save, eventType, { pointerType: 'touch' }).defaultPrevented, false);
    assert.deepEqual(calls, ['validate', 'valid', 'validate', 'blur', 'submit']);
  });
}
