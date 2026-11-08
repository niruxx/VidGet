const fs = require('fs');
const { getConfig } = require('./config');

// Uploaded images live in tmp/ only for as long as the visitor might still
// convert them; then the upload and any extracted GIF frames are deleted.
const sessions = new Map();

function createSession(id, data) {
  const session = { id, ...data };
  sessions.set(id, session);
  scheduleCleanup(id);
  return session;
}

function getSession(id) {
  return sessions.get(id);
}

function scheduleCleanup(id) {
  const ttlMs = getConfig().storage.resultTtlMinutes * 60 * 1000;
  setTimeout(() => {
    const session = sessions.get(id);
    if (!session) return;
    if (session.framesDir) fs.promises.rm(session.framesDir, { recursive: true, force: true }).catch(() => {});
    if (session.uploadPath) fs.promises.unlink(session.uploadPath).catch(() => {});
    sessions.delete(id);
  }, ttlMs).unref();
}

function knownSessionPaths() {
  const paths = new Set();
  for (const s of sessions.values()) {
    if (s.uploadPath) paths.add(s.uploadPath);
    if (s.framesDir) paths.add(s.framesDir);
  }
  return paths;
}

module.exports = { createSession, getSession, knownSessionPaths };
