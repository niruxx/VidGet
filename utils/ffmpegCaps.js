const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const { FFMPEG_PATH: ffmpegPath } = require('./paths');

// ffmpeg builds differ between platforms and versions, so find out once at
// startup what this one can do, and only offer what actually works.

function run(args) {
  try {
    return execFileSync(ffmpegPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 });
  } catch {
    return '';
  }
}

const encoders = new Set();
for (const line of run(['-hide_banner', '-encoders']).split('\n')) {
  const match = line.match(/^\s*[VAS][.A-Z]{5}\s+(\S+)/);
  if (match) encoders.add(match[1]);
}

function hasEncoder(name) {
  return encoders.has(name);
}

// "6.1.1-essentials_build-www.gyan.dev", "7.1", "n7.1.1", "N-118000-g..." (git build)
const versionString = (run(['-hide_banner', '-version']).match(/ffmpeg version (\S+)/) || [])[1] || '';
const versionMatch = versionString.match(/^n?(\d+)\.(\d+)/);
const version = {
  raw: versionString,
  major: versionMatch ? Number(versionMatch[1]) : 0,
  minor: versionMatch ? Number(versionMatch[2]) : 0,
  // Git snapshots ("N-...") are newer than any release.
  dev: /^N-/.test(versionString),
};

function atLeast(major, minor) {
  return version.dev || version.major > major || (version.major === major && version.minor >= minor);
}

// Input formats that depend on the ffmpeg version.
const features = {
  // HEIF/HEIC image items (incl. iPhone grid images) are read since ffmpeg 7.1.
  heif: atLeast(7, 1),
  // Filled in by the decode test below; the version is only a first guess.
  animatedWebp: atLeast(8, 0),
};

function execOk(args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, args, { timeout, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, stderr: String(stderr || '') }));
  });
}

// Make a tiny animated WebP and see whether this ffmpeg can decode more than one frame of it.
async function testAnimatedWebp() {
  if (!hasEncoder('libwebp_anim')) return;
  const file = path.join(os.tmpdir(), `vidget-caps-${process.pid}.webp`);
  try {
    const made = await execOk(['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=32x32:rate=5', '-t', '0.6', '-c:v', 'libwebp_anim', '-loop', '0', file]);
    if (!made.ok) return;
    const decoded = await execOk(['-hide_banner', '-v', 'info', '-i', file, '-f', 'null', '-']);
    const frames = Number((decoded.stderr.match(/frame=\s*(\d+)/g) || []).pop()?.replace(/\D/g, '') || 0);
    features.animatedWebp = decoded.ok && frames > 1;
  } finally {
    fs.promises.unlink(file).catch(() => {});
  }
}

/* ---------- Hardware video encoders ---------- */
const VAAPI_DEVICE = process.env.VIDGET_VAAPI_DEVICE || '/dev/dri/renderD128';
const HW_CANDIDATES = {
  h264: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'h264_vaapi'],
  h265: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_videotoolbox', 'hevc_vaapi'],
};
const hardware = { h264: null, h265: null, checked: false };

// An encoder being compiled in doesn't mean the GPU/driver is there, so each
// candidate has to encode half a second of test video successfully.
async function testHardwareEncoder(name) {
  const vaapi = name.endsWith('_vaapi');
  if (vaapi && !fs.existsSync(VAAPI_DEVICE)) return false;
  const args = ['-hide_banner', '-v', 'error'];
  if (vaapi) args.push('-vaapi_device', VAAPI_DEVICE);
  args.push('-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '0.5');
  if (vaapi) args.push('-vf', 'format=nv12,hwupload');
  else if (name.endsWith('_qsv')) args.push('-pix_fmt', 'nv12');
  else args.push('-pix_fmt', 'yuv420p');
  args.push('-c:v', name, '-f', 'null', '-');
  return (await execOk(args, 15000)).ok;
}

async function detectHardware() {
  for (const [codec, list] of Object.entries(HW_CANDIDATES)) {
    for (const name of list) {
      if (!hasEncoder(name)) continue;
      if (await testHardwareEncoder(name)) {
        hardware[codec] = name;
        break;
      }
    }
  }
  hardware.checked = true;
}

const ready = Promise.all([testAnimatedWebp().catch(() => {}), detectHardware().catch(() => { hardware.checked = true; })]);

module.exports = { hasEncoder, version, features, hardware, ready, VAAPI_DEVICE };
