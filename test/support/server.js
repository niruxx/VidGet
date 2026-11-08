// Starts a real Vidget server in a throwaway directory for API tests.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ffmpegPath = require('ffmpeg-static');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidget-test-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ ytdlpAutoUpdate: false, ...config }, null, 2));
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    VIDGET_CONFIG: configPath,
    VIDGET_DATA_DIR: path.join(dir, 'data'),
    VIDGET_TMP_DIR: path.join(dir, 'tmp'),
    VIDGET_SAVES_DIR: path.join(dir, 'Saves'),
    VIDGET_LOGS_DIR: path.join(dir, 'logs'),
  };
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 20000);
    const check = () => {
      if (/Setup token: \S+/.test(output) || /Vidget running/.test(output) && fs.existsSync(path.join(dir, 'data', 'admin.json'))) {
        clearTimeout(timer);
        resolve();
      } else if (child.exitCode !== null) {
        clearTimeout(timer);
        reject(new Error(`server exited:\n${output}`));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });

  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    dir,
    configPath,
    get output() { return output; },
    token: (output.match(/Setup token: (\S+)/) || [])[1],
    async stop() {
      child.kill();
      await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Minimal cookie-keeping JSON client.
function client(base) {
  let cookie = '';
  const request = async (method, url, body, headers = {}) => {
    const res = await fetch(`${base}${url}`, {
      method,
      redirect: 'manual',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let data = null;
    const type = res.headers.get('content-type') || '';
    if (type.includes('json')) data = await res.json();
    return { status: res.status, data, headers: res.headers, res };
  };
  return {
    get: (url, headers) => request('GET', url, undefined, headers),
    post: (url, body = {}, headers) => request('POST', url, body, headers),
    put: (url, body = {}, headers) => request('PUT', url, body, headers),
  };
}

// Creates small media files with the bundled ffmpeg.
function makeMedia(dir) {
  const run = (args) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args], { stdio: 'ignore' });
  const video = path.join(dir, 'clip.mp4');
  run(['-f', 'lavfi', '-i', 'testsrc=size=854x480:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'title=secret', video]);
  const image = path.join(dir, 'photo.jpg');
  run(['-f', 'lavfi', '-i', 'testsrc=size=400x200', '-frames:v', '1', image]);
  return { video, image };
}

// Polls a job's SSE progress stream until it finishes.
async function waitForJob(base, kind, jobId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/${kind}/progress/${jobId}`);
    const text = await res.text();
    const events = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    const last = events[events.length - 1];
    if (last && (last.status === 'done' || last.status === 'error')) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('job timed out');
}

module.exports = { startServer, client, makeMedia, waitForJob, ROOT };
