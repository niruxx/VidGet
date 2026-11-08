#!/usr/bin/env node
// Lightweight lint with no dependencies: syntax-checks every JavaScript file
// and flags a few mistakes that are easy to make in this codebase.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIRS = ['.', 'routes', 'utils', 'admin', 'public/js', 'public/js/i18n', 'test', 'test/support', 'scripts'];
const problems = [];
// Built from two parts so this line doesn't flag itself.
const DEBUGGER = new RegExp(String.raw`\b${'debug'}ger\b`);

const files = DIRS.flatMap((dir) => {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith('.js')).map((f) => path.join(full, f));
});

for (const file of files) {
  const rel = path.relative(ROOT, file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    problems.push(`${rel}: syntax error\n${String(err.stderr).trim()}`);
    continue;
  }
  const src = fs.readFileSync(file, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (/\bconsole\.log\(['"`]DEBUG/.test(line)) problems.push(`${at}: leftover debug log`);
    if (DEBUGGER.test(line)) problems.push(`${at}: breakpoint statement left in`);
    if (/[ \t]+$/.test(line)) problems.push(`${at}: trailing whitespace`);
  });
  // Server code must not read paths relative to the repo directly; use utils/paths.js.
  if (/^(routes|utils)[\\/]/.test(rel) && rel !== path.join('utils', 'paths.js') && /path\.join\(__dirname, '\.\.', '(tmp|Saves|data|logs)'/.test(src)) {
    problems.push(`${rel}: use utils/paths.js instead of hard-coded data paths`);
  }
}

for (const json of ['package.json', 'config.json']) {
  const file = path.join(ROOT, json);
  if (!fs.existsSync(file)) continue;
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    problems.push(`${json}: invalid JSON (${err.message})`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} found.`);
  process.exit(1);
}
console.log(`Checked ${files.length} files: no problems.`);
