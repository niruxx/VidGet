# Vidget

A modern web app with two tools:

- **YouTube Downloader** — paste a link, pick a quality, download as MP4 or extract as MP3.
- **Video Converter** — upload a video/audio file and convert it to MP4, MOV, AVI, MKV, WebM, GIF, MP3, WAV, FLAC, AAC, or OGG.

## Setup

```bash
npm install
```

This downloads a bundled `ffmpeg`/`ffprobe` and a `yt-dlp` binary automatically (via `ffmpeg-static`, `ffprobe-static`, and `yt-dlp-exec`) — no system-wide installs required.

## Run

```bash
npm start
```

Then open http://localhost:3000.

Use `npm run dev` to auto-restart on file changes.

## Linux install (with systemd service)

```bash
git clone https://github.com/niruxx/VidGet.git
cd VidGet
bash install.sh
```

`install.sh` checks for (and offers to install) git, curl, Python 3 and Node.js 18+, runs `npm ci`, asks which port to use, and can create and enable a systemd service (system-wide, or per-user with no root) so Vidget starts automatically. It is safe to re-run. Useful flags: `--system`, `--user-service`, `--no-service`, `--port N`, `-y`, `--dry-run` (see `--help`).

To update to the latest commits:

```bash
bash update.sh
```

`update.sh` fast-forwards to the newest upstream commit, reinstalls npm packages only if they changed, and restarts the service. It never touches `Saves/`, `logs/`, `tmp/` or your `config.json` (local edits to `config.json` are backed up and restored around the update; local edits to any other tracked file abort the update). Flags: `--check` (report only), `--refresh-ytdlp` (re-download the latest yt-dlp), `--reinstall-deps`, `--no-restart`.

Vidget has no authentication and listens on all interfaces — restrict access with a firewall or reverse proxy if the machine is reachable from untrusted networks.

## Notes

- YouTube downloads are saved permanently to `Saves/video` (video downloads) and `Saves/audio` (MP3 extractions). Duplicate titles get a ` (1)`, ` (2)`, etc. suffix instead of overwriting.
- Uploaded files are removed immediately after conversion; converter output is cleaned up automatically ~30 minutes after the job completes.
- Max upload size is 2GB.
- YouTube videos are downloaded via `yt-dlp`, which merges the best available video and audio tracks using ffmpeg.
