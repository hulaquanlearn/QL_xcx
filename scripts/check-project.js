// Read-only release preflight. No database connection or credentials required.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'server/package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'server/package-lock.json'), 'utf8'));
assert.equal(pkg.version, lock.version, 'package-lock version differs');
assert.equal(pkg.version, lock.packages[''].version, 'lock root version differs');
assert.deepEqual(pkg.dependencies, lock.packages[''].dependencies, 'dependency lock differs');
const deployName = `OPENCLAW_DEPLOY_V${pkg.version}.md`;
assert.ok(fs.existsSync(path.join(root, deployName)), 'current deployment guide is missing');
assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8').split('\n')[0], new RegExp(pkg.version.replaceAll('.', '\\.')));

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', 'release', 'data', '.codex'].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filename);
    else if (entry.name.endsWith('.js')) files.push(filename);
    else if (entry.name.endsWith('.json')) JSON.parse(fs.readFileSync(filename, 'utf8'));
  }
}
walk(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${path.relative(root, file)}\n${result.stderr}`);
}
const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
for (const page of app.pages) for (const suffix of ['js', 'json', 'wxml', 'wxss']) {
  assert.ok(fs.existsSync(path.join(root, 'miniprogram', `${page}.${suffix}`)), `missing page ${page}.${suffix}`);
}
console.log(`Preflight OK: version ${pkg.version}, ${files.length} JavaScript files, JSON and page files verified.`);
