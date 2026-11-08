const path = require('path');
const fs = require('fs');
const express = require('express');
const { tmp } = require('../utils/paths');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sanitize = require('sanitize-filename');
const ffmpeg = require('fluent-ffmpeg');
const { getConfig } = require('../utils/config');
const { createSession, getSession } = require('../utils/imageSessions');
const { createJob, getJob, updateJob, runWhenReady, checkJobAllowance } = require('../utils/jobs');
const { streamJobProgress } = require('../utils/sse');
const { probe, keepCopyIfEnabled } = require('../utils/media');
const { hasEncoder, features } = require('../utils/ffmpegCaps');
const { readJpegOrientation } = require('../utils/exif');

const UPLOAD_WORK_DIR = tmp('image-uploads');
const FRAMES_WORK_DIR = tmp('gif-frames');
const OUTPUT_DIR = tmp('image-output');
for (const dir of [UPLOAD_WORK_DIR, FRAMES_WORK_DIR, OUTPUT_DIR]) fs.mkdirSync(dir, { recursive: true });

const FRAME_CAP = 200;
const BASE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.gif', '.webp', '.avif', '.webm'];
// HEIC/HEIF (e.g. iPhone photos) need ffmpeg 7.1 or newer; see VIDGET_FFMPEG.
const ACCEPTED_EXTENSIONS = new Set([...BASE_EXTENSIONS, ...(features.heif ? ['.heic', '.heif'] : [])]);
const STILL_FORMATS = new Set(['png', 'jpg', 'bmp', 'tif', 'webp', 'avif']);
const QUALITY_FORMATS = ['jpg', 'webp', 'avif'];
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', bmp: 'image/bmp', tif: 'image/tiff', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', webm: 'video/webm',
};

function availableFormats() {
  const formats = ['png', 'jpg'];
  if (hasEncoder('libwebp')) formats.push('webp');
  if (hasEncoder('libaom-av1')) formats.push('avif');
  formats.push('bmp', 'tif', 'gif');
  if (hasEncoder('libvpx-vp9')) formats.push('webm');
  return formats;
}

function scaleFilter(maxWidth, maxHeight) {
  if (!maxWidth && !maxHeight) return null;
  const w = maxWidth ? `'min(${maxWidth},iw)'` : '-2';
  const h = maxHeight ? `'min(${maxHeight},ih)'` : '-2';
  const fit = maxWidth && maxHeight ? ':force_original_aspect_ratio=decrease:force_divisible_by=2' : '';
  return `scale=w=${w}:h=${h}${fit}:flags=lanczos`;
}

function buildConversionCommand(inputPath, format, { quality, maxWidth, maxHeight, animated }) {
  const command = ffmpeg(inputPath);
  const out = ['-map_metadata', '-1']; // never pass on EXIF/GPS/camera data
  const filters = [];
  const scale = scaleFilter(maxWidth, maxHeight);
  if (scale) filters.push(scale);
  const q = quality ?? 85;

  if (STILL_FORMATS.has(format) && !(format === 'webp' && animated)) out.push('-frames:v', '1');

  switch (format) {
    case 'png': out.push('-c:v', 'png'); break;
    case 'bmp': out.push('-c:v', 'bmp'); break;
    case 'tif': out.push('-c:v', 'tiff'); break;
    case 'jpg':
      out.push('-c:v', 'mjpeg', '-q:v', String(Math.round(2 + ((100 - q) * 29) / 100)));
      filters.push('format=yuvj420p');
      break;
    case 'webp':
      out.push('-c:v', animated ? 'libwebp_anim' : 'libwebp', '-quality', String(q));
      if (animated) out.push('-loop', '0');
      break;
    case 'avif':
      out.push('-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(Math.round(63 - (q * 45) / 100)), '-cpu-used', '6');
      filters.push('format=yuv420p');
      break;
    case 'gif':
      out.push('-loop', '0');
      break;
    case 'webm':
      out.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-an');
      filters.push('format=yuv420p');
      break;
    default:
      break;
  }
  if (filters.length) out.push('-vf', filters.join(','));
  command.outputOptions(out).format(format === 'jpg' || format === 'png' || format === 'bmp' || format === 'tif' ? 'image2' : format);
  return command;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_WORK_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase().slice(0, 6)}`),
});

// The size limit is read per request so changes from the admin portal apply immediately.
const upload = {
  single: (field) => (req, res, next) =>
    multer({ storage, limits: { fileSize: getConfig().limits.imageUploadMB * 1024 * 1024, files: 1 } }).single(field)(req, res, next),
};

const router = express.Router();

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }
  const discard = () => fs.promises.unlink(req.file.path).catch(() => {});

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.has(ext)) {
    discard();
    return res.status(400).json({ error: 'Unsupported file type.' });
  }

  // Check the upload by its content, not its name.
  let metadata;
  try {
    metadata = await probe(req.file.path);
  } catch {
    discard();
    return res.status(400).json({ error: "That file isn't an image this server can read." });
  }
  const video = (metadata.streams || []).find((s) => s.codec_type === 'video');
  if (!video) {
    discard();
    return res.status(400).json({ error: "That file doesn't contain an image." });
  }

  try {
    const baseName = sanitize(path.parse(req.file.originalname).name).slice(0, 80) || 'image';
    await keepCopyIfEnabled(req.file.path, 'Uploaded', baseName, ext);

    const uploadId = uuidv4();
    const isGif = ext === '.gif';
    // Animated WebP is only decodable by newer ffmpeg builds (checked at startup).
    const animatedWebp = ext === '.webp' && features.animatedWebp && metadata.format.duration > 0.1;
    const animated = isGif || ext === '.webm' || animatedWebp;
    let framesDir = null;
    let frameCount = 0;
    let truncated = false;

    // ffmpeg rotates photos by their EXIF orientation when decoding; report the size as seen.
    let { width, height } = video;
    if ((ext === '.jpg' || ext === '.jpeg') && (await readJpegOrientation(req.file.path)) >= 5) {
      [width, height] = [height, width];
    }

    if (isGif || animatedWebp) {
      framesDir = path.join(FRAMES_WORK_DIR, uploadId);
      await fs.promises.mkdir(framesDir, { recursive: true });

      await new Promise((resolve, reject) => {
        ffmpeg(req.file.path)
          .outputOptions(['-frames:v', String(FRAME_CAP)])
          .output(path.join(framesDir, 'frame-%04d.png'))
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      const files = await fs.promises.readdir(framesDir);
      frameCount = files.length;
      truncated = frameCount >= FRAME_CAP;
    }

    createSession(uploadId, {
      uploadPath: req.file.path,
      originalBaseName: baseName,
      framesDir,
      frameCount,
      animated,
      width: width || null,
      height: height || null,
    });

    res.json({
      uploadId,
      originalName: `${baseName}${ext}`,
      isGif: isGif || animatedWebp,
      animated,
      width: width || null,
      height: height || null,
      frameCount,
      truncated,
    });
  } catch {
    discard();
    res.status(500).json({ error: 'Could not process the uploaded file.' });
  }
});

function frameFile(session, n) {
  return path.join(session.framesDir, `frame-${String(n).padStart(4, '0')}.png`);
}

function getFrame(req) {
  const session = getSession(req.params.uploadId);
  const n = parseInt(req.params.frameNumber, 10);
  if (!session || !session.framesDir || !Number.isInteger(n) || n < 1 || n > session.frameCount) return null;
  return { session, n };
}

router.get('/frame/:uploadId/:frameNumber', (req, res) => {
  const found = getFrame(req);
  if (!found) return res.status(404).end();
  res.sendFile(frameFile(found.session, found.n), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

router.get('/frame/:uploadId/:frameNumber/download', (req, res) => {
  const found = getFrame(req);
  if (!found) return res.status(404).json({ error: 'Frame not found.' });
  res.download(frameFile(found.session, found.n), `${found.session.originalBaseName} - frame ${found.n}.png`);
});

router.post('/convert', (req, res) => {
  const { uploadId, format } = req.body || {};
  const session = getSession(uploadId);
  if (!session) {
    return res.status(404).json({ error: 'Upload not found or expired. Please re-upload the file.' });
  }
  if (!availableFormats().includes(format)) {
    return res.status(400).json({ error: 'Unsupported target format.' });
  }
  const allowance = checkJobAllowance(req.ip);
  if (allowance) return res.status(429).json({ error: allowance });

  const int = (v, min, max) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const opts = {
    quality: QUALITY_FORMATS.includes(format) ? int(req.body.quality, 1, 100) : null,
    maxWidth: int(req.body.maxWidth, 1, 16384),
    maxHeight: int(req.body.maxHeight, 1, 16384),
    animated: session.animated,
  };

  const jobId = uuidv4();
  const outputPath = path.join(OUTPUT_DIR, `${jobId}.${format}`);
  createJob(jobId, {
    ip: req.ip,
    kind: 'image',
    outputPath,
    downloadName: `${session.originalBaseName}.${format}`,
    mime: MIME[format],
  });
  res.json({ jobId });

  runWhenReady(jobId, () => new Promise((resolve) => {
    const command = buildConversionCommand(session.uploadPath, format, opts);
    updateJob(jobId, {
      cancel: () => {
        updateJob(jobId, { cancelled: true, status: 'error', error: 'Conversion cancelled.' });
        command.kill('SIGKILL');
      },
    });
    command
      .on('progress', (p) => updateJob(jobId, { percent: Math.max(0, Math.min(99, Math.round(p.percent || 0))) }))
      .on('error', (err) => {
        fs.promises.unlink(outputPath).catch(() => {});
        if (!getJob(jobId)?.cancelled) {
          console.error(`Image conversion ${jobId} failed:`, err.message);
          updateJob(jobId, { status: 'error', error: 'Conversion failed.' });
        }
        resolve();
      })
      .on('end', () => {
        updateJob(jobId, { status: 'done', percent: 100 });
        resolve();
      })
      .save(outputPath);
  }));
});

router.get('/progress/:jobId', streamJobProgress(getJob));

router.post('/cancel/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.kind !== 'image' || job.status === 'done' || job.status === 'error' || typeof job.cancel !== 'function') {
    return res.status(404).json({ error: 'Nothing to cancel.' });
  }
  job.cancel();
  res.json({ ok: true });
});

router.get('/result/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.kind !== 'image' || job.status !== 'done') {
    return res.status(404).json({ error: 'This file has expired or does not exist.' });
  }
  if (job.mime) res.type(job.mime);
  res.download(job.outputPath, job.downloadName, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'This file has expired or does not exist.' });
  });
});

router.get('/formats', (req, res) => {
  res.json({ formats: availableFormats(), qualityFormats: QUALITY_FORMATS, accepted: [...ACCEPTED_EXTENSIONS].map((e) => e.slice(1)) });
});

module.exports = router;
