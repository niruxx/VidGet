const { execFile } = require('child_process');
const { YOUTUBE_DL_PATH } = require('yt-dlp-exec/src/constants');
const { getConfig } = require('./config');
const { countRunning } = require('./jobs');

// Sites change constantly and an outdated yt-dlp is the most common reason
// downloads fail, so keep it current. Updates only run between downloads, and
// new downloads wait while an update is in progress.
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const YTDLP_KINDS = ['download', 'subtitles'];

const state = {
  version: null,
  lastCheck: null, // ms timestamp of the last finished update attempt
  lastResult: null, // 'updated' | 'current' | 'failed' | 'deferred'
  message: '',
  updating: false,
};
let updatePromise = null;

function run(args, timeout) {
  return new Promise((resolve) => {
    execFile(YOUTUBE_DL_PATH, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() });
    });
  });
}

async function refreshVersion() {
  const { ok, out } = await run(['--version'], 20000);
  if (ok) state.version = out.split(/\r?\n/).pop().trim();
  return state.version;
}

// Resolves once no update is running; downloads await this before starting.
function whenReady() {
  return updatePromise || Promise.resolve();
}

async function update({ force = false } = {}) {
  if (state.updating) return updatePromise;
  if (countRunning(YTDLP_KINDS) > 0 && !force) {
    state.lastResult = 'deferred';
    state.message = 'Downloads are running; will try again once they finish.';
    return { ...state };
  }
  state.updating = true;
  updatePromise = (async () => {
    const before = state.version || (await refreshVersion());
    const { ok, out } = await run(['-U'], 5 * 60 * 1000);
    await refreshVersion();
    state.lastCheck = Date.now();
    if (!ok) {
      state.lastResult = 'failed';
      // Package-manager installs (pip, apt) can't self-update.
      state.message = (out.split(/\r?\n/).filter(Boolean).pop() || 'Update failed.').slice(0, 300);
      console.warn(`yt-dlp update failed: ${state.message}`);
    } else if (state.version && before && state.version !== before) {
      state.lastResult = 'updated';
      state.message = `Updated from ${before} to ${state.version}.`;
      console.log(`yt-dlp ${state.message}`);
    } else {
      state.lastResult = 'current';
      state.message = 'Already up to date.';
    }
  })().finally(() => {
    state.updating = false;
    updatePromise = null;
  });
  await updatePromise;
  return { ...state };
}

function getStatus() {
  return { ...state, autoUpdate: getConfig().ytdlpAutoUpdate };
}

// Check hourly whether a daily update is due (or a deferred one can run now).
function startSchedule() {
  refreshVersion().catch(() => {});
  const tick = () => {
    if (!getConfig().ytdlpAutoUpdate || state.updating) return;
    const due = !state.lastCheck || Date.now() - state.lastCheck >= CHECK_EVERY_MS || state.lastResult === 'deferred';
    if (due) update().catch(() => {});
  };
  setTimeout(tick, 2 * 60 * 1000).unref(); // shortly after startup
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { update, getStatus, whenReady, refreshVersion, startSchedule };
