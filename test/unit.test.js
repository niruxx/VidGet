const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

// Point every path at a scratch directory before any module reads its location.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vidget-unit-'));
process.env.VIDGET_CONFIG = path.join(scratch, 'config.json');
process.env.VIDGET_DATA_DIR = path.join(scratch, 'data');
process.env.VIDGET_TMP_DIR = path.join(scratch, 'tmp');
process.env.VIDGET_SAVES_DIR = path.join(scratch, 'Saves');
process.env.VIDGET_LOGS_DIR = path.join(scratch, 'logs');

const config = require('../utils/config');
const { parseTime } = require('../utils/media');
const { parseOrientation } = require('../utils/exif');
const { rateLimit } = require('../utils/rateLimit');
const jobs = require('../utils/jobs');

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('config: invalid values fall back to defaults and are clamped', () => {
  const saved = config.saveConfig({
    port: 99999,
    siteName: '   ',
    announcement: 'x'.repeat(1000),
    host: 'bad host!',
    limits: { maxQuality: 1234, maxConcurrentJobs: 0, requestsPerMinute: 50 },
    sites: { mode: 'nope', list: 'https://www.YouTube.com/watch?v=1, *.vimeo.com  not a domain' },
    storage: { resultTtlMinutes: 1 },
  });
  assert.equal(saved.port, 3000);
  assert.equal(saved.siteName, 'Vidget');
  assert.equal(saved.announcement.length, 300);
  assert.equal(saved.host, '');
  assert.equal(saved.limits.maxQuality, 0);
  assert.equal(saved.limits.maxConcurrentJobs, 3);
  assert.equal(saved.limits.requestsPerMinute, 50);
  assert.equal(saved.sites.mode, 'all');
  assert.deepEqual(saved.sites.list, ['youtube.com', 'vimeo.com']);
  assert.equal(saved.storage.resultTtlMinutes, 30);
});

test('config: unknown keys in config.json are preserved on save', () => {
  const raw = JSON.parse(fs.readFileSync(process.env.VIDGET_CONFIG, 'utf8'));
  raw.customKey = 'keep me';
  fs.writeFileSync(process.env.VIDGET_CONFIG, JSON.stringify(raw));
  config.saveConfig({ siteName: 'Test' });
  const after = JSON.parse(fs.readFileSync(process.env.VIDGET_CONFIG, 'utf8'));
  assert.equal(after.customKey, 'keep me');
  assert.equal(after.siteName, 'Test');
});

test('config: site allow/blocklist matches subdomains', () => {
  config.saveConfig({ sites: { mode: 'allow', list: ['youtube.com'] } });
  assert.equal(config.isSiteAllowed('www.youtube.com'), true);
  assert.equal(config.isSiteAllowed('m.youtube.com'), true);
  assert.equal(config.isSiteAllowed('notyoutube.com'), false);
  assert.equal(config.isSiteAllowed('vimeo.com'), false);
  config.saveConfig({ sites: { mode: 'block', list: ['vimeo.com'] } });
  assert.equal(config.isSiteAllowed('player.vimeo.com'), false);
  assert.equal(config.isSiteAllowed('youtube.com'), true);
  config.saveConfig({ sites: { mode: 'all', list: [] } });
});

test('config: retention rules', () => {
  const now = Date.now();
  assert.equal(config.isWithinRetention(now, '*'), true);
  assert.equal(config.isWithinRetention(now, 0), false);
  assert.equal(config.isWithinRetention(now - 2 * 864e5, 1), false);
  assert.equal(config.isWithinRetention(now - 0.5 * 864e5, 1), true);
});

test('parseTime understands clock times and seconds', () => {
  assert.equal(parseTime('1:30'), 90);
  assert.equal(parseTime('01:02:03'), 3723);
  assert.equal(parseTime('90.5'), 90.5);
  assert.equal(parseTime(12), 12);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('1:2:3:4'), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(-5), null);
});

function jpegWithOrientation(value, bigEndian = false) {
  const tiff = Buffer.alloc(26);
  const w16 = (v, o) => (bigEndian ? tiff.writeUInt16BE(v, o) : tiff.writeUInt16LE(v, o));
  const w32 = (v, o) => (bigEndian ? tiff.writeUInt32BE(v, o) : tiff.writeUInt32LE(v, o));
  tiff.write(bigEndian ? 'MM' : 'II', 0, 'ascii');
  w16(42, 2); w32(8, 4); w16(1, 8); w16(0x0112, 10); w16(3, 12); w32(1, 14); w16(value, 18); w32(0, 22);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 4);
  return Buffer.concat([header, payload, Buffer.from([0xff, 0xda, 0, 2])]);
}

test('EXIF orientation parser', () => {
  for (const v of [1, 3, 6, 8]) assert.equal(parseOrientation(jpegWithOrientation(v)), v);
  assert.equal(parseOrientation(jpegWithOrientation(6, true)), 6);
  assert.equal(parseOrientation(jpegWithOrientation(42)), 1, 'out-of-range values are ignored');
  assert.equal(parseOrientation(Buffer.from('not a jpeg')), 1);
  assert.equal(parseOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1, 'no EXIF before image data');
});

test('rate limiter allows the limit, then answers 429 with Retry-After', () => {
  const limiter = rateLimit(`unit-${Date.now()}`, () => 2);
  const call = () => {
    let status = 200;
    const headers = {};
    const res = { set: (k, v) => { headers[k] = v; }, status: (s) => { status = s; return res; }, json: () => res };
    let passed = false;
    limiter({ ip: '1.2.3.4' }, res, () => { passed = true; });
    return { passed, status, headers };
  };
  assert.equal(call().passed, true);
  assert.equal(call().passed, true);
  const third = call();
  assert.equal(third.passed, false);
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers['Retry-After']) > 0);
  // A limit of 0 turns it off.
  const off = rateLimit(`off-${Date.now()}`, () => 0);
  let passed = false;
  off({ ip: '1.2.3.4' }, {}, () => { passed = true; });
  assert.equal(passed, true);
});

test('job queue respects the global limit and per-visitor allowance', async () => {
  config.saveConfig({ limits: { maxConcurrentJobs: 1, maxJobsPerIp: 2, maxJobMinutes: 0 } });
  const release = [];
  const started = [];
  for (const id of ['a', 'b']) {
    jobs.createJob(`q-${id}`, { ip: '9.9.9.9', kind: 'test' });
    jobs.runWhenReady(`q-${id}`, () => new Promise((resolve) => { started.push(id); release.push(resolve); }));
  }
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started, ['a'], 'only one job runs at a time');
  assert.equal(jobs.getJob('q-b').status, 'queued');
  assert.equal(jobs.queuePosition('q-b'), 1);
  assert.match(jobs.checkJobAllowance('9.9.9.9'), /already have 2 jobs/);
  assert.equal(jobs.checkJobAllowance('8.8.8.8'), null);

  jobs.updateJob('q-a', { status: 'done' });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(started, ['a', 'b'], 'the queued job starts when a slot frees up');
  jobs.updateJob('q-b', { status: 'done' });
  assert.equal(jobs.checkJobAllowance('9.9.9.9'), null);
  release.forEach((r) => r());
  config.saveConfig({ limits: { maxConcurrentJobs: 3, maxJobsPerIp: 3 } });
});

test('cancelling a queued job removes it from the queue', async () => {
  config.saveConfig({ limits: { maxConcurrentJobs: 1, maxJobsPerIp: 5 } });
  let finishFirst;
  jobs.createJob('c-1', { ip: '7.7.7.7', kind: 'test' });
  jobs.runWhenReady('c-1', () => new Promise((r) => { finishFirst = r; }));
  jobs.createJob('c-2', { ip: '7.7.7.7', kind: 'test' });
  let secondRan = false;
  jobs.runWhenReady('c-2', () => { secondRan = true; });
  await new Promise((r) => setImmediate(r)); // jobs start on the next tick
  assert.equal(jobs.getJob('c-2').status, 'queued');
  jobs.getJob('c-2').cancel();
  assert.equal(jobs.getJob('c-2').status, 'error');
  jobs.updateJob('c-1', { status: 'done' });
  finishFirst();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(secondRan, false);
  config.saveConfig({ limits: { maxConcurrentJobs: 3, maxJobsPerIp: 3 } });
});

test('yt-dlp errors are turned into helpful messages', () => {
  const { explainYtdlpError } = require('../routes/youtube');
  const say = (stderr) => explainYtdlpError({ stderr }, 'fallback');
  assert.match(say("ERROR: Sign in to confirm you're not a bot"), /temporarily blocking/);
  assert.match(say('ERROR: HTTP Error 429: Too Many Requests'), /temporarily blocking/);
  assert.match(say('ERROR: Private video'), /private/);
  assert.match(say('ERROR: Sign in to confirm your age'), /age-restricted/);
  assert.match(say('ERROR: Unsupported URL: https://example.com'), /isn't supported/);
  assert.equal(say('something else entirely'), 'fallback');
});

/* ---------- Translations ---------- */
function loadDictionary(code) {
  let entries = null;
  const file = path.join(__dirname, '..', 'public', 'js', 'i18n', `${code}.js`);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { I18N: { register: (c, d) => { assert.equal(c, code); entries = d; } }, Object });
  return entries;
}

test('translations: every language has the same keys, placeholders and markup', () => {
  const codes = fs.readdirSync(path.join(__dirname, '..', 'public', 'js', 'i18n')).map((f) => f.replace(/\.js$/, ''));
  assert.ok(codes.length >= 4);
  const reference = loadDictionary('es');
  const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  const tags = (s) => (s.match(/<\/?[a-z]+/gi) || []).sort().join();
  for (const code of codes) {
    const dict = loadDictionary(code);
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(reference).sort(), `${code} has the same keys as es`);
    for (const [en, translated] of Object.entries(dict)) {
      assert.ok(translated.trim(), `${code}: empty translation for "${en}"`);
      assert.equal(placeholders(translated), placeholders(en), `${code}: placeholders differ for "${en}"`);
      assert.equal(tags(translated), tags(en), `${code}: markup differs for "${en}"`);
    }
  }
});

test('translations: every t()/tn() string in app.js has a translation', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const strings = new Set();
  const lit = String.raw`'((?:[^'\\]|\\.)*)'`;
  for (const m of app.matchAll(new RegExp(String.raw`\bt\(${lit}`, 'g'))) strings.add(m[1].replace(/\\'/g, "'"));
  for (const m of app.matchAll(new RegExp(String.raw`\btn\([^,]+,\s*${lit},\s*${lit}`, 'g'))) {
    strings.add(m[1].replace(/\\'/g, "'"));
    strings.add(m[2].replace(/\\'/g, "'"));
  }
  const dict = loadDictionary('es');
  const missing = [...strings].filter((s) => !(s in dict));
  assert.deepEqual(missing, [], 'add these to every dictionary in public/js/i18n/');
});
