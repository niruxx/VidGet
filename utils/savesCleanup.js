const fs = require('fs');
const path = require('path');
const { getConfig, isWithinRetention } = require('./config');

const SAVES_DIR = path.join(__dirname, '..', 'Saves');
const SAVES_SUBDIRS = ['video', 'audio', 'Uploaded'];

async function pruneSaves() {
  const { savesRetentionDays } = getConfig();
  if (savesRetentionDays === '*') return;

  for (const sub of SAVES_SUBDIRS) {
    const dir = path.join(SAVES_DIR, sub);
    let files;
    try {
      files = await fs.promises.readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (file === '.gitkeep') continue;
      const filePath = path.join(dir, file);
      try {
        const stat = await fs.promises.stat(filePath);
        if (!isWithinRetention(stat.mtimeMs, savesRetentionDays)) {
          await fs.promises.unlink(filePath).catch(() => {});
        }
      } catch {
        /* file may have been removed concurrently */
      }
    }
  }
}

module.exports = { pruneSaves };
