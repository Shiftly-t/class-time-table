import {spawnSync} from 'node:child_process';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {qaFunctionNames} from '../production-hosting/firebase-target.js';

const project = 'shiftly-t-test';
const database = 'shiftly-qa-v1';
const region = 'asia-northeast1';
const site = project;
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../production-hosting');
const pages = ['index.html', 'course-booking-admin.html', 'course-booking.html'];
const assets = [
  'app.js', 'authority-commands.js', 'booking-transport.js', 'booking.css',
  'course-booking-admin.js', 'course-booking.js', 'course-structure.js', 'firebase-target.js',
  'normal-authority-client.js', 'normal-editor.css', 'normal-editor.js',
  'seasonal-authority-client.js', 'student-enrollment.js', 'student-grade.js', 'style.css',
  'teacher-work.css', 'teacher-work.js'
];
const authDomain = `${project}.firebaseapp.com`;
const cliFlags = ['--project', project, '--non-interactive', '--json'];

const usage = `Usage
  node tools/qa-hosting.mjs stage --config FILE --site-key-file FILE --out DIRECTORY [--mode integration]
  node tools/qa-hosting.mjs preflight --config FILE
  node tools/qa-hosting.mjs preview --config FILE --site-key-file FILE --out DIRECTORY [--channel ID]

stage defaults to static mode. The integration mode stages files locally.
preview runs Cloud preflight and deploys a 1-day static Hosting preview only.
`;

function readWebConfig(raw) {
  const candidate = raw?.result?.sdkConfig ?? raw;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw Error('Expected a Firebase Web SDK configuration object.');
  }
  const {projectId, authDomain: actualAuthDomain, apiKey, appId, messagingSenderId} = candidate;
  const appIdMatch = typeof appId === 'string' && /^1:([0-9]+):web:[a-f0-9]+$/i.exec(appId);
  if (projectId !== project || actualAuthDomain !== authDomain || !appIdMatch ||
      appIdMatch[1] !== messagingSenderId || typeof apiKey !== 'string' || !/^AIza[A-Za-z0-9_-]{35}$/.test(apiKey)) {
    throw Error('The Web SDK configuration does not match the QA project or has missing fields.');
  }
  return {projectId, authDomain: actualAuthDomain, apiKey, appId, messagingSenderId};
}

function commandJson(command, args, description, cwd) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024
  });
  if (result.error?.code === 'ENOENT') throw Error(`${command} is unavailable in this shell.`);
  if (result.error || result.status !== 0) {
    throw Error(`${description} failed. Check the signed-in account and QA permissions in Cloud Shell.`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw Error(`${description} did not return JSON.`);
  }
}

function preflight(config) {
  const matchesResource = (name, suffix) => [project, config.messagingSenderId].some(id => name === `projects/${id}/${suffix}`);
  const sdk = commandJson('firebase', ['apps:sdkconfig', 'WEB', config.appId, ...cliFlags], 'QA Web SDK config lookup');
  const registered = readWebConfig(sdk);
  if (JSON.stringify(registered) !== JSON.stringify(config)) {
    throw Error('The supplied Web config differs from the QA Web app registered in Firebase.');
  }

  const sites = commandJson('firebase', ['hosting:sites:list', ...cliFlags], 'QA Hosting site lookup');
  if (!Array.isArray(sites.result?.sites) || !sites.result.sites.some(item => matchesResource(item.name, `sites/${site}`))) {
    throw Error('The expected Hosting site is absent from the QA project.');
  }

  const firestore = commandJson('gcloud', [
    'firestore', 'databases', 'describe', `--project=${project}`, `--database=${database}`, '--format=json'
  ], 'QA named Firestore lookup');
  if (!matchesResource(firestore.name, `databases/${database}`)) {
    throw Error('Firestore database metadata does not match the QA target.');
  }

  const functions = commandJson('gcloud', [
    'functions', 'list', `--project=${project}`, `--regions=${region}`, '--v2', '--format=json'
  ], 'QA Functions inventory');
  if (!Array.isArray(functions)) throw Error('QA Functions inventory is unavailable.');
  const missing = qaFunctionNames.filter(name => !functions.some(fn => {
    const matches = matchesResource(fn.name, `locations/${region}/functions/${name}`);
    return matches && (fn.state ?? fn.status) === 'ACTIVE';
  }));
  if (missing.length) throw Error(`QA functions missing or not ACTIVE in ${region}: ${missing.join(', ')}.`);

  console.log(`PASS Web app, site ${site}, client Firestore ${database}, and ${qaFunctionNames.length} ACTIVE functions in ${region}.`);
  console.log('NOT TESTED actual Functions Admin SDK database selection, Firestore Rules, and App Check binding.');
}

function stagePage(html, mode) {
  const marker = 'data-shiftly-environment="production"';
  if (html.split(marker).length !== 2) throw Error('Expected exactly one production environment marker in each source page.');
  const qaHtml = html.replace(marker, 'data-shiftly-environment="qa"');
  if (mode === 'integration') return qaHtml;
  const staticHtml = qaHtml.replace(/<script(\s+type="module")/g, '<script type="application/shiftly-static-preview"');
  return staticHtml.replace(/<body(\s[^>]*)?>/i, '$&<p role="status" style="margin:0;padding:.65rem 1rem;background:#203250;color:#fff;text-align:center">Shiftly-T QA プレビュー（画面表示のみ）</p>');
}

async function stage(config, keyPath, destination, mode) {
  const siteKey = (await readFile(keyPath, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(siteKey) || siteKey.startsWith('REPLACE_')) {
    throw Error('Expected the public QA reCAPTCHA Enterprise site key in the key file.');
  }

  const target = resolve(destination);
  await mkdir(target, {mode: 0o700});
  const publicDirectory = join(target, 'public');
  await mkdir(publicDirectory);
  await Promise.all(assets.map(asset => copyFile(join(source, asset), join(publicDirectory, asset))));
  await Promise.all(pages.map(async page => {
    const html = await readFile(join(source, page), 'utf8');
    await writeFile(join(publicDirectory, page), stagePage(html, mode));
  }));

  const generated = [
    ['config.js', `export const firebaseConfig = ${JSON.stringify(config, null, 2)};
export const qaFirestoreDatabaseId = ${JSON.stringify(database)};
export const teacherWorkFeatureEnabled = true;
export const normalAuthorityApiEnabled = true;
`],
    ['booking-config.js', `export const bookingAppCheckSiteKey = ${JSON.stringify(siteKey)};\n`]
  ];
  for (const [file, contents] of generated) await writeFile(join(publicDirectory, file), contents);

  const hosting = {
    site, public: 'public',
    ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
    headers: [{
      source: '**',
      headers: [
        {key: 'Cache-Control', value: 'no-store'},
        ...(mode === 'static' ? [{
          key: 'Content-Security-Policy',
          value: "script-src 'none'; connect-src 'none'; form-action 'none'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'self'"
        }] : [])
      ]
    }]
  };
  await writeFile(join(target, 'firebase.json'), JSON.stringify({hosting}, null, 2) + '\n');
  console.log(`Staged ${mode} QA Hosting files in ${target}`);
  return target;
}

function preview(target, channel) {
  const response = commandJson('firebase', [
    'hosting:channel:deploy', channel, '--expires', '1d', '--no-authorized-domains',
    '--config', join(target, 'firebase.json'), ...cliFlags
  ], 'Static QA Hosting preview deployment', target);
  const url = response.result?.[site]?.url;
  if (typeof url !== 'string' || !url.startsWith(`https://${site}--`) || !url.endsWith('.web.app')) {
    throw Error('Preview deployment returned no matching QA URL. Check the Hosting channels in the QA console.');
  }
  console.log(`Static QA preview (expires in 1 day): ${url}`);
}

async function main() {
  const [operation, ...args] = process.argv.slice(2);
  if (!operation || operation === '--help') {
    console.log(usage);
    return;
  }
  const {values} = parseArgs({args, options: {
    config: {type: 'string'}, 'site-key-file': {type: 'string'}, out: {type: 'string'},
    mode: {type: 'string'}, channel: {type: 'string'}
  }});
  if (!['stage', 'preflight', 'preview'].includes(operation) || !values.config) throw Error(usage);
  const config = readWebConfig(JSON.parse(await readFile(values.config, 'utf8')));
  if (operation === 'preflight') {
    if (values.mode || values.channel || values.out || values['site-key-file']) throw Error(usage);
    preflight(config);
    return;
  }
  if (!values.out || !values['site-key-file']) throw Error(usage);
  if (operation === 'stage') {
    const mode = values.mode ?? 'static';
    if (values.channel || !['static', 'integration'].includes(mode)) throw Error(usage);
    await stage(config, values['site-key-file'], values.out, mode);
  } else {
    if (values.mode) throw Error('The preview command deploys static files only.');
    const channel = values.channel ?? `shiftly-qa-${Date.now().toString(36)}`;
    if (!/^shiftly-qa-[a-z0-9-]{1,25}$/.test(channel)) throw Error('Preview channel IDs must start with shiftly-qa-.');
    preflight(config);
    const target = await stage(config, values['site-key-file'], values.out, 'static');
    preview(target, channel);
  }
}

main().catch(error => {
  // Local files may contain configuration values, so JSON parser details stay local to the input.
  console.error(error instanceof SyntaxError ? 'The Web config file is not valid JSON.' : error.message);
  process.exitCode = 1;
});
