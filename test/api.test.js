// End-to-end API tests against a real server in a throwaway directory.
// They don't touch the network (no yt-dlp downloads), so they run anywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { startServer, client, makeMedia, waitForJob } = require('./support/server');

const PASSWORD = 'correct horse battery';
let server;
let admin;
let media;

test.before(async () => {
  server = await startServer({ limits: { requestsPerMinute: 0 } });
  media = makeMedia(server.dir);
  admin = client(server.base);
});

test.after(async () => {
  await server?.stop();
});

async function upload(url, file, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const res = await fetch(`${server.base}${url}`, { method: 'POST', body: form });
  return { status: res.status, data: await res.json() };
}

function probe(file) {
  try {
    execFileSync(ffmpegPath, ['-hide_banner', '-i', file], { stdio: 'pipe' });
  } catch (err) {
    return String(err.stderr);
  }
  return '';
}

test('before setup: the site redirects to /admin and the API is closed', async () => {
  const visitor = client(server.base);
  const home = await visitor.get('/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/admin');
  const meta = await visitor.get('/api/meta');
  assert.equal(meta.status, 503);
  const health = await visitor.get('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.setUp, false);
});

test('setup needs the console token and a strong password', async () => {
  assert.ok(server.token, 'token was printed to the console');
  let r = await admin.post('/admin/api/setup', { token: 'wrong', username: 'owner', password: PASSWORD });
  assert.equal(r.status, 403);
  r = await admin.post('/admin/api/setup', { token: server.token, username: 'owner', password: 'short' });
  assert.equal(r.status, 400);
  r = await admin.post('/admin/api/setup', { token: server.token, username: 'owner', password: PASSWORD });
  assert.equal(r.status, 200);
  r = await admin.post('/admin/api/setup', { token: server.token, username: 'x', password: PASSWORD });
  assert.equal(r.status, 409, 'setup only works once');
  const stored = JSON.parse(fs.readFileSync(path.join(server.dir, 'data', 'admin.json'), 'utf8'));
  assert.ok(!JSON.stringify(stored).includes(PASSWORD), 'password is not stored in plain text');
});

test('after setup: the public site is open', async () => {
  const visitor = client(server.base);
  assert.equal((await visitor.get('/')).status, 200);
  const meta = await visitor.get('/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.data.siteName, 'Vidget');
});

test('admin API: auth required, CSRF checks, lockout after failed logins', async () => {
  const stranger = client(server.base);
  assert.equal((await stranger.get('/admin/api/settings')).status, 401);
  // JSON only, same origin only.
  const form = await fetch(`${server.base}/admin/api/login`, { method: 'POST', body: 'username=owner', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 415);
  const cross = await stranger.post('/admin/api/login', { username: 'owner', password: PASSWORD }, { Origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
  // Lockout (per IP; a separate client from the same IP).
  for (let i = 0; i < 5; i++) assert.equal((await stranger.post('/admin/api/login', { username: 'owner', password: 'nope nope nope' })).status, 401);
  assert.equal((await stranger.post('/admin/api/login', { username: 'owner', password: PASSWORD })).status, 429);
  // The setup session still works.
  assert.equal((await admin.get('/admin/api/settings')).status, 200);
});

test('admin settings apply immediately to the public API', async () => {
  const r = await admin.put('/admin/api/settings', {
    siteName: 'TestTube',
    announcement: 'Hello',
    terms: 'Be nice.',
    features: { imageConverter: false },
  });
  assert.equal(r.status, 200);
  const meta = await client(server.base).get('/api/meta');
  assert.equal(meta.data.siteName, 'TestTube');
  assert.equal(meta.data.announcement, 'Hello');
  assert.equal(meta.data.terms, 'Be nice.');
  const blocked = await client(server.base).get('/api/image/formats');
  assert.equal(blocked.status, 403);
  await admin.put('/admin/api/settings', { features: { imageConverter: true } });
  assert.equal((await client(server.base).get('/api/image/formats')).status, 200);
});

test('stats include ffmpeg capabilities and the yt-dlp status', async () => {
  const s = await admin.get('/admin/api/stats');
  assert.equal(s.status, 200);
  assert.ok(s.data.ffmpeg.version);
  assert.equal(typeof s.data.hardware.checked, 'boolean');
  assert.equal(typeof s.data.ytdlp.autoUpdate, 'boolean');
});

test('downloader rejects private addresses and blocked sites without calling yt-dlp', async () => {
  const visitor = client(server.base);
  let r = await visitor.get(`/api/youtube/info?url=${encodeURIComponent('http://192.168.1.1/video')}`);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /private or local/);
  await admin.put('/admin/api/settings', { sites: { mode: 'block', list: ['example.com'] } });
  r = await visitor.get(`/api/youtube/info?url=${encodeURIComponent('https://www.example.com/v')}`);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /doesn't download from example\.com/);
  await admin.put('/admin/api/settings', { sites: { mode: 'all', list: [] } });
  r = await visitor.post('/api/youtube/download', { url: 'https://example.com/v', formatId: 'bad format id!' });
  assert.equal(r.status, 400);
});

test('uploads are checked by content', async () => {
  const fake = path.join(server.dir, 'fake.mp4');
  fs.writeFileSync(fake, 'this is not a video');
  let r = await upload('/api/convert/start', fake, { format: 'mp4' });
  assert.equal(r.status, 400);
  const fakeImage = path.join(server.dir, 'fake.png');
  fs.writeFileSync(fakeImage, 'not a png');
  r = await upload('/api/image/upload', fakeImage);
  assert.equal(r.status, 400);
});

test('convert: "Original" quality copies streams instead of re-encoding', async () => {
  const r = await upload('/api/convert/start', media.video, { format: 'mkv' });
  assert.equal(r.status, 200);
  const done = await waitForJob(server.base, 'convert', r.data.jobId);
  assert.equal(done.status, 'done');
  const out = path.join(server.dir, 'copy.mkv');
  fs.writeFileSync(out, Buffer.from(await (await fetch(`${server.base}/api/convert/result/${r.data.jobId}`)).arrayBuffer()));
  const info = probe(out);
  assert.match(info, /Video: h264/);
  assert.match(info, /Audio: aac/);
  assert.doesNotMatch(info, /title\s+: secret/, 'metadata is stripped');
});

test('convert: trim, resize, rotate and target size', async () => {
  const r = await upload('/api/convert/start', media.video, {
    format: 'mp4', quality: 'balanced', trimStart: '1', trimEnd: '0:03', resolution: 360, rotate: 90, targetSizeMB: 1,
  });
  assert.equal(r.status, 200);
  const done = await waitForJob(server.base, 'convert', r.data.jobId);
  assert.equal(done.status, 'done', done.error);
  assert.match(done.name, /\(trimmed\)\.mp4$/);
  const out = path.join(server.dir, 'trimmed.mp4');
  fs.writeFileSync(out, Buffer.from(await (await fetch(`${server.base}/api/convert/result/${r.data.jobId}`)).arrayBuffer()));
  const info = probe(out);
  assert.match(info, /Duration: 00:00:02/);
  assert.match(info, /360x640/, 'scaled from 480p to 360p, then rotated');
  assert.ok(fs.statSync(out).size < 1024 * 1024);
});

test('convert: bad trim ranges are rejected', async () => {
  const r = await upload('/api/convert/start', media.video, { format: 'mp4', trimStart: '3', trimEnd: '2' });
  assert.equal(r.status, 400);
});

test('convert: audio extraction', async () => {
  const r = await upload('/api/convert/start', media.video, { format: 'mp3', audioBitrate: 128, normalize: 1 });
  const done = await waitForJob(server.base, 'convert', r.data.jobId);
  assert.equal(done.status, 'done', done.error);
  assert.match(done.name, /\.mp3$/);
});

test('image: EXIF-rotated photo, WebP with resize, streamed result', async () => {
  // Add EXIF orientation 6 (rotate 90°) to the 400x200 test photo.
  const jpg = fs.readFileSync(media.image);
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(6, 18);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const app1 = Buffer.from([0xff, 0xe1, 0, 0]);
  app1.writeUInt16BE(payload.length + 2, 2);
  const rotated = path.join(server.dir, 'rotated.jpg');
  fs.writeFileSync(rotated, Buffer.concat([jpg.subarray(0, 2), app1, payload, jpg.subarray(2)]));

  const up = await upload('/api/image/upload', rotated);
  assert.equal(up.status, 200);
  assert.equal(up.data.width, 200);
  assert.equal(up.data.height, 400);

  const formats = (await client(server.base).get('/api/image/formats')).data.formats;
  const target = formats.includes('webp') ? 'webp' : 'png';
  const conv = await client(server.base).post('/api/image/convert', { uploadId: up.data.uploadId, format: target, maxWidth: 100, quality: 70 });
  assert.equal(conv.status, 200);
  const done = await waitForJob(server.base, 'image', conv.data.jobId);
  assert.equal(done.status, 'done', done.error);
  const res = await fetch(`${server.base}/api/image/result/${conv.data.jobId}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), new RegExp(`rotated\\.${target}`));
  const out = path.join(server.dir, `out.${target}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  assert.match(probe(out), /100x200/, 'rotated upright, then resized to 100px wide');
});

test('results expire: unknown job ids are 404', async () => {
  const r = await fetch(`${server.base}/api/convert/result/00000000-0000-0000-0000-000000000000`);
  assert.equal(r.status, 404);
});

test('per-visitor job limit and rate limit', async () => {
  await admin.put('/admin/api/settings', { limits: { requestsPerMinute: 2 } });
  const visitor = client(server.base);
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await visitor.get(`/api/youtube/info?url=${encodeURIComponent('http://10.0.0.1/')}`)).status);
  assert.deepEqual(statuses, [400, 400, 429]);
  await admin.put('/admin/api/settings', { limits: { requestsPerMinute: 0 } });
});
