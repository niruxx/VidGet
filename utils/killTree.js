const { execFile } = require('child_process');

// Kill a child process and everything it spawned. On Windows, yt-dlp.exe is a
// PyInstaller bootloader that runs the real downloader as a child process, so
// killing only the top-level PID leaves the download running.
function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  } else {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
  }
}

module.exports = { killTree };
