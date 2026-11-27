import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveFirebaseTarget } from '../firebase-target.js';

const repository = fileURLToPath(new URL('..', import.meta.url));
const project = 'shiftly-t-test';
const database = 'shiftly-qa-v1';
const entryPages = ['index.html', 'course-booking.html', 'course-booking-admin.html'];
const productionMarker = 'data-shiftly-environment="production"';
const qaMarker = 'data-shiftly-environment="qa"';

function git(...args) {
  return execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function loadQaSettings(configPath, siteKeyPath) {
  const configSource = await readFile(configPath, 'utf8');
  let raw;
  try {
    raw = JSON.parse(configSource);
  } catch {
    throw Error('QA Web SDK 設定ファイルの JSON が無効です。');
  }
  const firebaseConfig = raw?.result?.sdkConfig ?? raw;
  const siteKey = (await readFile(siteKeyPath, 'utf8')).trim();
  if (
    !/^AIza[A-Za-z0-9_-]{35}$/.test(firebaseConfig?.apiKey ?? '') ||
    !/^[A-Za-z0-9_-]{20,128}$/.test(siteKey)
  ) {
    throw Error('QA Web SDK の設定と公開 App Check サイトキーを確認してください。');
  }

  // Copy only the public Firebase Web SDK keys to the hosting artifact.
  const webConfig = Object.fromEntries(
    ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId']
      .filter((key) => Object.hasOwn(firebaseConfig, key))
      .map((key) => [key, firebaseConfig[key]]),
  );
  if (Object.values(webConfig).some((value) => typeof value !== 'string')) {
    throw Error('QA Web SDK の設定値は文字列である必要があります。');
  }
  resolveFirebaseTarget('qa', { firebaseConfig: webConfig, qaFirestoreDatabaseId: database }, siteKey);
  return { webConfig, siteKey };
}

function readHostingAssets(commit) {
  const entries = git('ls-tree', '-z', commit).split('\0').filter(Boolean);
  const assets = new Map();
  for (const entry of entries) {
    const [metadata, name] = entry.split('\t');
    if (!/^[\w.-]+\.(?:html|css|js)$/.test(name)) continue;
    if (!/^100(?:644|755) blob /.test(metadata)) throw Error('配布対象が通常ファイルではありません。');
    assets.set(name, git('show', commit + ':' + name));
  }

  for (const name of [...entryPages, 'config.js', 'booking-config.js']) {
    if (!assets.get(name)) throw Error('配布元コミットに必要なファイルがありません: ' + name);
  }
  for (const name of entryPages) {
    const source = assets.get(name);
    if (source.split(productionMarker).length !== 2)
      throw Error('配布元の環境指定を確認してください: ' + name);
    assets.set(name, source.replace(productionMarker, qaMarker));
  }
  return assets;
}

async function stage({ ref = 'HEAD', config, 'site-key-file': siteKeyFile, out }) {
  const { webConfig, siteKey } = await loadQaSettings(config, siteKeyFile);
  const commit = git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}').trim();
  const assets = readHostingAssets(commit);
  assets.set(
    'config.js',
    `export const firebaseConfig = ${JSON.stringify(webConfig, null, 2)};
export const qaFirestoreDatabaseId = ${JSON.stringify(database)};
export const teacherWorkFeatureEnabled = true;
export const normalAuthorityApiEnabled = true;
`,
  );
  assets.set('booking-config.js', `export const bookingAppCheckSiteKey = ${JSON.stringify(siteKey)};\n`);

  const destination = resolve(out);
  const publicDir = join(destination, 'public');
  await mkdir(destination, { mode: 0o700 });
  await mkdir(publicDir);
  for (const [name, contents] of assets) await writeFile(join(publicDir, name), contents);
  const hosting = {
    site: project,
    public: 'public',
    ignore: [],
    headers: [{ source: '**', headers: [{ key: 'Cache-Control', value: 'no-store' }] }],
  };
  await writeFile(join(destination, 'firebase.json'), JSON.stringify({ hosting }, null, 2) + '\n');

  // Metadata stays outside the Hosting upload directory.
  const manifest = {
    commit,
    project,
    database,
    files: Object.fromEntries(
      Array.from(assets, ([name, content]) => [name, createHash('sha256').update(content).digest('hex')]),
    ),
  };
  await writeFile(join(destination, 'qa-build.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Staged ${assets.size} assets for ${project}/${database} from ${commit} in ${destination}`);
}

const { values } = parseArgs({
  options: {
    ref: { type: 'string' },
    config: { type: 'string' },
    'site-key-file': { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help || !values.config || !values['site-key-file'] || !values.out) {
  console.log(
    'Usage: node tools/stage-qa-hosting.mjs [--ref COMMIT] --config WEB_JSON --site-key-file FILE --out NEW_DIRECTORY',
  );
  process.exitCode = values.help ? 0 : 1;
} else {
  try {
    await stage(values);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
