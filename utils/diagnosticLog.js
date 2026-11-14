const fs = require('fs');
const path = require('path');
const { LOGS_DIR } = require('./paths');

const DIAGNOSTIC_PATH = path.join(LOGS_DIR, 'diagnostics.json');
const MAX_ENTRIES = 100;
const MAX_AGE_MS = 7 * 86400000;
let pending = Promise.resolve();

function redact(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
      try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}${url.pathname}`;
      } catch { return '[redacted URL]'; }
    })
    .replace(/\b(cookie|set-cookie|authorization)\s*:[^\r\n]*/gi, '$1: [redacted]')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .slice(0, 4000);
}

async function readEntries() {
  try {
    const entries = JSON.parse(await fs.promises.readFile(DIAGNOSTIC_PATH, 'utf8'));
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry) => Date.parse(entry.timestamp) > Date.now() - MAX_AGE_MS).slice(-MAX_ENTRIES);
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return [];
    throw err;
  }
}

function serialize(action) {
  const result = pending.then(action);
  pending = result.catch(() => {});
  return result;
}

function logDiagnostic({ stage, url, error }) {
  return serialize(async () => {
    const entries = await readEntries();
    entries.push({ timestamp: new Date().toISOString(), stage, url: redact(url),
      message: redact(error?.stderr || error?.message || error) });
    await fs.promises.mkdir(LOGS_DIR, { recursive: true });
    await fs.promises.writeFile(DIAGNOSTIC_PATH, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  }).catch((err) => console.error('Could not save downloader diagnostic:', err.message));
}

function getDiagnostics() { return serialize(readEntries); }
function clearDiagnostics() {
  return serialize(() => fs.promises.rm(DIAGNOSTIC_PATH, { force: true }));
}

function pruneDiagnostics() {
  return serialize(async () => {
    const entries = await readEntries();
    if (!entries.length) return fs.promises.rm(DIAGNOSTIC_PATH, { force: true });
    await fs.promises.writeFile(DIAGNOSTIC_PATH, JSON.stringify(entries));
  });
}

module.exports = { logDiagnostic, getDiagnostics, clearDiagnostics, pruneDiagnostics, DIAGNOSTIC_PATH };
