# Vidget

A self-hosted, privacy-first media toolkit that anyone can host and anyone can use. No ads, no accounts, no subscriptions, no tracking.

- **Downloader**: paste a link from YouTube or 1,800+ other sites (via yt-dlp).
  - **What you can save:** video by quality, with codec, frame rate, HDR and estimated size shown, or a "most compatible" H.264 MP4. Audio as MP3, M4A, Opus, FLAC or WAV, plus the thumbnail.
  - **Options:** only part of a video (a clip), video without audio, embedded subtitles or a separate `.srt` file, cover art and metadata, edited audio tags, loudness normalization, and cutting out sponsor segments with SponsorBlock.
  - **Batches:** load a playlist and pick which entries to download, or paste several links. Either way they go into a download queue in your browser.
- **Video converter**: convert video and audio to MP4, MOV, AVI, MKV, WebM, GIF, MP3, WAV, FLAC, AAC or OGG. Convert several files at once.
  - **Options:** trim (with an optional fast lossless cut), compress to a target size, maximum resolution, quality, codec (H.264, H.265 or VP9), frame rate, rotation, audio bitrate, removing audio, and loudness normalization.
- **Image converter**: convert between PNG, JPG, WebP, AVIF, BMP, TIFF, GIF and WebM, with resizing and quality options. Browse a GIF and save individual frames.

Converted files have location, device and other metadata removed.

Other features:
- **While you work:** cancel running jobs, live progress (also shown in the tab title), and optional browser notifications when a job finishes in another tab.
- **Shortcuts:** drop a file anywhere to convert it, paste a link anywhere to fetch it, and keyboard shortcuts (`1`/`2`/`3`, `/`).
- **Interface:** available in English, Spanish, French, German and Portuguese. Dark, light and auto themes, with accent colors checked against WCAG AA contrast.
- **Privacy:** a local-only history page. Settings and history live in the browser's local storage and are never sent anywhere. Thumbnails are loaded through the server, so the browser never contacts the source site.

## Setup

```bash
npm install
```

This downloads a bundled `ffmpeg` and a `yt-dlp` binary automatically (via `ffmpeg-static` and `yt-dlp-exec`), so no system-wide installs are required. Node.js 20 or newer is needed.

Step-by-step guides: [Linux](#linux-install-with-systemd-service) (below), [Windows](docs/install-windows.md), [macOS](docs/install-macos.md). For a public instance, also read [Running behind a reverse proxy](docs/reverse-proxy.md).

## Run

```bash
npm start
```

Then open http://localhost:3000 (or the port you configured — see below).

Use `npm run dev` to auto-restart on file changes.

## First run and the admin portal

On first start, the public site is closed and every page redirects to `/admin` to set up the admin account. To create it you need the one-time **setup token**, which Vidget prints in its console output (`journalctl -u vidget` if it runs as a service). This means a stranger who finds the site first can't claim it.

After setup, the site is open to anyone as a guest, with no accounts. Only the admin signs in at `/admin`. That page isn't linked anywhere on the public site and tells search engines not to index it. From there you can:

- set the site name, tagline and an announcement banner
- turn the downloader, video converter or image converter on or off (turned-off tools are refused by the server, not just hidden)
- set limits: maximum download quality, maximum media length, upload sizes and playlist size
- set abuse protection: how many jobs run at once (extra ones wait in a queue), jobs per visitor, requests per visitor per minute, and a time limit after which stuck jobs are stopped
- keep yt-dlp up to date automatically (checked daily, only between downloads) or update it on demand
- turn on hardware video encoding (NVENC, Quick Sync, AMF, VideoToolbox or VAAPI). Vidget tests which GPU encoders actually work and falls back to the CPU if one fails
- allow or block specific sites, publish a contact for copyright and abuse reports, and write your own terms of use
- set how long download links stay valid, whether to keep copies in `Saves/`, and how long the download log and copies are kept
- turn on reverse-proxy mode (`trust proxy`) so limits see real visitor IPs behind Caddy or nginx
- set the port and listen address, see status and disk usage, delete saved files or the log, and change the admin username and password

**Defaults for a public instance:**
- **Files:** downloads, conversions and uploads are deleted from the server 30 minutes after they're ready. Nothing is copied into `Saves/` unless you turn that on.
- **Temp cleanup:** leftover files in `tmp/` are deleted on startup and every hour.
- **Privacy page:** visitors can see exactly what is stored on the generated **Privacy & terms** page.
- **Health check:** `/api/health` reports status, yt-dlp version and load for uptime monitors.

Settings are saved to `config.json` and take effect immediately (except the port and listen address, which need a restart). The admin login is stored separately in `data/admin.json` as a salted scrypt hash. Git ignores that file, and `update.sh` never touches it. Admin sessions last 12 hours and end when the server restarts. After 5 failed sign-ins from an IP address, sign-in is blocked from that address for 15 minutes.

**Forgot the password?** Stop Vidget, delete `data/admin.json`, and start it again. Setup runs again with a new token.

## Custom port

By default Vidget listens on port `3000`. To change it, edit the `port` value in `config.json` in the project root:

```json
{
  "port": 8080,
  "logRetentionDays": 0,
  "savesRetentionDays": "*"
}
```

Restart the server and open `http://localhost:8080`. The startup message prints the port in use.

- The port must be a whole number from 1 to 65535. Anything else (or a missing/unreadable `config.json`) falls back to `3000`.
- Ports below 1024 need elevated privileges on Linux (a systemd system service can bind them if you set the port through `bash install.sh --port 80`, which grants the needed capability; re-run the installer if you change to a low port later. A user service or plain `npm start` cannot bind them).
- A `PORT` environment variable takes priority over `config.json`, e.g. for a one-off run: `PORT=9000 npm start` (Windows PowerShell: `$env:PORT=9000; npm start`).
- If you run Vidget as a systemd service, restart it after changing the port: `sudo systemctl restart vidget` (or `systemctl --user restart vidget`). The installer can also set the port for you: `bash install.sh --port 8080`.
- `bash update.sh` keeps your `config.json`, so your port survives updates.

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

`update.sh` fast-forwards to the newest upstream commit, reinstalls npm packages only if they changed, and restarts the service. It never touches `Saves/`, `logs/`, `tmp/` or your `config.json` (local edits to `config.json` are backed up and restored around the update). If you have local edits to other tracked files, the script asks whether to stash them for you and re-applies them afterwards; answering no leaves them in place and tries the update anyway, stashing them automatically only if git says they clash with the update. If re-applying conflicts, your changes stay safe in `git stash` (recover with `git stash pop`). The script never offers a way to cancel. Flags: `--check` (report only), `--refresh-ytdlp` (re-download the latest yt-dlp), `--reinstall-deps`, `--no-restart`, `-y` (accept the default answer to every question; also the behavior when run without a terminal).

By default Vidget listens on all interfaces over plain HTTP. For a public instance, set the listen address to `127.0.0.1` and put it behind a reverse proxy with HTTPS. See [docs/reverse-proxy.md](docs/reverse-proxy.md).

To uninstall, run `bash uninstall.sh --dry-run` to preview, then `bash uninstall.sh`
and confirm (or pass `--yes`). Run as the same regular user who installed it,
without sudo. This stops, disables and removes system and user services created
by `install.sh`, then permanently deletes `data/` (including the admin account),
`Saves/`, `logs/`, `tmp/`, `config.json` and `node_modules/` from this checkout.
Use `--name sonara` if that was your custom service name, or `--system` /
`--user-service` to select one service scope. Source files, shared system packages,
and custom data paths outside the checkout remain. User lingering is kept unless
you pass `--disable-linger`, which can affect other user services. Stop any
manually started server before uninstalling. See `bash uninstall.sh --help`.

## Environment variables

Everything can also be set in `/admin`. These variables override `config.json`, or move Vidget's files somewhere else (useful for containers):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `config.json` → `3000` | Port to listen on |
| `HOST` | `config.json` → all interfaces | Address to listen on, e.g. `127.0.0.1` |
| `VIDGET_CONFIG` | `./config.json` | Settings file |
| `VIDGET_DATA_DIR` | `./data` | Admin login (`admin.json`) |
| `VIDGET_TMP_DIR` | `./tmp` | Work files and results waiting to be downloaded |
| `VIDGET_SAVES_DIR` | `./Saves` | Kept copies (only if turned on in `/admin`) |
| `VIDGET_LOGS_DIR` | `./logs` | Download log (off by default) |
| `VIDGET_FFMPEG` | bundled ffmpeg 6.1 | Path to another ffmpeg. Use 7.1 or newer to accept HEIC/HEIF photos, and 8.0 or newer for animated WebP. Vidget detects what the binary can do. |
| `VIDGET_VAAPI_DEVICE` | `/dev/dri/renderD128` | GPU device for VAAPI hardware encoding on Linux |

## Notes

- Finished files are served from `tmp/` and deleted after the link expires (30 minutes by default). Copies go into `Saves/video`, `Saves/audio` and `Saves/Uploaded` only if the admin turns on "Keep a copy". Duplicate names there get a ` (1)`, ` (2)`, etc. suffix.
- Uploads are deleted as soon as they've been converted, or when they expire.
- Upload size limits are set in `/admin` (2 GB for video and 500 MB for images by default).
- With **Original** quality, the converter copies streams instead of re-encoding whenever the target format can hold them (e.g. MP4 → MKV), which is near-instant and lossless.
- Photos are rotated according to their EXIF orientation before metadata is stripped.

## Translations

The interface is translated in `public/js/i18n/<language>.js`. Each file maps the English text to its translation. Untranslated text simply stays in English. To add a language:

1. Copy `public/js/i18n/es.js` to `public/js/i18n/<code>.js`, change the `register('es', …)` code, and translate the right-hand side of each pair. Keep `{placeholders}` and HTML tags exactly as they are.
2. Add the code to `SUPPORTED` in `public/js/i18n.js` and to the language list in `public/index.html`.
3. Run `npm test`. It checks that every language has every string, with matching placeholders and markup.

If you add a user-visible string in `app.js`, wrap it in `t('…')` (or `tn(n, 'one', 'many')` for plurals) and add it to each dictionary. The tests catch any you miss.

## Development

```bash
npm run dev     # restart on file changes
npm test        # unit + API tests (starts a real server in a temp folder; no network needed)
npm run lint    # syntax and style checks
```

GitHub Actions runs lint and tests on Linux, Windows and macOS for every push and pull request.
