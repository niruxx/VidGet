const fs = require('fs');

const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

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
  setTimeout(() => {
    const session = sessions.get(id);
    if (!session) return;
    if (session.framesDir) {
      fs.promises.rm(session.framesDir, { recursive: true, force: true }).catch(() => {});
    }
    sessions.delete(id);
  }, SESSION_TTL_MS);
}

module.exports = { createSession, getSession };
