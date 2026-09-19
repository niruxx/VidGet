const path = require('path');
const fs = require('fs');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const sanitize = require('sanitize-filename');
const ytdlpExec = require('yt-dlp-exec');
const ffmpegPath = require('ffmpeg-static');
const { createJob, getJob, updateJob } = require('../utils/jobs');
const { streamJobProgress } = require('../utils/sse');
const { logDownload } = require('../utils/connectionLog');
const { getUniqueDestination } = require('../utils/uniqueFile');

const WORK_DIR = path.join(__dirname, '..', 'tmp', 'youtube');
const SAVES_DIR = path.join(__dirname, '..', 'Saves');
const VIDEO_DIR = path.join(SAVES_DIR, 'video');
const AUDIO_DIR = path.join(SAVES_DIR, 'audio');
fs.mkdirSync(WORK_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const router = express.Router();

function isValidUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
];

function isSafeExternalUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (PRIVATE_HOSTNAME_PATTERNS.some((re) => re.test(parsed.hostname.toLowerCase()))) return null;
  return parsed;
}

router.get('/info', async (req, res) => {
  const { url } = req.query;
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid video link.' });
  }

  try {
    const info = await ytdlpExec(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      noPlaylist: true,
    });

    const seenHeights = new Set();
    const qualities = [];
    for (const f of info.formats || []) {
      if (f.vcodec && f.vcodec !== 'none' && f.height && !seenHeights.has(f.height)) {
        seenHeights.add(f.height);
        qualities.push({ formatId: f.format_id, height: f.height, label: `${f.height}p` });
      }
    }
    qualities.sort((a, b) => b.height - a.height);

    // Only treat a source as audio-only when every format explicitly has no video codec.
    const formats = info.formats || [];
    const audioOnly = formats.length > 0 && formats.every((f) => f.vcodec === 'none');

    res.json({
      title: info.title,
      author: info.uploader || info.channel || '',
      duration: info.duration,
      thumbnail: info.thumbnail,
      hasVideo: !audioOnly,
      qualities: qualities.slice(0, 8),
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch details for this link. The site may not be supported, or the content may be private, age-restricted, or unavailable.' });
  }
});

router.post('/download', express.json(), (req, res) => {
  const { url, formatId, type, title } = req.body || {};
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid video link.' });
  }

  const jobId = uuidv4();
  const baseName = sanitize(title || 'video').slice(0, 80) || 'video';
  const outputTemplate = path.join(WORK_DIR, `${jobId}.%(ext)s`);

  logDownload({ ip: req.ip, url, title, type: type === 'audio' ? 'audio' : 'video' });

  createJob(jobId, { status: 'processing', percent: 0, stage: 'starting' });
  res.json({ jobId });

  const flags = {
    noWarnings: true,
    noCheckCertificates: true,
    noPlaylist: true,
    ffmpegLocation: ffmpegPath,
    newline: true,
    output: outputTemplate,
  };

  if (type === 'audio') {
    flags.format = 'bestaudio';
    flags.extractAudio = true;
    flags.audioFormat = 'mp3';
    flags.audioQuality = 0;
  } else {
    flags.format = formatId ? `${formatId}+bestaudio/best` : 'bestvideo+bestaudio/best';
    flags.mergeOutputFormat = 'mp4';
  }

  const subprocess = ytdlpExec.exec(url, flags);
  let destinationCount = 0;

  subprocess.stdout?.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line) continue;
      if (line.includes('Destination:')) destinationCount++;
      const match = line.match(/\[download]\s+([\d.]+)%/);
      if (match) {
        updateJob(jobId, {
          percent: Math.round(parseFloat(match[1])),
          stage: destinationCount > 1 ? 'audio' : 'video',
        });
      } else if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
        updateJob(jobId, { percent: 99, stage: 'finalizing' });
      }
    }
  });

  subprocess
    .then(async () => {
      const files = await fs.promises.readdir(WORK_DIR);
      const match = files.find((f) => f.startsWith(jobId));
      if (!match) {
        updateJob(jobId, { status: 'error', error: 'Output file not found after download.' });
        return;
      }
      const tempPath = path.join(WORK_DIR, match);
      const ext = path.extname(match);
      const targetDir = type === 'audio' ? AUDIO_DIR : VIDEO_DIR;
      const destPath = await getUniqueDestination(targetDir, baseName, ext);

      await fs.promises.rename(tempPath, destPath);

      updateJob(jobId, {
        status: 'done',
        percent: 100,
        outputPath: destPath,
        downloadName: path.basename(destPath),
        keepOutput: true,
      });
    })
    .catch(() => {
      updateJob(jobId, { status: 'error', error: 'Download failed. The link may be unsupported, private, or restricted.' });
    });
});

router.get('/thumbnail', async (req, res) => {
  const { src, title } = req.query;

  const parsed = isSafeExternalUrl(src);
  if (!parsed) {
    return res.status(400).json({ error: 'Invalid thumbnail source.' });
  }

  try {
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) throw new Error('Upstream fetch failed.');

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';
    const baseName = sanitize(title || 'thumbnail').slice(0, 80) || 'thumbnail';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `attachment; filename="${baseName} - thumbnail.${ext}"`);
    res.send(buffer);
  } catch {
    res.status(502).json({ error: 'Could not download thumbnail.' });
  }
});

router.get('/progress/:jobId', streamJobProgress(getJob));

router.get('/result/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.status !== 'done') {
    return res.status(404).json({ error: 'Result not available.' });
  }
  res.download(job.outputPath, job.downloadName);
});

module.exports = router;
