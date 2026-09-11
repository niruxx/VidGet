const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DEFAULT_CONFIG = {
  port: 3000,
  logRetentionDays: 0,
  savesRetentionDays: '*',
};

if (!fs.existsSync(CONFIG_PATH)) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
}

function normalizeRetention(value, fallback) {
  if (value === '*') return '*';
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function normalizePort(value, fallback) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 && num < 65536 ? num : fallback;
}

function getConfig() {
  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    parsed = {};
  }
  return {
    port: normalizePort(parsed.port, DEFAULT_CONFIG.port),
    logRetentionDays: normalizeRetention(parsed.logRetentionDays, DEFAULT_CONFIG.logRetentionDays),
    savesRetentionDays: normalizeRetention(parsed.savesRetentionDays, DEFAULT_CONFIG.savesRetentionDays),
  };
}

// retentionDays: a non-negative number of days, or '*' for "keep forever".
// 0 means "never within retention" (nothing is kept).
function isWithinRetention(timestampMs, retentionDays) {
  if (retentionDays === '*') return true;
  if (retentionDays === 0) return false;
  const ageMs = Date.now() - timestampMs;
  return ageMs <= retentionDays * 24 * 60 * 60 * 1000;
}

module.exports = { getConfig, isWithinRetention, CONFIG_PATH };
