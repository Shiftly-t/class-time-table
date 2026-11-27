const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const baseline = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const web = {
  apiKey: 'AIza' + 'A'.repeat(35),
  appId: '1:123456:web:012345abcdef',
  authDomain: 'shiftly-t-test.firebaseapp.com',
  messagingSenderId: '123456',
  projectId: 'shiftly-t-test',
};

function stagingFixture(t, config = web) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftly-qa-stage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const out = path.join(directory, 'build');
  const configPath = path.join(directory, 'sdk.json');
  const keyPath = path.join(directory, 'app-check-key');
  fs.writeFileSync(configPath, JSON.stringify({ result: { sdkConfig: config } }));
  fs.writeFileSync(keyPath, 'dummyQaAppCheckSiteKey123456');
  const run = () =>
    spawnSync(
      process.execPath,
      [
        path.join(root, 'tools/stage-qa-hosting.mjs'),
        '--ref',
        baseline,
        '--config',
        configPath,
        '--site-key-file',
        keyPath,
        '--out',
        out,
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  return { out, run };
}

test('QA staging copies the selected commit and replaces only the environment boundary', async (t) => {
  const { out, run } = stagingFixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'qa-build.json'), 'utf8'));
  const hosting = JSON.parse(fs.readFileSync(path.join(out, 'firebase.json'), 'utf8'));
  assert.deepEqual(
    [manifest.commit, manifest.project, manifest.database, hosting.hosting.site],
    [baseline, 'shiftly-t-test', 'shiftly-qa-v1', 'shiftly-t-test'],
  );
  const publicDir = path.join(out, 'public');
  const files = fs.readdirSync(publicDir).sort();
  const trackedAssets = execFileSync('git', ['ls-tree', '--name-only', baseline], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .trim()
    .split('\n')
    .filter((name) => /^[^/]+\.(html|css|js)$/.test(name))
    .sort();
  assert.deepEqual(files, trackedAssets);
  assert.deepEqual(Object.keys(manifest.files).sort(), trackedAssets);

  for (const name of files.filter((file) => file.endsWith('.html'))) {
    assert.match(fs.readFileSync(path.join(publicDir, name), 'utf8'), /data-shiftly-environment="qa"/);
  }
  const config = await import(pathToFileURL(path.join(publicDir, 'config.js')).href);
  assert.deepEqual(config.firebaseConfig, web);
  assert.equal(config.qaFirestoreDatabaseId, 'shiftly-qa-v1');
  const source = execFileSync('git', ['show', baseline + ':app.js'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.deepEqual(fs.readFileSync(path.join(publicDir, 'app.js')), source);
  assert.notEqual(run().status, 0, 'Existing output directories cannot be overwritten');
});

test('a non-QA Firebase configuration is rejected before output is generated', (t) => {
  const { out, run } = stagingFixture(t, { ...web, projectId: 'shiftly-d02f6' });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(out), false);
});
