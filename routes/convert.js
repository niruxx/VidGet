const path = require('path');
const fs = require('fs');
const express = require('express');
const { tmp } = require('../utils/paths');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sanitize = require('sanitize-filename');
const ffmpeg = require('fluent-ffmpeg');
const { getConfig } = require('../utils/config');
const { createJob, getJob, updateJob, runWhenReady, checkJobAllowance } = require('../utils/jobs');
const { streamJobProgress } = require('../utils/sse');
const { probe, parseTime } = require('../utils/media');
const { hasEncoder, hardware, VAAPI_DEVICE } = require('../utils/ffmpegCaps');

const UPLOAD_DIR = tmp('uploads');
const OUTPUT_DIR = tmp('converted');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'gif'];
const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'aac', 'ogg'];
const ALLOWED_FORMATS = new Set([...VIDEO_FORMATS, ...AUDIO_FORMATS]);
const RESOLUTIONS = [2160, 1440, 1080, 720, 480, 360];
const FPS_OPTIONS = [60, 30, 24, 15];
const AUDIO_BITRATES = [96, 128, 192, 256, 320];
const LOSSY_AUDIO = new Set(['mp3', 'aac', 'ogg']);
// 'original' keeps streams as they are whenever possible (no re-encode).
const QUALITY_PRESETS = ['original', 'high', 'balanced', 'small'];

// Constant-quality values per codec for each preset (lower = better quality, bigger file).
const CRF = {
  h264: { high: 20, balanced: 23, small: 28 },
  h265: { high: 22, balanced: 26, small: 31 },
  vp9: { high: 28, balanced: 33, small: 40 },
};

// Which encoders make sense in which container. The first is the default.
const CODECS_FOR = {
  mp4: ['h264', 'h265'],
  mov: ['h264', 'h265'],
  mkv: ['h264', 'h265', 'vp9'],
  webm: ['vp9'],
  avi: [],
};
const ENCODER = { h264: 'libx264', h265: 'libx265', vp9: 'libvpx-vp9' };

// Source codecs each container can hold as-is, so they can be copied instead of re-encoded.
const ANY = '*';
const VIDEO_COPY = {
  mp4: ['h264', 'hevc', 'av1', 'vp9', 'mpeg4'],
  mov: ['h264', 'hevc', 'mpeg4', 'prores', 'mjpeg'],
  mkv: ANY,
  webm: ['vp8', 'vp9', 'av1'],
  avi: [],
};
const AUDIO_COPY = {
  mp4: ['aac', 'mp3', 'opus', 'flac', 'alac', 'ac3', 'eac3'],
  mov: ['aac', 'mp3', 'alac', 'pcm_s16le', 'pcm_s24le'],
  mkv: ANY,
  webm: ['opus', 'vorbis'],
  avi: ['mp3', 'ac3', 'pcm_s16le'],
  mp3: ['mp3'],
  aac: ['aac'],
  flac: ['flac'],
  ogg: ['vorbis', 'opus', 'flac'],
  wav: ['pcm_s16le', 'pcm_s24le', 'pcm_f32le'],
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).slice(0, 10)}`),
});

// The size limit is read per request so changes from the admin portal apply immediately.
const upload = {
  single: (field) => (req, res, next) =>
    multer({ storage, limits: { fileSize: getConfig().limits.videoUploadMB * 1024 * 1024, files: 1 } }).single(field)(req, res, next),
};

// Refuse before the upload starts if this visitor already has too many jobs.
function jobAllowance(req, res, next) {
  const error = checkJobAllowance(req.ip);
  if (error) return res.status(429).json({ error });
  next();
}

const router = express.Router();

function pick(value, allowed, fallback = null) {
  return allowed.includes(value) ? value : fallback;
}

function readOptions(body, targetFormat) {
  const num = (v) => (v === undefined || v === '' ? null : Number(v));
  const targetSizeMB = num(body.targetSizeMB);
  const codecChoices = (CODECS_FOR[targetFormat] || []).filter((c) => hasEncoder(ENCODER[c]));
  return {
    resolution: pick(num(body.resolution), RESOLUTIONS),
    trimStart: parseTime(body.trimStart),
    trimEnd: parseTime(body.trimEnd),
    fastCut: body.fastCut === '1' || body.fastCut === 'true',
    targetSizeMB: Number.isFinite(targetSizeMB) && targetSizeMB >= 1 && targetSizeMB <= 100000 ? targetSizeMB : null,
    quality: pick(body.quality, QUALITY_PRESETS, 'original'),
    codec: pick(body.codec, codecChoices, codecChoices[0] || null),
    audioBitrate: pick(num(body.audioBitrate), AUDIO_BITRATES),
    fps: pick(num(body.fps), FPS_OPTIONS),
    rotate: pick(num(body.rotate), [90, 180, 270]),
    mute: body.mute === '1' || body.mute === 'true',
    normalize: body.normalize === '1' || body.normalize === 'true',
  };
}

router.post('/start', jobAllowance, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }
  const discard = () => fs.promises.unlink(req.file.path).catch(() => {});

  const targetFormat = String(req.body.format || '').toLowerCase();
  if (!ALLOWED_FORMATS.has(targetFormat)) {
    discard();
    return res.status(400).json({ error: 'Unsupported target format.' });
  }
  const opts = readOptions(req.body, targetFormat);
  const isAudioTarget = AUDIO_FORMATS.includes(targetFormat);

  // Check the upload by its content, not its name.
  let metadata;
  try {
    metadata = await probe(req.file.path);
  } catch {
    discard();
    return res.status(400).json({ error: "That file isn't a video or audio file this server can read." });
  }
  const streams = metadata.streams || [];
  const videoStream = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  if (!videoStream && !audioStream) {
    discard();
    return res.status(400).json({ error: "That file doesn't contain any video or audio." });
  }
  if (isAudioTarget && !audioStream) {
    discard();
    return res.status(400).json({ error: 'That file has no audio track to convert.' });
  }
  if (!isAudioTarget && !videoStream) {
    discard();
    return res.status(400).json({ error: 'That file has no video. Pick an audio format instead.' });
  }

  const sourceDuration = Number(metadata.format?.duration) || 0;
  const start = opts.trimStart || 0;
  const end = opts.trimEnd && (!sourceDuration || opts.trimEnd <= sourceDuration) ? opts.trimEnd : null;
  if (end !== null && end <= start) {
    discard();
    return res.status(400).json({ error: 'The trim end time must be after the start time.' });
  }
  if (sourceDuration && start >= sourceDuration) {
    discard();
    return res.status(400).json({ error: 'The trim start time is past the end of the file.' });
  }
  const duration = (end ?? sourceDuration) - start;
  if (opts.targetSizeMB && !(duration > 0)) {
    discard();
    return res.status(400).json({ error: "Couldn't read this file's length, so it can't be compressed to a target size." });
  }

  const jobId = uuidv4();
  const originalName = sanitize(path.parse(req.file.originalname).name).slice(0, 80) || 'converted';
  const outputPath = path.join(OUTPUT_DIR, `${jobId}.${targetFormat}`);
  const suffix = start || end !== null ? ' (trimmed)' : '';

  createJob(jobId, {
    ip: req.ip,
    kind: 'convert',
    uploadPath: req.file.path,
    outputPath,
    downloadName: `${originalName}${suffix}.${targetFormat}`,
    format: targetFormat,
  });
  res.json({ jobId });

  const fullOpts = {
    ...opts,
    start,
    end,
    duration,
    hasAudio: Boolean(audioStream),
    videoCodec: videoStream?.codec_name || null,
    audioCodec: audioStream?.codec_name || null,
  };
  runWhenReady(jobId, () => runConversion(jobId, req.file.path, outputPath, targetFormat, fullOpts));
});

function videoFilters(opts, targetFormat) {
  const filters = [];
  if (targetFormat === 'gif') {
    filters.push(`fps=${Math.min(opts.fps || 12, 15)}`);
    const gifWidth = opts.resolution ? Math.round((opts.resolution * 16) / 9) : 480;
    filters.push(`scale='min(${gifWidth},iw)':-1:flags=lanczos`);
  } else {
    // Only ever scale down; -2 keeps the width even, which most encoders require.
    if (opts.resolution) filters.push(`scale=-2:'min(${opts.resolution},ih)'`);
    if (opts.fps) filters.push(`fps=${opts.fps}`);
  }
  if (opts.rotate === 90) filters.push('transpose=1');
  if (opts.rotate === 180) filters.push('transpose=1,transpose=1');
  if (opts.rotate === 270) filters.push('transpose=2');
  return filters;
}

function canFastCut(opts, targetFormat) {
  return opts.fastCut && targetFormat !== 'gif' && !AUDIO_FORMATS.includes(targetFormat)
    && !opts.resolution && !opts.fps && !opts.rotate && !opts.targetSizeMB && !opts.normalize;
}

function fits(table, format, codec) {
  const allowed = table[format];
  return Boolean(codec) && (allowed === ANY || (Array.isArray(allowed) && allowed.includes(codec)));
}

// Can the video stream be copied unchanged? (Trimming a copied stream can only
// cut at keyframes, so that needs the visitor to opt in with "Fast cut".)
function canCopyVideo(opts, targetFormat) {
  if (opts.quality !== 'original' || targetFormat === 'gif' || AUDIO_FORMATS.includes(targetFormat)) return false;
  if (opts.resolution || opts.fps || opts.rotate || opts.targetSizeMB) return false;
  if ((opts.start || opts.end !== null) && !opts.fastCut) return false;
  return fits(VIDEO_COPY, targetFormat, opts.videoCodec);
}

function canCopyAudio(opts, targetFormat) {
  if (!opts.hasAudio || opts.mute || opts.normalize || opts.audioBitrate || opts.targetSizeMB) return false;
  return fits(AUDIO_COPY, targetFormat, opts.audioCodec);
}

// Quality/bitrate arguments for the chosen encoder (software or hardware).
function videoEncoderArgs(codec, hwEncoder, opts, targetFormat, videoKbps) {
  const preset = opts.quality === 'original' ? 'high' : opts.quality;
  const args = [];
  if (hwEncoder) {
    const q = CRF[codec][preset] + 1;
    args.push('-c:v', hwEncoder);
    if (hwEncoder.endsWith('_nvenc')) args.push('-preset', 'p5', ...(videoKbps ? [] : ['-rc', 'vbr', '-cq', String(q), '-b:v', '0']));
    else if (hwEncoder.endsWith('_qsv')) args.push('-preset', 'medium', ...(videoKbps ? [] : ['-global_quality', String(q)]));
    else if (hwEncoder.endsWith('_amf')) args.push('-quality', 'balanced', ...(videoKbps ? [] : ['-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q), '-qp_b', String(q + 2)]));
    else if (hwEncoder.endsWith('_videotoolbox')) args.push(...(videoKbps ? [] : ['-q:v', String({ high: 70, balanced: 58, small: 45 }[preset])]));
    else if (hwEncoder.endsWith('_vaapi')) args.push(...(videoKbps ? [] : ['-qp', String(q)]));
    if (!hwEncoder.endsWith('_vaapi')) args.push('-pix_fmt', hwEncoder.endsWith('_qsv') ? 'nv12' : 'yuv420p');
  } else {
    args.push('-c:v', ENCODER[codec]);
    if (codec === 'h264') args.push('-preset', 'veryfast', '-pix_fmt', 'yuv420p');
    if (codec === 'h265') args.push('-preset', 'fast', '-pix_fmt', 'yuv420p');
    if (codec === 'vp9') args.push('-deadline', 'good', '-cpu-used', '4', '-row-mt', '1');
    if (!videoKbps) {
      args.push('-crf', String(CRF[codec][preset]));
      if (codec === 'vp9') args.push('-b:v', '0');
    }
  }
  if (codec === 'h265' && targetFormat !== 'mkv') args.push('-tag:v', 'hvc1'); // plays on Apple devices
  if (videoKbps) args.push('-b:v', `${videoKbps}k`, '-maxrate', `${Math.round(videoKbps * 1.4)}k`, '-bufsize', `${videoKbps * 2}k`);
  return args;
}

function pickHardwareEncoder(codec, allowHardware) {
  if (!allowHardware || !getConfig().hardwareEncoding) return null;
  return hardware[codec] || null;
}

function runConversion(jobId, inputPath, outputPath, targetFormat, opts, { allowHardware = true } = {}) {
  const command = ffmpeg(inputPath);
  const isAudioTarget = AUDIO_FORMATS.includes(targetFormat);
  const out = ['-map_metadata', '-1', '-map_chapters', '-1']; // drop location, device and other metadata
  let usedHardware = null;
  let copied = false;

  if (opts.start) command.inputOptions(['-ss', String(opts.start)]);
  if (opts.end !== null) out.push('-t', String(opts.end - opts.start));

  if (canFastCut(opts, targetFormat)) {
    out.push('-map', '0:v:0?', '-map', '0:a?', '-c', 'copy');
    if (opts.mute) out.push('-an');
    copied = true;
  } else if (targetFormat === 'gif') {
    out.push('-vf', videoFilters(opts, targetFormat).join(','), '-loop', '0', '-an');
  } else if (isAudioTarget) {
    out.push('-map', '0:a:0', '-vn');
    if (canCopyAudio(opts, targetFormat)) {
      out.push('-c:a', 'copy');
      copied = true;
    } else {
      if (LOSSY_AUDIO.has(targetFormat)) out.push('-b:a', `${opts.audioBitrate || (targetFormat === 'mp3' ? 192 : 160)}k`);
      if (opts.normalize) out.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000');
    }
  } else {
    out.push('-map', '0:v:0');
    if (opts.hasAudio && !opts.mute) out.push('-map', '0:a:0');

    // Video stream
    let videoKbps = 0;
    let audioKbps = opts.audioBitrate || 160;
    if (opts.targetSizeMB) {
      // Bitrate budget: target size (with a little headroom for the container) spread over the duration.
      const totalKbps = (opts.targetSizeMB * 8 * 1024 * 0.95) / opts.duration;
      audioKbps = opts.mute || !opts.hasAudio ? 0 : Math.min(audioKbps, totalKbps < 600 ? 64 : 128);
      videoKbps = Math.max(50, Math.floor(totalKbps - audioKbps));
    }

    if (canCopyVideo(opts, targetFormat)) {
      out.push('-c:v', 'copy');
      if (opts.videoCodec === 'hevc' && targetFormat !== 'mkv') out.push('-tag:v', 'hvc1');
      copied = true;
    } else {
      const filters = videoFilters(opts, targetFormat);
      const codec = opts.codec;
      const hwEncoder = codec === 'h264' || codec === 'h265' ? pickHardwareEncoder(codec, allowHardware) : null;
      if (hwEncoder?.endsWith('_vaapi')) {
        command.inputOptions(['-vaapi_device', VAAPI_DEVICE]);
        filters.push('format=nv12', 'hwupload');
      }
      if (filters.length) out.push('-vf', filters.join(','));
      if (codec) {
        out.push(...videoEncoderArgs(codec, hwEncoder, opts, targetFormat, videoKbps));
        usedHardware = hwEncoder;
      } else if (targetFormat === 'avi') {
        if (videoKbps) out.push('-b:v', `${videoKbps}k`);
        else out.push('-q:v', { original: '3', high: '3', balanced: '5', small: '9' }[opts.quality]);
      }
    }

    // Audio stream
    if (opts.mute || !opts.hasAudio) {
      out.push('-an');
    } else if (canCopyAudio(opts, targetFormat)) {
      out.push('-c:a', 'copy');
    } else {
      if (targetFormat === 'webm') out.push('-c:a', 'libopus');
      else if (targetFormat !== 'avi') out.push('-c:a', 'aac');
      out.push('-b:a', `${audioKbps}k`);
      if (opts.normalize) out.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000');
    }
    if (targetFormat === 'mp4' || targetFormat === 'mov') out.push('-movflags', '+faststart');
  }

  command.outputOptions(out);

  updateJob(jobId, {
    stage: copied ? 'copying' : usedHardware ? 'hardware' : 'encoding',
    cancel: () => {
      updateJob(jobId, { cancelled: true, status: 'error', error: 'Conversion cancelled.' });
      command.kill('SIGKILL');
    },
  });

  return new Promise((resolve) => {
    command
      .toFormat(targetFormat === 'aac' ? 'adts' : targetFormat === 'mkv' ? 'matroska' : targetFormat)
      .on('progress', (progress) => {
        let percent = 0;
        if (opts.duration > 0 && progress.timemark) {
          percent = (timemarkToSeconds(progress.timemark) / opts.duration) * 100;
        } else if (progress.percent) {
          percent = progress.percent;
        }
        updateJob(jobId, { percent: Math.max(0, Math.min(99, Math.round(percent || 0))) });
      })
      .on('error', (err) => {
        fs.promises.unlink(outputPath).catch(() => {});
        if (getJob(jobId)?.cancelled) {
          fs.promises.unlink(inputPath).catch(() => {});
          return resolve();
        }
        // A GPU encoder can fail on input it doesn't like (size, pixel format):
        // try again in software rather than failing the visitor's job.
        if (usedHardware) {
          console.warn(`Hardware encoder ${usedHardware} failed for ${jobId}, retrying in software: ${err.message}`);
          updateJob(jobId, { percent: 0 });
          return resolve(runConversion(jobId, inputPath, outputPath, targetFormat, opts, { allowHardware: false }));
        }
        fs.promises.unlink(inputPath).catch(() => {});
        const fastCutHint = canFastCut(opts, targetFormat) ? ' Try again with “Fast cut” turned off.' : '';
        console.error(`Conversion ${jobId} failed:`, err.message);
        updateJob(jobId, { status: 'error', error: `Conversion failed.${fastCutHint}` });
        resolve();
      })
      .on('end', () => {
        fs.promises.unlink(inputPath).catch(() => {});
        updateJob(jobId, { status: 'done', percent: 100, copied, encoder: usedHardware });
        resolve();
      })
      .save(outputPath);
  });
}

function timemarkToSeconds(timemark) {
  const parts = timemark.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, val) => acc * 60 + val, 0);
}

router.get('/progress/:jobId', streamJobProgress(getJob));

router.post('/cancel/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.kind !== 'convert' || job.status === 'done' || job.status === 'error') {
    return res.status(404).json({ error: 'Nothing to cancel.' });
  }
  if (typeof job.cancel === 'function') job.cancel();
  else updateJob(job.id, { cancelled: true, status: 'error', error: 'Conversion cancelled.' });
  res.json({ ok: true });
});

router.get('/result/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.kind !== 'convert' || job.status !== 'done') {
    return res.status(404).json({ error: 'This file has expired or does not exist.' });
  }
  res.download(job.outputPath, job.downloadName, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'This file has expired or does not exist.' });
  });
});

router.get('/formats', (req, res) => {
  const codecs = {};
  for (const [fmt, list] of Object.entries(CODECS_FOR)) codecs[fmt] = list.filter((c) => hasEncoder(ENCODER[c]));
  res.json({
    video: VIDEO_FORMATS,
    audio: AUDIO_FORMATS,
    resolutions: RESOLUTIONS,
    fps: FPS_OPTIONS,
    audioBitrates: AUDIO_BITRATES,
    lossyAudio: [...LOSSY_AUDIO],
    qualities: QUALITY_PRESETS,
    codecs,
  });
});

module.exports = router;
