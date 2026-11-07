const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const { createJob, getJob, updateJob } = require('../utils/jobs');
const { streamJobProgress } = require('../utils/sse');

const UPLOAD_DIR = path.join(__dirname, '..', 'tmp', 'uploads');
const OUTPUT_DIR = path.join(__dirname, '..', 'tmp', 'converted');

const VIDEO_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'gif'];
const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'aac', 'ogg'];
const ALLOWED_FORMATS = new Set([...VIDEO_FORMATS, ...AUDIO_FORMATS]);
const RESOLUTIONS = [2160, 1440, 1080, 720, 480, 360];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

const router = express.Router();

router.post('/start', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const targetFormat = String(req.body.format || '').toLowerCase();
  if (!ALLOWED_FORMATS.has(targetFormat)) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Unsupported target format.' });
  }

  const height = Number(req.body.resolution);
  const resolution = RESOLUTIONS.includes(height) ? height : null;

  const jobId = uuidv4();
  const originalName = path.parse(req.file.originalname).name;
  const outputPath = path.join(OUTPUT_DIR, `${jobId}.${targetFormat}`);

  createJob(jobId, {
    uploadPath: req.file.path,
    outputPath,
    downloadName: `${originalName}.${targetFormat}`,
    format: targetFormat,
  });

  res.json({ jobId });
  runConversion(jobId, req.file.path, outputPath, targetFormat, resolution);
});

function runConversion(jobId, inputPath, outputPath, targetFormat, resolution) {
  updateJob(jobId, { status: 'processing' });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  ffmpeg.ffprobe(inputPath, (probeErr, metadata) => {
    if (getJob(jobId)?.cancelled) {
      fs.promises.unlink(inputPath).catch(() => {});
      return;
    }
    const durationSec = probeErr ? 0 : Number(metadata?.format?.duration) || 0;

    const command = ffmpeg(inputPath);

    if (targetFormat === 'gif') {
      const gifWidth = resolution ? Math.round((resolution * 16) / 9) : 480;
      command
        .outputOptions(['-vf', `fps=12,scale=${gifWidth}:-1:flags=lanczos`, '-loop', '0']);
    } else if (AUDIO_FORMATS.includes(targetFormat)) {
      command.noVideo();
      if (targetFormat === 'mp3') command.audioBitrate('192k');
    } else if (resolution) {
      // Only ever scale down; -2 keeps the width even, which most encoders require.
      command.outputOptions(['-vf', `scale=-2:'min(${resolution},ih)'`]);
    }

    updateJob(jobId, {
      cancel: () => {
        updateJob(jobId, { cancelled: true, status: 'error', error: 'Conversion cancelled.' });
        command.kill('SIGKILL');
      },
    });

    command
      .toFormat(targetFormat === 'gif' ? 'gif' : targetFormat)
      .on('progress', (progress) => {
        let percent = progress.percent;
        if ((!percent || Number.isNaN(percent)) && durationSec > 0 && progress.timemark) {
          percent = (timemarkToSeconds(progress.timemark) / durationSec) * 100;
        }
        percent = Math.max(0, Math.min(99, Math.round(percent || 0)));
        updateJob(jobId, { percent });
      })
      .on('error', (err) => {
        fs.promises.unlink(inputPath).catch(() => {});
        if (getJob(jobId)?.cancelled) {
          fs.promises.unlink(outputPath).catch(() => {});
          return;
        }
        updateJob(jobId, { status: 'error', error: err.message });
      })
      .on('end', () => {
        updateJob(jobId, { status: 'done', percent: 100 });
        fs.promises.unlink(inputPath).catch(() => {});
      })
      .save(outputPath);
  });
}

function timemarkToSeconds(timemark) {
  const parts = timemark.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduceRight((acc, val, idx, arr) => acc + val * Math.pow(60, arr.length - 1 - idx), 0);
}

router.get('/progress/:jobId', streamJobProgress(getJob));

router.post('/cancel/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.status === 'done' || job.status === 'error') {
    return res.status(404).json({ error: 'Nothing to cancel.' });
  }
  if (typeof job.cancel === 'function') job.cancel();
  else updateJob(job.id, { cancelled: true, status: 'error', error: 'Conversion cancelled.' });
  res.json({ ok: true });
});

router.get('/result/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.status !== 'done') {
    return res.status(404).json({ error: 'Result not available.' });
  }
  res.download(job.outputPath, job.downloadName);
});

router.get('/formats', (req, res) => {
  res.json({ video: VIDEO_FORMATS, audio: AUDIO_FORMATS, resolutions: RESOLUTIONS });
});

module.exports = router;
