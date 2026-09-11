const fs = require('fs');
const path = require('path');
const { getConfig, isWithinRetention } = require('./config');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_PATH = path.join(LOG_DIR, 'connections.log');
fs.mkdirSync(LOG_DIR, { recursive: true });

function logDownload({ ip, url, title, type }) {
  const { logRetentionDays } = getConfig();
  if (logRetentionDays === 0) return;

  const entry = {
    timestamp: new Date().toISOString(),
    ip,
    url,
    title: title || null,
    type,
  };

  fs.appendFile(LOG_PATH, `${JSON.stringify(entry)}\n`, () => {});
}

async function pruneLogs() {
  const { logRetentionDays } = getConfig();

  if (logRetentionDays === 0) {
    await fs.promises.rm(LOG_PATH, { force: true }).catch(() => {});
    return;
  }
  if (logRetentionDays === '*') return;

  let raw;
  try {
    raw = await fs.promises.readFile(LOG_PATH, 'utf8');
  } catch {
    return;
  }

  const kept = raw
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      try {
        const entry = JSON.parse(line);
        return isWithinRetention(new Date(entry.timestamp).getTime(), logRetentionDays);
      } catch {
        return false;
      }
    });

  await fs.promises.writeFile(LOG_PATH, kept.length ? `${kept.join('\n')}\n` : '');
}

module.exports = { logDownload, pruneLogs, LOG_PATH };
