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

## Notes

- YouTube downloads are saved permanently to `Saves/video` (video downloads) and `Saves/audio` (MP3 extractions). Duplicate titles get a ` (1)`, ` (2)`, etc. suffix instead of overwriting.
- Uploaded files are removed immediately after conversion; converter output is cleaned up automatically ~30 minutes after the job completes.
- Max upload size is 2GB.
- YouTube videos are downloaded via `yt-dlp`, which merges the best available video and audio tracks using ffmpeg.
