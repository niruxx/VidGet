const path = require('path');

// Every place Vidget reads or writes, in one module. Each can be moved with an
// environment variable (handy for Docker volumes, and the test suite uses them
// to run against a throwaway directory).
const ROOT = path.join(__dirname, '..');

function fromEnv(name, fallback) {
  return process.env[name] ? path.resolve(process.env[name]) : fallback;
}

const TMP_DIR = fromEnv('VIDGET_TMP_DIR', path.join(ROOT, 'tmp'));

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  ADMIN_UI_DIR: path.join(ROOT, 'admin'),
  CONFIG_PATH: fromEnv('VIDGET_CONFIG', path.join(ROOT, 'config.json')),
  DATA_DIR: fromEnv('VIDGET_DATA_DIR', path.join(ROOT, 'data')),
  SAVES_DIR: fromEnv('VIDGET_SAVES_DIR', path.join(ROOT, 'Saves')),
  LOGS_DIR: fromEnv('VIDGET_LOGS_DIR', path.join(ROOT, 'logs')),
  TMP_DIR,
  tmp: (sub) => path.join(TMP_DIR, sub),
  // A newer system ffmpeg can be used instead of the bundled one (e.g. for HEIC input).
  FFMPEG_PATH: process.env.VIDGET_FFMPEG || require('ffmpeg-static'),
};
