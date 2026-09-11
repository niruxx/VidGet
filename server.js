const path = require('path');
const fs = require('fs');
const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

for (const dir of ['tmp/uploads', 'tmp/converted']) {
  fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
}

const youtubeRouter = require('./routes/youtube');
const convertRouter = require('./routes/convert');
const imageRouter = require('./routes/image');
const { getConfig } = require('./utils/config');
const { pruneLogs } = require('./utils/connectionLog');
const { pruneSaves } = require('./utils/savesCleanup');

const app = express();
const PORT = process.env.PORT || getConfig().port;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/youtube', youtubeRouter);
app.use('/api/convert', convertRouter);
app.use('/api/image', imageRouter);

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
function runPruneSweep() {
  pruneLogs().catch(() => {});
  pruneSaves().catch(() => {});
}
runPruneSweep();
setInterval(runPruneSweep, PRUNE_INTERVAL_MS);

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large (2GB max).' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`Vidget running at http://localhost:${PORT}`);
});
