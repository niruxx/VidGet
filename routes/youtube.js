const path = require('path');
const fs = require('fs');
const express = require('express');
const { tmp } = require('../utils/paths');
const { v4: uuidv4 } = require('uuid');
const sanitize = require('sanitize-filename');
const ytdlpExec = require('yt-dlp-exec');
const ffmpeg = require('fluent-ffmpeg');
const { FFMPEG_PATH: ffmpegPath } = require('../utils/paths');
const { createJob, getJob, updateJob, runWhenReady, checkJobAllowance } = require('../utils/jobs');
const { streamJobProgress } = require('../utils/sse');
const { logDownload } = require('../utils/connectionLog');
const { killTree } = require('../utils/killTree');
const { getConfig, isSiteAllowed } = require('../utils/config');
const ytdlpUpdater = require('../utils/ytdlpUpdater');
const { keepCopyIfEnabled, parseTime } = require('../utils/media');

const WORK_DIR = tmp('youtube');
fs.mkdirSync(WORK_DIR, { recursive: true });

const router = express.Router();

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav'];
const COVER_ART_FORMATS = new Set(['mp3', 'm4a', 'opus', 'flac']);
const SPONSORBLOCK_CATEGORIES = 'sponsor,selfpromo,interaction';
const SIDE_FILE_EXT = new Set(['.part', '.ytdl', '.vtt', '.srt', '.ass', '.webp', '.jpg', '.jpeg', '.png', '.json', '.temp', '.txt']);
// Codec settings used when an audio file has to be re-encoded (loudness normalization).
const AUDIO_REENCODE = {
  mp3: ['-c:a', 'libmp3lame', '-b:a', '256k', '-ar', '44100'],
  m4a: ['-c:a', 'aac', '-b:a', '256k', '-ar', '44100'],
  opus: ['-c:a', 'libopus', '-b:a', '160k', '-ar', '48000'],
  flac: ['-c:a', 'flac', '-ar', '44100'],
  wav: ['-c:a', 'pcm_s16le', '-ar', '44100'],
};

const BASE_FLAGS = {
  noWarnings: true,
  noCheckCertificates: true,
  ffmpegLocation: ffmpegPath,
};

/* ---------- URL checks ---------- */
const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

function parseHttpUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function isPrivateHost(hostname) {
  return PRIVATE_HOSTNAME_PATTERNS.some((re) => re.test(hostname.toLowerCase()));
}

// Returns an error message, or null when the link may be fetched.
function checkMediaUrl(url) {
  const parsed = parseHttpUrl(url);
  if (!parsed) return 'Please provide a valid link starting with http:// or https://.';
  if (isPrivateHost(parsed.hostname)) return 'Links to private or local addresses are not allowed.';
  if (!isSiteAllowed(parsed.hostname)) return `This server doesn't download from ${parsed.hostname.replace(/^www\./, '')}.`;
  return null;
}

function isYouTubeHost(url) {
  const host = parseHttpUrl(url)?.hostname.toLowerCase() || '';
  return /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/.test(host);
}

function hasPlaylistParam(url) {
  const parsed = parseHttpUrl(url);
  return Boolean(parsed && (parsed.searchParams.get('list') || /\/(playlist|sets|album)\b/.test(parsed.pathname)));
}

// Turns yt-dlp's error output into a message a visitor can act on.
function explainYtdlpError(err, fallback) {
  const text = String(err?.stderr || err?.message || '');
  if (/confirm you.?re not a bot|HTTP Error 429|rate.?limit|too many requests/i.test(text)) {
    return 'The site is temporarily blocking requests from this server. Please try again later.';
  }
  if (/private video|members.only|join this channel/i.test(text)) return 'This content is private or members-only.';
  if (/sign in to confirm your age|age.restricted|inappropriate for some users/i.test(text)) return "This content is age-restricted, so this server can't download it.";
  if (/log ?in|logged.in|authentication|cookies/i.test(text)) return 'This site requires signing in to view this content, which this server does not do.';
  if (/unsupported url/i.test(text)) return "This site isn't supported.";
  if (/video unavailable|not available|removed|does not exist|404/i.test(text)) return 'This content is unavailable. It may have been removed.';
  if (/drm/i.test(text)) return 'This content is DRM-protected and cannot be downloaded.';
  return fallback;
}

/* ---------- Info helpers ---------- */
function codecLabel(vcodec = '') {
  const c = vcodec.toLowerCase();
  if (c.startsWith('avc') || c.startsWith('h264')) return 'H.264';
  if (c.startsWith('hev') || c.startsWith('hvc') || c.startsWith('h265')) return 'H.265';
  if (c.startsWith('vp09') || c.startsWith('vp9')) return 'VP9';
  if (c.startsWith('vp8')) return 'VP8';
  if (c.startsWith('av01') || c.startsWith('av1')) return 'AV1';
  return c ? c.split('.')[0].toUpperCase() : '';
}

function formatSize(f) {
  return Number(f.filesize) || Number(f.filesize_approx) || 0;
}

function summarizeQualities(info, maxQuality) {
  const formats = info.formats || [];
  const audio = formats
    .filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
    .sort((a, b) => (Number(b.abr) || 0) - (Number(a.abr) || 0))[0];
  const audioSize = audio ? formatSize(audio) : 0;

  const byHeight = new Map();
  for (const f of formats) {
    if (!f.vcodec || f.vcodec === 'none' || !f.height) continue;
    if (maxQuality && f.height > maxQuality) continue;
    const best = byHeight.get(f.height);
    if (!best || (Number(f.tbr) || 0) > (Number(best.tbr) || 0)) byHeight.set(f.height, f);
  }

  return [...byHeight.values()]
    .sort((a, b) => b.height - a.height)
    .slice(0, 8)
    .map((f) => {
      const hasAudio = f.acodec && f.acodec !== 'none';
      const size = formatSize(f);
      return {
        formatId: String(f.format_id),
        height: f.height,
        label: `${f.height}p`,
        fps: f.fps ? Math.round(f.fps) : null,
        codec: codecLabel(f.vcodec),
        hdr: Boolean(f.dynamic_range && f.dynamic_range !== 'SDR'),
        size: size ? size + (hasAudio ? 0 : audioSize) : null,
      };
    });
}

function summarizeSubtitles(info) {
  const out = [];
  for (const [lang, tracks] of Object.entries(info.subtitles || {})) {
    if (lang === 'live_chat' || !Array.isArray(tracks) || !tracks.length) continue;
    out.push({ lang, name: tracks[0].name || lang, auto: false });
  }
  for (const [lang, tracks] of Object.entries(info.automatic_captions || {})) {
    if (!/-orig$/.test(lang) || !Array.isArray(tracks) || !tracks.length) continue;
    const base = lang.replace(/-orig$/, '');
    if (out.some((s) => s.lang === base)) continue;
    out.push({ lang, name: `${(tracks[0].name || base).replace(/\s*\(Original\)$/i, '')} (auto-generated)`, auto: true });
  }
  return out.slice(0, 60);
}

function labelFromUrl(url) {
  const parsed = parseHttpUrl(url);
  if (!parsed) return 'Untitled';
  const slug = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : parsed.hostname;
}

function pickThumbnail(entry) {
  if (entry.thumbnail) return entry.thumbnail;
  const thumbs = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
  const mid = thumbs.find((t) => t.width && t.width >= 240 && t.width <= 480) || thumbs[thumbs.length - 1];
  return mid?.url || null;
}

/* ---------- GET /info ---------- */
router.get('/info', async (req, res) => {
  const { url, playlist } = req.query;
  const urlError = checkMediaUrl(url);
  if (urlError) return res.status(400).json({ error: urlError });

  const { maxQuality, maxDurationMinutes, maxPlaylistItems } = getConfig().limits;
  const wantPlaylist = playlist === '1';
  if (wantPlaylist && !maxPlaylistItems) return res.status(400).json({ error: 'Playlists are turned off on this server.' });

  const flags = { ...BASE_FLAGS, dumpSingleJson: true, flatPlaylist: true };
  if (wantPlaylist) flags.playlistEnd = maxPlaylistItems;
  else flags.noPlaylist = true;

  let info;
  try {
    await ytdlpUpdater.whenReady();
    info = await ytdlpExec(url, flags);
  } catch (err) {
    return res.status(502).json({ error: explainYtdlpError(err, 'Could not fetch details for this link. The site may not be supported, or the content may be private, age-restricted, or unavailable.') });
  }

  if (info._type === 'playlist' || Array.isArray(info.entries)) {
    if (!maxPlaylistItems) return res.status(400).json({ error: 'Playlists are turned off on this server.' });
    const entries = (info.entries || [])
      .slice(0, maxPlaylistItems)
      .map((e) => ({
        url: e.url && parseHttpUrl(e.url) ? e.url : e.webpage_url,
        // Some sites (e.g. SoundCloud) list playlist entries without titles; fall
        // back to a readable name from the link, and let the download fetch the real one.
        title: e.title || null,
        label: e.title || labelFromUrl(e.url || e.webpage_url),
        duration: Number(e.duration) || null,
        thumbnail: pickThumbnail(e),
      }))
      .filter((e) => e.url && !checkMediaUrl(e.url));
    const total = Number(info.playlist_count) || entries.length;
    return res.json({
      kind: 'playlist',
      title: info.title || 'Playlist',
      author: info.uploader || info.channel || '',
      total,
      truncated: total > entries.length,
      maxItems: maxPlaylistItems,
      entries,
    });
  }

  if (maxDurationMinutes && Number(info.duration) > maxDurationMinutes * 60) {
    return res.status(400).json({ error: `This server only downloads media up to ${maxDurationMinutes} minute${maxDurationMinutes === 1 ? '' : 's'} long.` });
  }

  const formats = info.formats || [];
  // Only treat a source as audio-only when every format explicitly has no video codec.
  const audioOnly = formats.length > 0 && formats.every((f) => f.vcodec === 'none');

  res.json({
    kind: 'video',
    title: info.title,
    author: info.uploader || info.channel || info.artist || '',
    album: info.album || '',
    artist: info.artist || info.creator || '',
    duration: info.duration,
    thumbnail: info.thumbnail,
    hasVideo: !audioOnly,
    qualities: summarizeQualities(info, maxQuality),
    subtitles: summarizeSubtitles(info),
    isYouTube: isYouTubeHost(url),
    inPlaylist: maxPlaylistItems > 0 && hasPlaylistParam(url),
    maxQuality: maxQuality || null,
  });
});

/* ---------- Job helpers ---------- */
async function removeJobFiles(jobId) {
  // Give killed processes a moment to release file handles (needed on Windows).
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const files = await fs.promises.readdir(WORK_DIR).catch(() => []);
  await Promise.all(
    files.filter((f) => f.startsWith(jobId)).map((f) => fs.promises.unlink(path.join(WORK_DIR, f)).catch(() => {})),
  );
}

async function findOutput(jobId, preferredExts) {
  const files = (await fs.promises.readdir(WORK_DIR)).filter((f) => f.startsWith(jobId));
  const media = files.filter((f) => !SIDE_FILE_EXT.has(path.extname(f).toLowerCase()));
  const preferred = media.find((f) => preferredExts.includes(path.extname(f).slice(1).toLowerCase()));
  const pick = preferred || media[0];
  return { output: pick ? path.join(WORK_DIR, pick) : null, leftovers: files.filter((f) => f !== pick).map((f) => path.join(WORK_DIR, f)) };
}

function cleanTag(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '';
}

// Optional ffmpeg pass after yt-dlp: strip audio, rewrite tags, normalize loudness.
function postProcess(jobId, input, output, { muted, tags, normalize, audioFormat }) {
  return new Promise((resolve, reject) => {
    // Ogg (Opus) and WAV can't carry cover art as a picture stream; Opus keeps its
    // cover in a metadata tag, which -map_metadata carries over.
    const audioOnlyContainer = audioFormat === 'opus' || audioFormat === 'wav';
    const command = ffmpeg(input).outputOptions([
      ...(audioOnlyContainer ? ['-map', '0:a'] : ['-map', '0']),
      '-map_metadata', '0',
      '-c', 'copy',
    ]);
    if (muted) command.outputOptions(['-an']);
    if (normalize && AUDIO_REENCODE[audioFormat]) {
      command.outputOptions([...AUDIO_REENCODE[audioFormat], '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']);
    }
    for (const [key, value] of Object.entries(tags || {})) {
      if (!value) continue;
      // Separate arguments: fluent-ffmpeg would split a single "-metadata title=A B" string on the space.
      command.outputOptions('-metadata', `${key}=${value}`);
      // Ogg keeps tags on the audio stream rather than the container.
      if (audioFormat === 'opus') command.outputOptions('-metadata:s:a:0', `${key}=${value}`);
    }
    if (audioFormat === 'mp3') command.outputOptions(['-id3v2_version', '3']);
    updateJob(jobId, {
      cancel: () => {
        updateJob(jobId, { cancelled: true, status: 'error', error: 'Download cancelled.' });
        command.kill('SIGKILL');
      },
    });
    command.on('end', resolve).on('error', reject).save(output);
  });
}

function runYtdlp(jobId, url, flags, onLine, extraArgs = []) {
  // yt-dlp-exec accepts an array here; extra raw args go right after the URL.
  const subprocess = ytdlpExec.exec([url, ...extraArgs], flags);
  updateJob(jobId, {
    cancel: () => {
      updateJob(jobId, { cancelled: true, status: 'error', error: 'Download cancelled.' });
      killTree(subprocess);
    },
  });
  let buffer = '';
  subprocess.stdout?.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) if (line) onLine(line);
  });
  return subprocess;
}

/* ---------- POST /download ---------- */
router.post('/download', (req, res) => {
  const body = req.body || {};
  const { url, formatId, title } = body;
  const urlError = checkMediaUrl(url);
  if (urlError) return res.status(400).json({ error: urlError });
  if (formatId !== undefined && formatId !== null && (typeof formatId !== 'string' || !/^[\w.-]{1,40}$/.test(formatId))) {
    return res.status(400).json({ error: 'Invalid format.' });
  }

  const clipStart = parseTime(body.clip?.start);
  const clipEnd = parseTime(body.clip?.end);
  if ((clipStart !== null || clipEnd !== null) && clipEnd !== null && clipEnd <= (clipStart || 0)) {
    return res.status(400).json({ error: 'The clip end time must be after the start time.' });
  }

  const allowance = checkJobAllowance(req.ip);
  if (allowance) return res.status(429).json({ error: allowance });

  const type = body.type === 'audio' ? 'audio' : 'video';
  const opts = {
    url,
    type,
    formatId: formatId || null,
    height: Number.isInteger(Number(body.height)) && Number(body.height) > 0 ? Number(body.height) : null,
    audioFormat: AUDIO_FORMATS.includes(body.audioFormat) ? body.audioFormat : 'mp3',
    muted: type === 'video' && body.muted === true,
    clip: clipStart !== null || clipEnd !== null ? { start: clipStart || 0, end: clipEnd } : null,
    subtitles: type === 'video' && typeof body.subtitles === 'string' && /^[\w-]{1,20}$/.test(body.subtitles) ? body.subtitles : null,
    embedCover: body.embedCover !== false,
    sponsorblock: body.sponsorblock === true && isYouTubeHost(url),
    normalize: type === 'audio' && body.normalize === true,
    tags: type === 'audio' && body.tags && typeof body.tags === 'object'
      ? { title: cleanTag(body.tags.title), artist: cleanTag(body.tags.artist), album: cleanTag(body.tags.album) }
      : null,
    baseName: title ? sanitize(String(title)).slice(0, 80) : '',
  };

  const jobId = uuidv4();
  logDownload({ ip: req.ip, url, title, type });
  createJob(jobId, { ip: req.ip, kind: 'download', stage: 'queued' });
  runWhenReady(jobId, () => runDownload(jobId, opts));
  res.json({ jobId });
});

function buildFormatSelector({ formatId, height, muted }, maxQuality) {
  const cap = [maxQuality, height].filter(Boolean);
  const h = cap.length ? `[height<=${Math.min(...cap)}]` : '';
  if (formatId === 'compat') {
    return muted
      ? `bv[vcodec^=avc1]${h}/bv${h}/b${h}`
      : `bv*[vcodec^=avc1]${h}+ba[ext=m4a]/b[ext=mp4]${h}/bv*${h}+ba/b${h}`;
  }
  if (muted) return `${formatId ? `${formatId}${h}/` : ''}bv${h}/bv*${h}/b${h}`;
  return `${formatId ? `${formatId}${h}+ba/` : ''}bv*${h}+ba/b${h}`;
}

async function runDownload(jobId, o) {
  await ytdlpUpdater.whenReady(); // don't start while yt-dlp is replacing itself
  const { maxQuality, maxDurationMinutes } = getConfig().limits;
  const flags = {
    ...BASE_FLAGS,
    noPlaylist: true,
    newline: true,
    embedMetadata: true,
    output: path.join(WORK_DIR, `${jobId}.%(ext)s`),
  };
  if (maxDurationMinutes) flags.matchFilter = `duration <= ${maxDurationMinutes * 60}`;

  if (o.type === 'audio') {
    flags.format = 'bestaudio/best';
    flags.extractAudio = true;
    flags.audioFormat = o.audioFormat;
    flags.audioQuality = 0;
    if (o.embedCover && COVER_ART_FORMATS.has(o.audioFormat)) flags.embedThumbnail = true;
  } else {
    flags.format = buildFormatSelector(o, maxQuality);
    flags.mergeOutputFormat = 'mp4';
    if (o.embedCover) flags.embedThumbnail = true;
    if (o.subtitles) {
      flags.writeSubs = true;
      flags.writeAutoSubs = true;
      flags.subLangs = o.subtitles;
      flags.embedSubs = true;
    }
  }
  if (o.sponsorblock) flags.sponsorblockRemove = SPONSORBLOCK_CATEGORIES;
  if (o.clip) {
    flags.downloadSections = `*${o.clip.start}-${o.clip.end ?? 'inf'}`;
    flags.forceKeyframesAtCuts = true;
  }

  // yt-dlp writes the real title here, used when the visitor didn't send one.
  const titleFile = path.join(WORK_DIR, `${jobId}.title.txt`);
  let mediaDestinations = 0;
  const subprocess = runYtdlp(jobId, o.url, flags, (line) => {
    const dest = line.match(/\[download\] Destination: (.+)$/);
    if (dest && !SIDE_FILE_EXT.has(path.extname(dest[1]).toLowerCase())) mediaDestinations++;
    const match = line.match(/\[download]\s+([\d.]+)%/);
    if (match) {
      updateJob(jobId, {
        percent: Math.min(98, Math.round(parseFloat(match[1]))),
        stage: o.type === 'audio' ? 'audio' : mediaDestinations > 1 ? 'audio-track' : 'video',
      });
    } else if (/^\[(Merger|ExtractAudio|EmbedSubtitle|EmbedThumbnail|Metadata|ModifyChapters|SponsorBlock|VideoRemuxer|FixupM3u8)\]/.test(line)) {
      updateJob(jobId, { percent: 99, stage: 'finalizing' });
    }
  }, ['--print-to-file', 'after_move:%(title)s', titleFile]);

  try {
    await subprocess;
  } catch (err) {
    if (getJob(jobId)?.cancelled) return removeJobFiles(jobId);
    updateJob(jobId, { status: 'error', error: explainYtdlpError(err, 'Download failed. The link may be unsupported, private, or restricted.') });
    return removeJobFiles(jobId);
  }
  if (getJob(jobId)?.cancelled) return removeJobFiles(jobId);

  if (!o.baseName) {
    const fetched = await fs.promises.readFile(titleFile, 'utf8').catch(() => '');
    o.baseName = sanitize(fetched.split(/\r?\n/)[0].trim()).slice(0, 80) || (o.type === 'audio' ? 'audio' : 'video');
  }
  const preferred = o.type === 'audio' ? [o.audioFormat] : ['mp4', 'mkv', 'webm'];
  let { output, leftovers } = await findOutput(jobId, preferred);
  leftovers.forEach((f) => fs.promises.unlink(f).catch(() => {}));
  if (!output) {
    updateJob(jobId, {
      status: 'error',
      error: maxDurationMinutes
        ? `Nothing was downloaded. The media may be longer than this server's ${maxDurationMinutes}-minute limit.`
        : 'Output file not found after download.',
    });
    return;
  }

  const hasTags = o.tags && Object.values(o.tags).some(Boolean);
  if (o.muted || o.normalize || hasTags) {
    updateJob(jobId, { percent: 99, stage: o.normalize ? 'normalizing' : 'finalizing' });
    const ext = path.extname(output);
    const processed = path.join(WORK_DIR, `${jobId}.post${o.muted ? '.mp4' : ext}`);
    try {
      await postProcess(jobId, output, processed, { muted: o.muted, tags: hasTags ? o.tags : null, normalize: o.normalize, audioFormat: o.type === 'audio' ? o.audioFormat : null });
      await fs.promises.unlink(output).catch(() => {});
      output = processed;
    } catch (err) {
      fs.promises.unlink(processed).catch(() => {});
      if (getJob(jobId)?.cancelled) return removeJobFiles(jobId);
      console.error(`Post-processing ${jobId} failed:`, err.message);
      updateJob(jobId, { status: 'error', error: 'Processing the downloaded file failed.' });
      fs.promises.unlink(output).catch(() => {});
      return;
    }
  }

  const ext = path.extname(output);
  await keepCopyIfEnabled(output, o.type === 'audio' ? 'audio' : 'video', o.baseName, ext);
  updateJob(jobId, {
    status: 'done',
    percent: 100,
    outputPath: output,
    downloadName: `${o.baseName}${o.clip ? ' (clip)' : ''}${ext}`,
  });
}

/* ---------- POST /subtitles ---------- */
router.post('/subtitles', (req, res) => {
  const { url, lang, title } = req.body || {};
  const urlError = checkMediaUrl(url);
  if (urlError) return res.status(400).json({ error: urlError });
  if (typeof lang !== 'string' || !/^[\w-]{1,20}$/.test(lang)) return res.status(400).json({ error: 'Pick a subtitle language.' });
  const allowance = checkJobAllowance(req.ip);
  if (allowance) return res.status(429).json({ error: allowance });

  const jobId = uuidv4();
  const baseName = sanitize(String(title || 'subtitles')).slice(0, 80) || 'subtitles';
  createJob(jobId, { ip: req.ip, kind: 'subtitles', stage: 'queued' });
  runWhenReady(jobId, async () => {
    await ytdlpUpdater.whenReady();
    const flags = {
      ...BASE_FLAGS,
      noPlaylist: true,
      skipDownload: true,
      writeSubs: true,
      writeAutoSubs: true,
      subLangs: lang,
      convertSubs: 'srt',
      output: path.join(WORK_DIR, `${jobId}.%(ext)s`),
    };
    updateJob(jobId, { stage: 'subtitles', percent: 50 });
    try {
      await runYtdlp(jobId, url, flags, () => {});
    } catch {
      if (getJob(jobId)?.cancelled) return removeJobFiles(jobId);
      updateJob(jobId, { status: 'error', error: 'Could not download subtitles.' });
      return removeJobFiles(jobId);
    }
    const files = (await fs.promises.readdir(WORK_DIR)).filter((f) => f.startsWith(jobId));
    const srt = files.find((f) => f.endsWith('.srt'));
    files.filter((f) => f !== srt).forEach((f) => fs.promises.unlink(path.join(WORK_DIR, f)).catch(() => {}));
    if (!srt) return updateJob(jobId, { status: 'error', error: 'No subtitles in that language were found.' });
    updateJob(jobId, {
      status: 'done',
      percent: 100,
      outputPath: path.join(WORK_DIR, srt),
      downloadName: `${baseName} (${lang.replace(/-orig$/, '')}).srt`,
    });
  });
  res.json({ jobId });
});

/* ---------- Thumbnails (proxied so visitors never contact the source site) ---------- */
router.get('/thumbnail', async (req, res) => {
  const { src, title, inline } = req.query;
  const parsed = parseHttpUrl(src);
  if (!parsed || isPrivateHost(parsed.hostname)) {
    return res.status(400).json({ error: 'Invalid thumbnail source.' });
  }

  try {
    // Follow redirects by hand so each hop is checked against private addresses.
    let target = parsed;
    let upstream;
    for (let hop = 0; hop < 4; hop++) {
      upstream = await fetch(target.toString(), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      if (upstream.status < 300 || upstream.status >= 400) break;
      const next = parseHttpUrl(new URL(upstream.headers.get('location') || '', target).toString());
      if (!next || isPrivateHost(next.hostname)) throw new Error('Bad redirect.');
      target = next;
    }
    if (!upstream.ok) throw new Error('Upstream fetch failed.');
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) throw new Error('Not an image.');
    const length = Number(upstream.headers.get('content-length'));
    if (length > 15 * 1024 * 1024) throw new Error('Too large.');

    const ext = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';
    const baseName = sanitize(String(title || 'thumbnail')).slice(0, 80) || 'thumbnail';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.set('Content-Type', contentType);
    res.set('X-Content-Type-Options', 'nosniff');
    if (inline) {
      res.set('Cache-Control', 'private, max-age=3600');
    } else {
      res.set('Content-Disposition', `attachment; filename="${baseName} - thumbnail.${ext}"`);
    }
    res.send(buffer);
  } catch {
    res.status(502).json({ error: 'Could not download thumbnail.' });
  }
});

router.get('/progress/:jobId', streamJobProgress(getJob));

router.post('/cancel/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || typeof job.cancel !== 'function' || job.status === 'done' || job.status === 'error') {
    return res.status(404).json({ error: 'Nothing to cancel.' });
  }
  job.cancel();
  res.json({ ok: true });
});

router.get('/result/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.status !== 'done') {
    return res.status(404).json({ error: 'This file has expired or does not exist.' });
  }
  res.download(job.outputPath, job.downloadName, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'This file has expired or does not exist.' });
  });
});

router.AUDIO_FORMATS = AUDIO_FORMATS;
router.explainYtdlpError = explainYtdlpError;

module.exports = router;
