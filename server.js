const path = require('path');
const fs = require('fs');
const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const { FFMPEG_PATH: ffmpegPath, PUBLIC_DIR, tmp } = require('./utils/paths');
const ffprobePath = require('ffprobe-static').path;
const ytdlpUpdater = require('./utils/ytdlpUpdater');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

for (const dir of ['uploads', 'converted']) {
  fs.mkdirSync(tmp(dir), { recursive: true });
}

const youtubeRouter = require('./routes/youtube');
const convertRouter = require('./routes/convert');
const imageRouter = require('./routes/image');
const adminRouter = require('./routes/admin');
const adminAuth = require('./utils/adminAuth');
const { getConfig } = require('./utils/config');
const { pruneLogs } = require('./utils/connectionLog');
const { pruneSaves } = require('./utils/savesCleanup');
const { sweepTemp } = require('./utils/tempCleanup');
const { rateLimit } = require('./utils/rateLimit');
const { countActiveJobs, countQueuedJobs } = require('./utils/jobs');

const app = express();
const PORT = process.env.PORT || getConfig().port;
const startedAt = Date.now();
const { version } = require('./package.json');
app.set('listenPort', Number(PORT));
app.disable('x-powered-by');

// Behind a reverse proxy, the admin can tell Vidget to trust the first proxy
// hop so rate limits see real visitor IPs. Read per request, so it applies live.
app.set('trust proxy', (addr, hop) => getConfig().trustProxy && hop === 0);

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

ytdlpUpdater.startSchedule();

// For uptime monitors. Shows no visitor data.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version,
    ytDlp: ytdlpUpdater.getStatus().version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    jobs: { running: countActiveJobs(), queued: countQueuedJobs() },
    setUp: adminAuth.isConfigured(),
  });
});

// Hidden admin portal. Not linked from the public site.
app.use('/admin', adminRouter);

// Until the owner has created the admin account, the public site is closed
// and every page sends the visitor to the setup screen.
app.use((req, res, next) => {
  if (adminAuth.isConfigured()) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ error: 'This Vidget instance has not been set up yet.' });
  }
  if (req.path === '/' || req.path === '/index.html') return res.redirect(302, '/admin');
  next();
});

app.use(express.json({ limit: '64kb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/api/meta', (req, res) => {
  const c = getConfig();
  res.json({
    version,
    siteName: c.siteName,
    tagline: c.tagline,
    announcement: c.announcement,
    contact: c.contact,
    terms: c.terms,
    features: c.features,
    logRetentionDays: c.logRetentionDays,
    savesRetentionDays: c.savesRetentionDays,
    keepCopies: c.storage.keepCopies,
    resultTtlMinutes: c.storage.resultTtlMinutes,
    limits: c.limits,
    sites: c.sites,
    audioFormats: youtubeRouter.AUDIO_FORMATS,
  });
});

// Tools the admin has switched off are refused here, not just hidden in the UI.
function requireFeature(feature) {
  return (req, res, next) => {
    if (getConfig().features[feature]) return next();
    res.status(403).json({ error: 'This tool is turned off on this instance.' });
  };
}

// Per-IP limits on the expensive endpoints (fetching info, starting jobs, uploads).
const limitActions = rateLimit('actions', () => getConfig().limits.requestsPerMinute);
const limitThumbnails = rateLimit('thumbs', () => (getConfig().limits.requestsPerMinute ? 300 : 0));
app.use('/api/youtube/info', limitActions);
app.use('/api/youtube/download', limitActions);
app.use('/api/youtube/subtitles', limitActions);
app.use('/api/youtube/thumbnail', limitThumbnails);
app.use('/api/convert/start', limitActions);
app.use('/api/image/upload', limitActions);
app.use('/api/image/convert', limitActions);

app.use('/api/youtube', requireFeature('downloader'), youtubeRouter);
app.use('/api/convert', requireFeature('videoConverter'), convertRouter);
app.use('/api/image', requireFeature('imageConverter'), imageRouter);

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
function runPruneSweep() {
  pruneLogs().catch(() => {});
  pruneSaves().catch(() => {});
  sweepTemp().catch(() => {});
}
sweepTemp({ startup: true })
  .then((n) => { if (n) console.log(`Removed ${n} leftover temp file${n === 1 ? '' : 's'} from a previous run.`); })
  .catch(() => {});
pruneLogs().catch(() => {});
pruneSaves().catch(() => {});
setInterval(runPruneSweep, PRUNE_INTERVAL_MS).unref();

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    const { limits } = getConfig();
    const mb = req.originalUrl.startsWith('/api/image') ? limits.imageUploadMB : limits.videoUploadMB;
    const label = mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
    return res.status(413).json({ error: `File is too large (${label} max on this server).` });
  }
  if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed')) {
    return res.status(400).json({ error: 'Invalid request.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

// HOST env var, then config.json "host"; empty = every interface.
const HOST = process.env.HOST || getConfig().host || undefined;
app.set('listenHost', HOST || '');

const server = app.listen(PORT, HOST, () => {
  const shownHost = !HOST || HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST.includes(':') ? `[${HOST}]` : HOST;
  console.log(`Vidget running at http://${shownHost}:${PORT}${HOST ? ` (listening on ${HOST})` : ''}`);
  if (!adminAuth.isConfigured()) {
    const line = '='.repeat(64);
    console.log(`\n${line}`);
    console.log('  First run: create the admin account to open Vidget to visitors.');
    console.log(`  Open:        http://localhost:${PORT}/admin`);
    console.log(`  Setup token: ${adminAuth.getSetupToken()}`);
    console.log('  (The token changes every time the server restarts until setup is done.)');
    console.log(`${line}\n`);
  }
});

server.on('error', (err) => {
  console.error(`Could not start the server: ${err.message}`);
  process.exit(1);
});

module.exports = { app, server };
