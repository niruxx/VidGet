const path = require('path');
const fs = require('fs');
const express = require('express');
const auth = require('../utils/adminAuth');
const { getConfig, saveConfig, QUALITY_CAPS } = require('../utils/config');
const { countActiveJobs, countQueuedJobs } = require('../utils/jobs');
const ytdlpUpdater = require('../utils/ytdlpUpdater');
const ffmpegCaps = require('../utils/ffmpegCaps');
const { LOG_PATH, pruneLogs } = require('../utils/connectionLog');
const { pruneSaves } = require('../utils/savesCleanup');

const { ADMIN_UI_DIR, SAVES_DIR, TMP_DIR } = require('../utils/paths');
const COOKIE_NAME = 'vidget_admin';
const SAVES_SUBDIRS = ['video', 'audio', 'Uploaded'];
const startedAt = Date.now();
const { version } = require('../package.json');

const router = express.Router();

// Keep the portal out of search engines and caches.
router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

router.get('/', (req, res) => res.sendFile(path.join(ADMIN_UI_DIR, 'index.html')));
router.use('/assets', express.static(ADMIN_UI_DIR, { index: false }));

/* ---------- helpers ---------- */
function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setSessionCookie(req, res, token) {
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${Math.floor(auth.SESSION_TTL_MS / 1000)}${secure}`);
}

function clearSessionCookie(res) {
  res.set('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`);
}

function isAuthenticated(req) {
  return auth.isValidSession(readCookie(req, COOKIE_NAME));
}

// Basic CSRF protection: state-changing requests must be JSON (which a
// cross-site form can't send) and, when the browser says where they came
// from, come from this same host. The cookie is also SameSite=Strict.
function sameOriginJson(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (!req.is('application/json')) return res.status(415).json({ error: 'Expected a JSON request.' });
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

const api = express.Router();
api.use(express.json({ limit: '32kb' }));
api.use(sameOriginJson);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- public (pre-auth) endpoints ---------- */
api.get('/state', (req, res) => {
  res.json({
    configured: auth.isConfigured(),
    authenticated: auth.isConfigured() && isAuthenticated(req),
    username: isAuthenticated(req) ? auth.getUsername() : null,
    minPasswordLength: auth.MIN_PASSWORD_LENGTH,
  });
});

api.post('/setup', wrap(async (req, res) => {
  const { token, username, password } = req.body || {};
  const result = await auth.setupAdmin({ token, username: String(username || '').trim(), password });
  if (result.error) return res.status(result.status).json({ error: result.error });
  console.log(`Admin account "${auth.getUsername()}" created. Vidget is now open to visitors.`);
  setSessionCookie(req, res, auth.createSession());
  res.json({ ok: true });
}));

api.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const result = await auth.verifyLogin(req.ip, String(username || '').trim(), password);
  if (result.error) return res.status(result.status).json({ error: result.error });
  setSessionCookie(req, res, auth.createSession());
  res.json({ ok: true });
}));

api.post('/logout', (req, res) => {
  auth.destroySession(readCookie(req, COOKIE_NAME));
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* ---------- authenticated endpoints ---------- */
api.use(requireAuth);

api.get('/settings', (req, res) => {
  res.json({ settings: getConfig(), qualityCaps: QUALITY_CAPS });
});

function pickSettings(body) {
  const patch = {};
  const copy = (key) => { if (body[key] !== undefined) patch[key] = body[key]; };
  ['port', 'logRetentionDays', 'savesRetentionDays', 'siteName', 'tagline', 'announcement', 'contact', 'terms', 'trustProxy', 'host', 'ytdlpAutoUpdate', 'hardwareEncoding'].forEach(copy);
  if (body.features && typeof body.features === 'object') {
    patch.features = {};
    for (const k of ['downloader', 'videoConverter', 'imageConverter']) {
      if (typeof body.features[k] === 'boolean') patch.features[k] = body.features[k];
    }
  }
  if (body.limits && typeof body.limits === 'object') {
    patch.limits = {};
    for (const k of ['maxQuality', 'maxDurationMinutes', 'videoUploadMB', 'imageUploadMB', 'maxPlaylistItems', 'maxConcurrentJobs', 'maxJobsPerIp', 'requestsPerMinute', 'maxJobMinutes']) {
      if (body.limits[k] !== undefined) patch.limits[k] = body.limits[k];
    }
  }
  if (body.storage && typeof body.storage === 'object') {
    patch.storage = {};
    if (typeof body.storage.keepCopies === 'boolean') patch.storage.keepCopies = body.storage.keepCopies;
    if (body.storage.resultTtlMinutes !== undefined) patch.storage.resultTtlMinutes = body.storage.resultTtlMinutes;
  }
  if (body.sites && typeof body.sites === 'object') {
    patch.sites = {};
    if (body.sites.mode !== undefined) patch.sites.mode = body.sites.mode;
    if (body.sites.list !== undefined) patch.sites.list = body.sites.list;
  }
  return patch;
}

api.put('/settings', (req, res) => {
  const before = getConfig();
  const settings = saveConfig(pickSettings(req.body || {}));
  const runningPort = Number(req.app.get('listenPort'));
  const portOverridden = Boolean(process.env.PORT);
  // Apply new retention rules right away instead of waiting for the hourly sweep.
  if (settings.logRetentionDays !== before.logRetentionDays) pruneLogs().catch(() => {});
  if (settings.savesRetentionDays !== before.savesRetentionDays) pruneSaves().catch(() => {});
  const hostOverridden = Boolean(process.env.HOST);
  res.json({
    settings,
    portOverridden,
    restartRequired: (!portOverridden && settings.port !== runningPort)
      || (!hostOverridden && settings.host !== (req.app.get('listenHost') || '')),
  });
});

api.post('/account', wrap(async (req, res) => {
  const { currentPassword, newPassword, newUsername } = req.body || {};
  const result = await auth.changeCredentials({ currentPassword, newPassword, newUsername });
  if (result.error) return res.status(result.status).json({ error: result.error });
  // All sessions were revoked; keep this browser signed in.
  setSessionCookie(req, res, auth.createSession());
  res.json({ ok: true, username: auth.getUsername() });
}));

async function dirStats(dir) {
  let files = 0;
  let bytes = 0;
  const walk = async (d) => {
    const entries = await fs.promises.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name === '.gitkeep') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        const st = await fs.promises.stat(full).catch(() => null);
        if (st) { files++; bytes += st.size; }
      }
    }
  };
  await walk(dir);
  return { files, bytes };
}

api.get('/stats', wrap(async (req, res) => {
  const storage = {};
  for (const sub of SAVES_SUBDIRS) storage[sub] = await dirStats(path.join(SAVES_DIR, sub));
  storage.temp = await dirStats(TMP_DIR);
  const logStat = await fs.promises.stat(LOG_PATH).catch(() => null);
  storage.logs = { files: logStat ? 1 : 0, bytes: logStat ? logStat.size : 0 };
  res.json({
    version,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    activeJobs: countActiveJobs(),
    queuedJobs: countQueuedJobs(),
    port: req.app.get('listenPort'),
    host: req.app.get('listenHost'),
    storage,
    ytdlp: ytdlpUpdater.getStatus(),
    ffmpeg: {
      version: ffmpegCaps.version.raw,
      custom: Boolean(process.env.VIDGET_FFMPEG),
      heif: ffmpegCaps.features.heif,
      animatedWebp: ffmpegCaps.features.animatedWebp,
    },
    hardware: { ...ffmpegCaps.hardware },
  });
}));

// Run "yt-dlp -U" now (waits for running downloads unless forced).
api.post('/ytdlp/update', wrap(async (req, res) => {
  const status = await ytdlpUpdater.update({ force: req.body?.force === true });
  res.json({ ...status, autoUpdate: getConfig().ytdlpAutoUpdate });
}));

api.post('/purge', wrap(async (req, res) => {
  const { target } = req.body || {};
  if (target === 'saves') {
    let removed = 0;
    for (const sub of SAVES_SUBDIRS) {
      const dir = path.join(SAVES_DIR, sub);
      const files = await fs.promises.readdir(dir).catch(() => []);
      for (const f of files) {
        if (f === '.gitkeep') continue;
        await fs.promises.rm(path.join(dir, f), { recursive: true, force: true }).then(() => removed++).catch(() => {});
      }
    }
    return res.json({ ok: true, removed });
  }
  if (target === 'logs') {
    await fs.promises.rm(LOG_PATH, { force: true }).catch(() => {});
    return res.json({ ok: true, removed: 1 });
  }
  res.status(400).json({ error: 'Unknown purge target.' });
}));

router.use('/api', api);

router.use('/api', (err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

module.exports = router;
