const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sanitize = require('sanitize-filename');
const ffmpeg = require('fluent-ffmpeg');
const { getUniqueDestination } = require('../utils/uniqueFile');
const { createSession, getSession } = require('../utils/imageSessions');

const UPLOAD_WORK_DIR = path.join(__dirname, '..', 'tmp', 'image-uploads');
const FRAMES_WORK_DIR = path.join(__dirname, '..', 'tmp', 'gif-frames');
const SAVES_UPLOADED_DIR = path.join(__dirname, '..', 'Saves', 'Uploaded');

fs.mkdirSync(UPLOAD_WORK_DIR, { recursive: true });
fs.mkdirSync(FRAMES_WORK_DIR, { recursive: true });
fs.mkdirSync(SAVES_UPLOADED_DIR, { recursive: true });

const FRAME_CAP = 200;
const ACCEPTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.gif', '.webm']);
const TARGET_FORMATS = ['png', 'jpg', 'bmp', 'tif', 'gif', 'webm'];
const STILL_FORMATS = new Set(['png', 'jpg', 'bmp', 'tif']);
const STILL_CODEC = { png: 'png', jpg: 'mjpeg', bmp: 'bmp', tif: 'tiff' };
const STILL_MIME = { png: 'image/png', jpg: 'image/jpeg', bmp: 'image/bmp', tif: 'image/tiff' };

function buildConversionCommand(inputPath, format) {
  const command = ffmpeg(inputPath);
  if (STILL_FORMATS.has(format)) {
    command.outputOptions(['-frames:v', '1']).videoCodec(STILL_CODEC[format]).format('image2pipe');
  } else if (format === 'gif') {
    command.outputOptions(['-loop', '0']).format('gif');
  } else if (format === 'webm') {
    command.videoCodec('libvpx-vp9').format('webm');
  }
  return command;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_WORK_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
});

const router = express.Router();

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.has(ext)) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Unsupported file type.' });
  }

  try {
    const baseName = sanitize(path.parse(req.file.originalname).name).slice(0, 80) || 'image';
    const destPath = await getUniqueDestination(SAVES_UPLOADED_DIR, baseName, ext);
    await fs.promises.rename(req.file.path, destPath);

    const uploadId = uuidv4();
    const isGif = ext === '.gif';
    let framesDir = null;
    let frameCount = 0;
    let truncated = false;

    if (isGif) {
      framesDir = path.join(FRAMES_WORK_DIR, uploadId);
      await fs.promises.mkdir(framesDir, { recursive: true });

      await new Promise((resolve, reject) => {
        ffmpeg(destPath)
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
      savedPath: destPath,
      originalBaseName: baseName,
      framesDir,
      frameCount,
    });

    res.json({
      uploadId,
      originalName: path.basename(destPath),
      isGif,
      frameCount,
      truncated,
    });
  } catch {
    res.status(500).json({ error: 'Could not process the uploaded file.' });
  }
});

router.get('/frame/:uploadId/:frameNumber', (req, res) => {
  const session = getSession(req.params.uploadId);
  const n = parseInt(req.params.frameNumber, 10);
  if (!session || !session.framesDir || !Number.isInteger(n) || n < 1 || n > session.frameCount) {
    return res.status(404).end();
  }
  const filePath = path.join(session.framesDir, `frame-${String(n).padStart(4, '0')}.png`);
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

router.get('/frame/:uploadId/:frameNumber/download', (req, res) => {
  const session = getSession(req.params.uploadId);
  const n = parseInt(req.params.frameNumber, 10);
  if (!session || !session.framesDir || !Number.isInteger(n) || n < 1 || n > session.frameCount) {
    return res.status(404).json({ error: 'Frame not found.' });
  }
  const filePath = path.join(session.framesDir, `frame-${String(n).padStart(4, '0')}.png`);
  res.download(filePath, `${session.originalBaseName} - frame ${n}.png`);
});

router.post('/convert', express.json(), (req, res) => {
  const { uploadId, format } = req.body || {};
  const session = getSession(uploadId);
  if (!session) {
    return res.status(404).json({ error: 'Upload not found or expired. Please re-upload the file.' });
  }
  if (!TARGET_FORMATS.includes(format)) {
    return res.status(400).json({ error: 'Unsupported target format.' });
  }

  const outName = `${session.originalBaseName}.${format}`;
  const mimeType = STILL_MIME[format] || (format === 'gif' ? 'image/gif' : 'video/webm');

  res.set('Content-Type', mimeType);
  res.set('Content-Disposition', `attachment; filename="${outName}"`);

  buildConversionCommand(session.savedPath, format)
    .on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'Conversion failed.' });
      else res.end();
    })
    .pipe(res, { end: true });
});

router.get('/formats', (req, res) => {
  res.json({ formats: TARGET_FORMATS });
});

module.exports = router;
