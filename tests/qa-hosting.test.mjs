import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {access, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('../tools/qa-hosting.mjs', import.meta.url));
const projectId = 'shiftly-t-test';
const sender = '123456789';
const config = {
  projectId, authDomain: `${projectId}.firebaseapp.com`,
  appId: `1:${sender}:web:abcdef`, messagingSenderId: sender,
  apiKey: `AIza${'F'.repeat(35)}`
};
const siteKey = `6L${'A'.repeat(40)}`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'shiftly-qa-hosting-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const bin = join(root, 'bin');
  await mkdir(bin);
  const configPath = join(root, 'qa-web-sdk.json');
  const keyPath = join(root, 'qa-site-key.txt');
  const cliLog = join(root, 'cli.jsonl');
  await writeFile(configPath, JSON.stringify({result: {sdkConfig: {...config, ignoredField: 'PRIVATE-FIXTURE'}}}));
  await writeFile(keyPath, siteKey);
  const env = {...process.env, PATH: bin + delimiter + process.env.PATH, SHIFTLY_QA_CLI_LOG: cliLog};
  const cli = `#!${process.execPath}
const {appendFileSync} = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const command = path.basename(process.argv[1]);
appendFileSync(process.env.SHIFTLY_QA_CLI_LOG, JSON.stringify({command,args,cwd:process.cwd()}) + '\\n');
const exampleConfig = ${JSON.stringify(config)};
if (command === 'firebase' && args[0] === 'apps:sdkconfig') {
  console.log(JSON.stringify({result:{sdkConfig:exampleConfig}}));
} else if (command === 'firebase' && args[0] === 'hosting:sites:list') {
  const projectId = process.env.SHIFTLY_QA_MOCK_FOREIGN_SITE ? 'wrong-project' : exampleConfig.messagingSenderId;
  console.log(JSON.stringify({result:{sites:[{name:'projects/' + projectId + '/sites/shiftly-t-test'}]}}));
} else if (command === 'gcloud' && args[0] === 'firestore') {
  const id = process.env.SHIFTLY_QA_MOCK_DEFAULT_DB ? '(default)' : 'shiftly-qa-v1';
  console.log(JSON.stringify({name:'projects/shiftly-t-test/databases/' + id}));
} else if (command === 'gcloud' && args[0] === 'functions') {
  const qaNames = ['qaBookingAdminApi','qaBookingPublicApi','qaNormalAuthorityApi','qaSeasonalAuthorityApi','qaBookingStudentDeleted'];
  const names = process.env.SHIFTLY_QA_MOCK_PROD_NAMES
    ? ['bookingAdminApi','bookingPublicApi','normalAuthorityApi','seasonalAuthorityApi','bookingStudentDeleted']
    : qaNames.filter(name => !process.env.SHIFTLY_QA_MOCK_MISSING_TRIGGER || name !== 'qaBookingStudentDeleted');
  console.log(JSON.stringify(names.map(name => ({name:'projects/shiftly-t-test/locations/asia-northeast1/functions/' + name, state:'ACTIVE', environment:'GEN_2'}))));
} else if (command === 'firebase' && args[0] === 'hosting:channel:deploy') {
  console.log(JSON.stringify({result:{'shiftly-t-test':{url:'https://shiftly-t-test--fixture.web.app'}}}));
} else {
  process.exitCode = 2;
}
`;
  for (const name of ['firebase', 'gcloud']) await writeFile(join(bin, name), cli, {mode: 0o700});

  function run(operation, args = [], overrides = {}) {
    return spawnSync(process.execPath, [script, operation, '--config', configPath, ...args], {
      cwd: root, env: {...env, ...overrides}, encoding: 'utf8'
    });
  }
  const stageFlags = out => ['--site-key-file', keyPath, '--out', join(root, out)];
  const calls = async () => (await readFile(cliLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  return {root, configPath, cliLog, run, stageFlags, calls};
}

test('static QA staging uses an explicit allowlist, safe config, and inert HTML', async t => {
  const {root, cliLog, run, stageFlags} = await fixture(t);
  const result = run('stage', stageFlags('web'));
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(access(cliLog), {code: 'ENOENT'});
  assert.doesNotMatch(result.stdout, /AIza/);
  const stage = join(root, 'web');
  const files = await readdir(join(stage, 'public'));
  assert.equal(files.length, 22);
  assert.ok(files.includes('firebase-target.js'));
  assert.ok(!files.includes('tests') && !files.includes('firebase.json'));
  const generated = await readFile(join(stage, 'public/config.js'), 'utf8');
  assert.match(generated, /qaFirestoreDatabaseId = "shiftly-qa-v1"/);
  assert.doesNotMatch(generated, /PRIVATE-FIXTURE|shiftly-d02f6/);
  assert.match(await readFile(join(stage, 'public/booking-config.js'), 'utf8'), new RegExp(siteKey));
  const {hosting} = JSON.parse(await readFile(join(stage, 'firebase.json'), 'utf8'));
  assert.equal(hosting.site, 'shiftly-t-test');
  assert.equal(hosting.public, 'public');
  assert.deepEqual(hosting.rewrites, undefined);
  assert.equal(hosting.headers[0].source, '**');
  assert.match(hosting.headers[0].headers.find(header => header.key === 'Content-Security-Policy').value, /connect-src 'none'/);
  for (const name of ['index.html', 'course-booking-admin.html', 'course-booking.html']) {
    const html = await readFile(join(stage, 'public', name), 'utf8');
    assert.match(html, /data-shiftly-environment="qa"/);
    assert.match(html, /type="application\/shiftly-static-preview"/);
    assert.doesNotMatch(html, /type="module"/);
  }
});

test('explicit integration mode prepares working QA modules locally without Cloud CLI', async t => {
  const {root, cliLog, run, stageFlags} = await fixture(t);
  const result = run('stage', [...stageFlags('integration'), '--mode', 'integration']);
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(access(cliLog), {code: 'ENOENT'});
  const stage = join(root, 'integration');
  assert.match(await readFile(join(stage, 'public/index.html'), 'utf8'), /type="module"/);
  assert.doesNotMatch(await readFile(join(stage, 'firebase.json'), 'utf8'), /Content-Security-Policy/);
});

test('mismatched Web configuration is rejected before any stage or cloud command', async t => {
  const {root, configPath, cliLog, run, stageFlags} = await fixture(t);
  await writeFile(configPath, JSON.stringify({...config, projectId: 'shiftly-d02f6'}));
  const result = run('preview', stageFlags('hazard'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match the QA project/);
  await assert.rejects(access(cliLog), {code: 'ENOENT'});
  await assert.rejects(access(join(root, 'hazard')), {code: 'ENOENT'});
});

test('preview scopes all operations to QA and excludes Auth domain changes', async t => {
  const {root, run, stageFlags, calls} = await fixture(t);
  const result = run('preview', [...stageFlags('preview'), '--channel', 'shiftly-qa-test']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /5 ACTIVE functions in asia-northeast1/);
  assert.match(result.stdout, /NOT TESTED actual Functions Admin SDK database selection/);
  assert.match(result.stdout, /https:\/\/shiftly-t-test--fixture.web.app/);
  assert.doesNotMatch(result.stdout, /AIza/);
  const operations = await calls();
  assert.deepEqual(operations.map(row => row.args[0]), [
    'apps:sdkconfig', 'hosting:sites:list', 'firestore', 'functions', 'hosting:channel:deploy'
  ]);
  assert.ok(operations.every(({args}) => args.includes('shiftly-t-test') || args.includes('--project=shiftly-t-test')));
  assert.ok(operations.find(row => row.args[0] === 'firestore').args.includes('--database=shiftly-qa-v1'));
  const deploy = operations.at(-1);
  assert.equal(deploy.cwd, join(root, 'preview'));
  assert.ok(deploy.args.includes('--no-authorized-domains'));
  assert.ok(deploy.args.includes('--expires') && deploy.args.includes('1d'));
  assert.ok(deploy.args.includes(join(root, 'preview/firebase.json')));
});

test('foreign site, wrong database, and integration deployment cannot create a preview', async t => {
  const {run, stageFlags, calls} = await fixture(t);
  let result = run('preview', [...stageFlags('foreign')], {SHIFTLY_QA_MOCK_FOREIGN_SITE: '1'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /site is absent from the QA project/);
  result = run('preview', [...stageFlags('wrong-db')], {SHIFTLY_QA_MOCK_DEFAULT_DB: '1'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /database metadata does not match/);
  result = run('preview', [...stageFlags('integration'), '--mode', 'integration']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /static files only/);
  assert.ok((await calls()).every(row => row.args[0] !== 'hosting:channel:deploy'));
});

test('QA preflight rejects production function names even in the QA project', async t => {
  const {run, calls} = await fixture(t);
  const result = run('preflight', [], {SHIFTLY_QA_MOCK_PROD_NAMES: '1'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /QA functions missing or not ACTIVE/);
  for (const name of ['qaBookingAdminApi','qaBookingPublicApi','qaNormalAuthorityApi','qaSeasonalAuthorityApi','qaBookingStudentDeleted']) {
    assert.ok(result.stderr.includes(name));
  }
  assert.ok((await calls()).every(row => row.args[0] !== 'hosting:channel:deploy'));
});

test('QA preview is blocked when the student-deletion trigger is missing', async t => {
  const {root, run, stageFlags, calls} = await fixture(t);
  const result = run('preview', stageFlags('missing-trigger'), {SHIFTLY_QA_MOCK_MISSING_TRIGGER: '1'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing or not ACTIVE in asia-northeast1: qaBookingStudentDeleted\./);
  assert.ok((await calls()).every(row => row.args[0] !== 'hosting:channel:deploy'));
  await assert.rejects(access(join(root, 'missing-trigger')), {code: 'ENOENT'});
});
