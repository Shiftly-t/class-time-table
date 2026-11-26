const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const entries = ['index.html', 'course-booking.html', 'course-booking-admin.html'];
const scripts = fs.readdirSync(root).filter(name => name.endsWith('.js'));

// Match the tracked, root-only Hosting file selection in deploy-hosting.yml.
const hostingFiles = new Set(
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\0')
    .filter(name => /^[^/]+\.(html|js|css)$/.test(name))
);

function assertHosted(source, url) {
  if (/^(?:[a-z][a-z+.-]*:|\/\/|#)/i.test(url)) return;
  const target = url.split(/[?#]/, 1)[0].replace(/^\.?\//, '');
  assert.ok(hostingFiles.has(target), source + ': reference is outside the Hosting file set: ' + url);
}

assert.ok(scripts.length > 0, 'No application modules found');
for (const entry of entries) assert.ok(hostingFiles.has(entry), 'Missing Hosting entry: ' + entry);
for (const name of hostingFiles) {
  const file = fs.lstatSync(path.join(root, name));
  assert.ok(file.isFile() && file.size, 'Hosting requires a non-empty regular file: ' + name);
}

for (const name of scripts) {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, name + ': ' + (result.stderr || result.error || 'syntax check failed'));

  const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)['"](\.{1,2}\/[^'"]+)['"]/gm);
  for (const [, target] of imports) assertHosted(name, target);

  const pages = source.matchAll(/['"](\.\/[^'"\s]+?\.html(?:[?#][^'"\s]*)?)['"]/g);
  for (const [, target] of pages) assertHosted(name, target);
}

for (const name of hostingFiles) {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  if (name.endsWith('.html')) {
    const assets = source.matchAll(/<(?:script|link|iframe)\b[^>]*?\b(?:src|href)\s*=\s*(['"])(.*?)\1/gis);
    for (const [, , url] of assets) assertHosted(name, url);
  }
  if (name.endsWith('.css')) {
    const imports = source.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g);
    for (const [, url] of imports) assertHosted(name, url);
  }
}

console.log('PASS: ' + scripts.length + ' application modules, ' + hostingFiles.size + ' Hosting files');
