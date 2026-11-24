import assert from 'node:assert/strict';
import test from 'node:test';
import {createBookingTransport} from '../production-hosting/booking-transport.js';
import {createSeasonalAuthorityClient,describeSeasonalOperationFailure} from '../production-hosting/seasonal-authority-client.js';

const enabled = {enabled: true, message: '', version: ''};
const disabled = {...enabled, enabled: false};
const genericPrecondition = '現在の状態ではこの操作を実行できません。授業・予約・勤務設定を確認してください。';
const activationError = 'Coordinated deployment has not been activated';

function remoteError(code, message) {
  return Object.assign(new Error(message), {code: `functions/${code}`});
}

function fixture(respond) {
  const requests = [];
  const options = {
    getSession: () => 'fixture-session',
    newRequestId: () => `fixture-${requests.length + 1}`,
    async call(fields) {
      requests.push(fields);
      return {data: await respond(fields)};
    },
  };
  return {
    requests,
    client: createSeasonalAuthorityClient({...options, enabled: true}),
    booking: createBookingTransport(options),
  };
}

function maintenanceFixture(current, error) {
  return fixture(({action}) => {
    if (action === 'capabilities') return {protocolVersion: 3, operations: ['setMaintenance']};
    if (action === 'inspectControl') return {protocolVersion: 3, maintenance: {token: 'fixture-token', value: current}};
    assert.equal(action, 'setMaintenance');
    if (error) throw error;
    return {protocolVersion: 3, version: 2, changed: 1};
  });
}

test('maintenance stops before sending a change when the displayed state is stale', async () => {
  const {client, requests} = maintenanceFixture(enabled);
  await assert.rejects(client.setMaintenance({before: disabled, value: enabled}), /停止設定が変更されました/);
  assert.deepEqual(requests.map(({action}) => action), ['capabilities', 'inspectControl']);
});

test('maintenance passes the inspection token and distinguishes rejection categories', async () => {
  for (const [code, message, display] of [
    ['failed-precondition', 'Unclassified fixture condition', genericPrecondition],
    ['failed-precondition', 'Writer migration fixture condition', '全書き込み経路の移行と権限制御が未確認のため、業務を再開できません。'],
    ['permission-denied', 'Fixture role refused', 'この操作の権限を確認できません。保存を停止しました。'],
  ]) {
    const {client, requests} = maintenanceFixture(enabled, remoteError(code, message));
    await assert.rejects(client.setMaintenance({before: enabled, value: disabled}), error => {
      assert.equal(error.userMessage, display);
      assert.equal(describeSeasonalOperationFailure(error, ''), `停止設定の確定で停止しました。${display}（${code}）`);
      return true;
    });
    assert.deepEqual(requests.map(({action}) => action), ['capabilities', 'inspectControl', 'setMaintenance']);
    assert.equal(requests.at(-1).expected, 'fixture-token');
    assert.equal(client.hasPending(), false);
  }
});

test('maintenance handles an absent document explicitly and never writes without a precondition field', async () => {
  for (const maintenance of [{value: disabled}, {token: null, value: disabled}, {token: 0, value: disabled}, {token: '', value: disabled}]) {
    const {client, requests} = fixture(({action}) => {
      if (action === 'capabilities') return {protocolVersion: 3, operations: ['setMaintenance']};
      assert.equal(action, 'inspectControl');
      return {protocolVersion: 3, maintenance};
    });
    await assert.rejects(client.setMaintenance({before: disabled, value: enabled}), {operation: 'inspectControl'});
    assert.deepEqual(requests.map(({action}) => action), ['capabilities', 'inspectControl']);
  }
  const {client, requests} = fixture(({action}) => {
    if (action === 'capabilities') return {protocolVersion: 3, operations: ['setMaintenance']};
    if (action === 'inspectControl') return {protocolVersion: 3, maintenance: {token: null, value: null}};
    return {protocolVersion: 3, version: 2, changed: 1};
  });
  await client.setMaintenance({before: disabled, value: enabled});
  assert.equal(requests.at(-1).expected, null);
});

test('backup list distinguishes a missing capability, permission failure and incompatible response', async () => {
  const cases = [
    {operations: [], list: null, expected: /対応を報告していません/, calls: ['capabilities']},
    {operations: ['listSnapshots'], list: remoteError('permission-denied', 'Fixture role refused'), expected: /Fixture role refused/, calls: ['capabilities', 'listSnapshots']},
    {operations: ['listSnapshots'], list: {protocolVersion: 2, archives: [], nextCursor: null}, expected: /講習APIの応答形式/, calls: ['capabilities', 'listSnapshots']},
    {operations: ['listSnapshots'], list: {protocolVersion: 3, archives: [{id: 'fixture-archive'}], nextCursor: 'different'}, expected: /バックアップ一覧の応答形式/, calls: ['capabilities', 'listSnapshots']},
    {operations: ['listSnapshots'], list: {protocolVersion: 3, archives: [{label: '欠落'}], nextCursor: null}, expected: /バックアップ一覧の応答形式/, calls: ['capabilities', 'listSnapshots']},
  ];
  for (const {operations, list, expected, calls} of cases) {
    const {client, requests} = fixture(({action}) => {
      if (action === 'capabilities') return {protocolVersion: 3, operations};
      assert.equal(action, 'listSnapshots');
      if (list instanceof Error) throw list;
      return list;
    });
    await assert.rejects(client.listSnapshots(), expected);
    assert.deepEqual(requests.map(({action}) => action), calls);
  }
});

test('activation refusal and authorization failure at capability discovery stay distinct', async () => {
  for (const [code, message, expected] of [
    ['failed-precondition', activationError, /連携機能は有効化されていません/],
    ['unauthenticated', 'Verified App Check required', /App Check/],
    ['permission-denied', 'internal fixture detail', /操作の権限/],
  ]) {
    const {client, requests} = fixture(() => { throw remoteError(code, message); });
    await assert.rejects(client.listSnapshots(), error => {
      const diagnostic = describeSeasonalOperationFailure(error, '不明');
      assert.match(diagnostic, /^対応機能の確認で停止/);
      assert.match(diagnostic, expected);
      assert.doesNotMatch(diagnostic, /internal fixture detail/);
      return true;
    });
    assert.deepEqual(requests.map(({action}) => action), ['capabilities']);
  }
});

test('a malformed snapshot creation acknowledgement keeps the first result pending and prevents resend', async () => {
  const {client, requests} = fixture(({action}) => {
    if (action === 'capabilities') return {protocolVersion: 3, operations: ['createSnapshot']};
    assert.equal(action, 'createSnapshot');
    return {protocolVersion: 3, version: 2, changed: 1};
  });
  await assert.rejects(client.createSnapshot(), {operation: 'createSnapshot', userMessage: /作成結果を確認できません/});
  assert.equal(client.hasPending(), true);
  assert.equal(client.commits(), 0);
  await assert.rejects(client.createSnapshot(), {code: 'booking/result-unconfirmed'});
  assert.equal(requests.filter(({action}) => action === 'createSnapshot').length, 1);
});

test('backup list success leaves restore blocked when the plan lacks the QR renewal requirement', async () => {
  const {client, requests} = fixture(({action}) => {
    if (action === 'capabilities') return {protocolVersion: 3, operations: ['listSnapshots']};
    if (action === 'listSnapshots') return {protocolVersion: 3, archives: [{id: 'fixture-archive'}], nextCursor: null};
    assert.equal(action, 'planBatchedRestore');
    return {protocolVersion: 3, canApply: true, revision: 5, operationCount: 2, requiresQrReissue: false};
  });
  assert.equal((await client.listSnapshots()).archives[0].id, 'fixture-archive');
  await assert.rejects(client.planBatchedRestore('fixture-archive'), /分割復元計画を確認できません/);
  await assert.rejects(client.startBatchedRestore('fixture-archive', {canApply: true, revision: 5, requiresQrReissue: false}), /復元計画の再確認が必要/);
  assert.deepEqual(requests.map(({action}) => action), ['capabilities', 'listSnapshots', 'planBatchedRestore']);
});

test('booking preserves the callable activation refusal on the initial read', async () => {
  const {booking, requests} = fixture(() => {throw remoteError('failed-precondition', activationError);});
  await assert.rejects(booking.call({action: 'courses'}), {code: 'functions/failed-precondition', message: activationError});
  assert.deepEqual(requests.map(({action}) => action), ['courses']);
  assert.equal(booking.hasPending(), false);
});
