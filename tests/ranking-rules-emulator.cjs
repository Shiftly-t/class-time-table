// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 node tests/ranking-rules-emulator.cjs /path/to/firestore.rules
// Use a dedicated local emulator. The test installs the supplied rules on its named database.
'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');

const host = process.env.FIRESTORE_EMULATOR_HOST;
const rulesFile = process.argv[2];
assert.match(host || '', /^127\.0\.0\.1:\d{2,5}$/, 'A loopback Firestore emulator is required');
assert(rulesFile, 'Pass the QA Firestore rules file');

const project = 'shiftly-t-test';
const database = 'shiftly-qa-v1';
const databasePath = `projects/${project}/databases/${database}`;
const documentPath = `/v1/${databasePath}/documents`;
const rulesPath = `/emulator/v1/${databasePath}:securityRules`;
const testId = `rankingRules_${randomUUID()}`;
const internalCollections = [
  'rankingInternalConfig', 'rankingInternalSnapshots', 'rankingInternalDays',
  'rankingInternalOperations', 'rankingInternalAudit', 'rankingInternalRefresh',
  'rankingInternalAchievementCatalog', 'rankingInternalAchievements',
  'rankingInternalAchievementHistory', 'rankingInternalAchievementOutbox'
];

const identities = [
  { label: 'anonymous' },
  { label: 'unregistered', uid: `${testId}_unregistered` },
  ...['owner', 'admin', 'employee'].map(role => ({ label: role, uid: `${testId}_${role}`, role }))
];

function emulatorToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [encode({ alg: 'none', typ: 'JWT' }), encode({
    sub: uid, user_id: uid, aud: project, iss: `https://securetoken.google.com/${project}`,
    iat: now, exp: now + 3600, firebase: { sign_in_provider: 'custom' }
  }), ''].join('.');
}

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`http://${host}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000), redirect: 'error'
  });
  return { status: response.status, data: await response.json() };
}

async function adminWrite(path, method, fields) {
  const result = await request(`${documentPath}/${path}`, {
    method, token: 'owner', body: fields && { fields }
  });
  assert.equal(result.status, 200, `${method} emulator fixture ${path}`);
}

async function main() {
  const content = await readFile(rulesFile, 'utf8');
  const installed = await request(rulesPath, {
    method: 'PUT', body: { rules: { files: [{ name: 'qa.firestore.rules', content }] } }
  });
  assert.equal(installed.status, 200, 'Could not load named database rules');
  assert(!(installed.data.issues || []).some(issue => issue.severity === 'ERROR'), 'QA rules did not compile');

  const fixtures = [];
  const field = { fixture: { booleanValue: true } };
  try {
    for (const identity of identities.filter(value => value.role)) {
      const path = `users/${identity.uid}`;
      fixtures.push(path);
      await adminWrite(path, 'PATCH', { role: { stringValue: identity.role } });
      const profile = await request(`${documentPath}/${path}`, { token: emulatorToken(identity.uid) });
      assert.equal(profile.status, 200, `${identity.role} emulator token accepted`);
      assert.equal(profile.data.fields?.role?.stringValue, identity.role);
    }

    let denials = 0;
    for (const collection of internalCollections) {
      const existing = `${collection}/${testId}`;
      const missingId = `${testId}_new`;
      fixtures.push(existing, `${collection}/${missingId}`);
      await adminWrite(existing, 'PATCH', field);

      for (const { label, uid } of identities) {
        const token = uid ? emulatorToken(uid) : undefined;
        const operations = [
          ['get', `${documentPath}/${existing}`, { token }],
          ['list', `${documentPath}/${collection}?pageSize=1`, { token }],
          ['create', `${documentPath}/${collection}?documentId=${missingId}`, { method: 'POST', token, body: { fields: field } }],
          ['update', `${documentPath}/${existing}?currentDocument.exists=true`, { method: 'PATCH', token, body: { fields: field } }],
          ['delete', `${documentPath}/${existing}`, { method: 'DELETE', token }]
        ];
        for (const [operation, path, options] of operations) {
          const { status, data } = await request(path, options);
          assert.equal(status, 403, `${label} ${operation} ${collection}`);
          assert.equal(data.error?.status, 'PERMISSION_DENIED', `${label} ${operation} ${collection}`);
          denials++;
        }
      }
    }
    console.log(`SUCCESS RANKING EMULATOR RULES (${denials} client denials on ${database})`);

    const recipient = identities.find(value => value.role === 'employee');
    const inbox = `notifications/${recipient.uid}/items`;
    const notice = `${inbox}/${testId}`;
    const noticeFields = {
      kind: { stringValue: 'rankingAchievement' }, target: { stringValue: 'badges' },
      message: { stringValue: 'バッジ「QAテスト」を獲得しました。' },
      read: { booleanValue: false }, createdAt: { timestampValue: new Date().toISOString() }
    };
    fixtures.push(notice, `${inbox}/${testId}_forged`);
    await adminWrite(notice, 'PATCH', noticeFields);
    for (const { label, uid } of identities) {
      const token = uid ? emulatorToken(uid) : undefined;
      const visible = await request(`${documentPath}/${notice}`, { token });
      assert.equal(visible.status, uid === recipient.uid ? 200 : 403, `${label} ranking notice visibility`);
      const spoof = await request(`${documentPath}/${inbox}?documentId=${testId}_forged`, {
        token, method: 'POST', body: { fields: noticeFields }
      });
      assert.equal(spoof.status, 403, `${label} cannot create ranking notices`);
    }
    const readNotice = await request(`${documentPath}/${notice}?updateMask.fieldPaths=read`, {
      token: emulatorToken(recipient.uid), method: 'PATCH', body: { fields: { read: { booleanValue: true } } }
    });
    assert.equal(readNotice.status, 200, 'Recipient marked the ranking notice read');
    assert.equal(readNotice.data.fields?.read?.booleanValue, true);
    console.log('SUCCESS RANKING EMULATOR NOTIFICATION RULES');
  } finally {
    for (const path of fixtures) await adminWrite(path, 'DELETE');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
