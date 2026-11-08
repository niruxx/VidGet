const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { FFMPEG_PATH: ffmpegPath } = require('./paths');
const { getConfig } = require('./config');
const { getUniqueDestination } = require('./uniqueFile');

const { SAVES_DIR } = require('./paths');

// Reads basic stream info with the bundled ffmpeg (the bundled ffprobe is too
// old for AVIF, AV1 and similar). Rejects if ffmpeg can't find a usable
// video or audio stream, so uploads are checked by content, not by name.
function probe(filePath) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', '-i', filePath];
    execFile(ffmpegPath, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const text = String(stderr || '');
      const streams = [];
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*Stream #\d+:\d+.*?: (Video|Audio): (\w+)(.*)$/);
        if (!m) continue;
        if (m[1] === 'Audio') {
          streams.push({ codec_type: 'audio', codec_name: m[2] });
          continue;
        }
        const size = m[3].match(/, (\d{1,5})x(\d{1,5})(?=[ ,]|$)/);
        if (!size || Number(size[1]) === 0 || Number(size[2]) === 0) continue; // bogus or undecodable
        streams.push({
          codec_type: 'video',
          codec_name: m[2],
          width: Number(size[1]),
          height: Number(size[2]),
          disposition: { attached_pic: /\(attached pic\)/.test(m[3]) },
        });
      }
      if (!streams.length) return reject(new Error('No readable streams.'));
      const d = text.match(/Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
      const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
      resolve({ streams, format: { duration } });
    });
  });
}

// When the admin has turned on "keep copies", store a copy of a finished file
// in Saves/<subdir>. Visitors are always served the temp copy.
async function keepCopyIfEnabled(srcPath, subdir, baseName, ext) {
  if (!getConfig().storage.keepCopies) return;
  try {
    const dir = path.join(SAVES_DIR, subdir);
    await fs.promises.mkdir(dir, { recursive: true });
    const dest = await getUniqueDestination(dir, baseName, ext);
    await fs.promises.copyFile(srcPath, dest);
  } catch (err) {
    console.error('Could not keep a copy in Saves/:', err.message);
  }
}

// "1:23", "01:02:03", "83.5" -> seconds; null when empty/invalid.
function parseTime(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const parts = String(value).trim().split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

module.exports = { probe, keepCopyIfEnabled, parseTime };
