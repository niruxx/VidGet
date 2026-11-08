const fs = require('fs');
const path = require('path');
const { knownJobPaths } = require('./jobs');
const { knownSessionPaths } = require('./imageSessions');

const { TMP_DIR } = require('./paths');
const STALE_MS = 6 * 60 * 60 * 1000;

// Deletes leftovers in tmp/: abandoned .part files, outputs of jobs that no
// longer exist, frames from expired GIF sessions. On startup no job can still
// be using anything, so everything goes; afterwards only files that are old
// and not owned by a live job are removed.
async function sweepTemp({ startup = false } = {}) {
  const keep = startup ? new Set() : new Set([...knownJobPaths(), ...knownSessionPaths()]);
  const now = Date.now();
  let removed = 0;

  const subdirs = await fs.promises.readdir(TMP_DIR, { withFileTypes: true }).catch(() => []);
  for (const sub of subdirs) {
    if (!sub.isDirectory()) continue;
    const dir = path.join(TMP_DIR, sub.name);
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === '.gitkeep') continue;
      const full = path.join(dir, entry.name);
      if (keep.has(full)) continue;
      if (!startup) {
        const st = await fs.promises.stat(full).catch(() => null);
        if (!st || now - st.mtimeMs < STALE_MS) continue;
      }
      await fs.promises.rm(full, { recursive: true, force: true }).then(() => removed++).catch(() => {});
    }
  }
  return removed;
}

module.exports = { sweepTemp };
