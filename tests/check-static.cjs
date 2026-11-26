const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const scripts = fs.readdirSync(root).filter(name => name.endsWith('.js'));

assert.ok(scripts.length > 0, 'No application modules found');

for (const name of scripts) {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, name + ': ' + (result.stderr || result.error || 'syntax check failed'));

  const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)['"]\.\/([^'"?]+)(?:\?[^'"]*)?['"]/gm);
  for (const [, target] of imports) {
    assert.ok(fs.existsSync(path.resolve(root, target)), name + ': missing module ' + target);
  }
}

console.log('PASS: ' + scripts.length + ' application modules');
