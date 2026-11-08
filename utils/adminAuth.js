const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Admin credentials live outside config.json (which is tracked by git) in a
// git-ignored file that only the server process should be able to read.
const { DATA_DIR } = require('./paths');
const ADMIN_PATH = path.join(DATA_DIR, 'admin.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const MIN_PASSWORD_LENGTH = 10;

let admin = loadAdmin();
const sessions = new Map(); // token -> { expires }
const failures = new Map(); // ip -> { count, first }

// One-time token required to claim the instance on first run. It is only
// printed to the server console, so a visitor who finds /admin before the
// owner does can't take over the instance.
let setupToken = admin ? null : crypto.randomBytes(9).toString('base64url');

function loadAdmin() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ADMIN_PATH, 'utf8'));
    if (parsed && typeof parsed.username === 'string' && typeof parsed.hash === 'string' && typeof parsed.salt === 'string') {
      return parsed;
    }
  } catch {
    /* not set up yet */
  }
  return null;
}

function isConfigured() {
  return admin !== null;
}

function getSetupToken() {
  return setupToken;
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    const { keylen, ...opts } = SCRYPT_PARAMS;
    crypto.scrypt(password, Buffer.from(salt, 'base64'), keylen, opts, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('base64'));
    });
  });
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function validateCredentials(username, password) {
  if (typeof username !== 'string' || !/^[\w.@-]{3,64}$/.test(username)) {
    return 'Username must be 3–64 characters: letters, numbers, dots, dashes, underscores or @.';
  }
  return validatePassword(password);
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 256) return 'Password is too long.';
  return null;
}

async function writeAdmin(username, password) {
  const salt = crypto.randomBytes(16).toString('base64');
  const hash = await hashPassword(password, salt);
  const record = {
    username,
    salt,
    hash,
    scrypt: SCRYPT_PARAMS,
    createdAt: admin?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const tmpPath = `${ADMIN_PATH}.tmp`;
  await fs.promises.writeFile(tmpPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  await fs.promises.rename(tmpPath, ADMIN_PATH);
  admin = record;
}

async function setupAdmin({ token, username, password }) {
  if (isConfigured()) return { error: 'This instance is already set up.', status: 409 };
  if (!setupToken || !safeEqual(String(token || '').trim(), setupToken)) {
    return { error: 'Setup token is incorrect. Check the server console for the current token.', status: 403 };
  }
  const problem = validateCredentials(username, password);
  if (problem) return { error: problem, status: 400 };
  await writeAdmin(username, password);
  setupToken = null;
  return { ok: true };
}

function isLockedOut(ip) {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordFailure(ip) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) failures.set(ip, { count: 1, first: Date.now() });
  else entry.count++;
}

async function verifyLogin(ip, username, password) {
  if (!isConfigured()) return { error: 'This instance has not been set up yet.', status: 409 };
  if (isLockedOut(ip)) return { error: 'Too many failed attempts. Try again in 15 minutes.', status: 429 };
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > 256) {
    recordFailure(ip);
    return { error: 'Incorrect username or password.', status: 401 };
  }
  const hash = await hashPassword(password, admin.salt);
  const userOk = safeEqual(username, admin.username);
  const passOk = safeEqual(hash, admin.hash);
  if (!userOk || !passOk) {
    recordFailure(ip);
    return { error: 'Incorrect username or password.', status: 401 };
  }
  failures.delete(ip);
  return { ok: true };
}

async function changeCredentials({ currentPassword, newPassword, newUsername }) {
  const hash = await hashPassword(String(currentPassword || ''), admin.salt);
  if (!safeEqual(hash, admin.hash)) return { error: 'Current password is incorrect.', status: 401 };
  const username = newUsername ? String(newUsername).trim() : admin.username;
  const password = newPassword || currentPassword;
  const problem = validateCredentials(username, password);
  if (problem) return { error: problem, status: 400 };
  await writeAdmin(username, password);
  sessions.clear();
  return { ok: true };
}

function createSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token) {
  sessions.delete(token);
}

function getUsername() {
  return admin?.username || null;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.expires < now) sessions.delete(token);
  for (const [ip, f] of failures) if (now - f.first > LOGIN_WINDOW_MS) failures.delete(ip);
}, 10 * 60 * 1000).unref();

module.exports = {
  ADMIN_PATH,
  SESSION_TTL_MS,
  MIN_PASSWORD_LENGTH,
  isConfigured,
  getSetupToken,
  setupAdmin,
  verifyLogin,
  changeCredentials,
  createSession,
  isValidSession,
  destroySession,
  getUsername,
};
