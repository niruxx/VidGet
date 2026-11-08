# Vidget Roadmap

Vidget is a **public utility**. Anyone can host an instance, and anyone who visits it can use it without signing up. It's a downloader and converter, not a personal media server. The goal of this roadmap is to match the features of the tools people use instead, while keeping Vidget's principles:

- **Privacy first.** No tracking. No visitor data is kept beyond what a job needs.
- **No ads, no accounts, no subscriptions.** Every feature is free for every visitor.
- **Anonymous by design.** There are no user profiles, logins or server-side libraries. Anything personal, such as settings or history, stays in the visitor's own browser.
- **Real files.** You get a file you keep, not a stream.

Every item below assumes anonymous visitors, many of them at once, on a server that someone else is paying for.

## What we compare against

| Alternative | Type | Relevant strengths |
| --- | --- | --- |
| cobalt | Public, ad-free web downloader | Clean UI, many supported services, audio-only and muted modes, public instances |
| MeTube | Web UI for yt-dlp | Download queue, playlist support |
| Online converter sites | Public converters | Encoder settings, trimming, compression, batch conversion |
| 4K Video Downloader, Stacher, Parabolic | Desktop apps | Playlists, subtitles, detailed format choices |

Personal archivers such as Tube Archivist and Pinchflat are **not** our comparison point. Their main features (subscriptions, libraries, user accounts) don't fit a public, anonymous tool.

## Where Vidget stands today

Phases 0 and 1 are mostly done. What's left in each phase is listed below as unchecked items.

Already shipped:
- **Downloads:** single links, playlists and a browser-side download queue. Video can be saved by quality or in the most compatible format; audio as MP3, M4A, Opus, FLAC or WAV. Also subtitles, clips, muted video, cover art and metadata, SponsorBlock, tag editing and loudness normalization.
- **Video conversion:** batch conversion, trimming, compressing to a target size, and encoder settings.
- **Image conversion:** WebP and AVIF, resizing and quality settings, and GIF frame extraction.
- **Public hosting:** files deleted after use, rate limits, a job queue, site allow/blocklists, a Privacy & terms page generated from the live settings, and `/api/health`.
- **Operators:** a hidden `/admin` portal to manage all of the above.
- **Other:** cancel for running jobs, browser-only history and settings, and a Linux installer and updater.

---

## Phase 0: Make public hosting safe

### Visitor privacy
- [x] **Delete files after use by default.** Finished files stay only in `tmp/` and are deleted after a time limit the admin sets (default 30 minutes). The admin can opt in to keeping copies in `Saves/`.
- [x] **Image uploads are temporary.** They stay in `tmp/` and are deleted when their session expires.
- [x] **Download links expire quickly.** Job IDs are random UUIDs, and result links stop working when the time limit runs out.
- [ ] **Single-use download links** (optional).
- [x] **Strip metadata from output.** EXIF, GPS, device and other metadata are removed from every converted image and video.
- [x] **Privacy & terms page**, generated from the instance's live config.

### Abuse and cost protection
- [x] **Per-IP rate limits** on link lookups, downloads, uploads and conversions. Counters are kept in memory only.
- [x] **Global and per-IP job limits.** A server-wide worker limit with a waiting queue (visitors see their place in line), plus a cap on jobs per visitor.
- [x] **Admin-set limits:** maximum video length, upload size, quality and playlist size.
- [ ] **More admin limits:** maximum output size and disk space reserved for temporary files.
- [ ] **Optional bot protection that respects privacy.** For example, a self-hosted proof-of-work challenge, off by default. No third-party CAPTCHAs that track visitors.
- [x] **Uploads are checked by their content.** Files the bundled ffmpeg can't read are rejected.
- [x] **Clean up stale temp files.** Leftover files are deleted on startup, and files older than 6 hours that no job owns are deleted every hour.
- [ ] **Resolve hostnames before fetching.** Links are checked against private IP ranges by hostname only, not after DNS lookup (DNS rebinding).

### Operator controls
- [x] **Site allowlist/blocklist.**
- [x] **Contact for copyright and abuse reports**, shown on the Privacy & terms page.
- [x] **Instance branding:** name, tagline and an optional announcement banner.
- [x] **Custom terms of use** text set by the admin, shown on the Privacy & terms page.
- [x] **Health endpoint** (`/api/health`) with the yt-dlp version and current load.
- [x] **Reverse-proxy support.** A `trust proxy` toggle so rate limits see real visitor IPs.

---

## Phase 1: Feature parity with alternatives

### Downloader
- [x] **Playlist support.** Visitors tick which entries they want, and those are added to the queue. Admins set the maximum playlist size.
- [ ] **Playlist as a single ZIP** download.
- [x] **Queue in the visitor's browser.** Visitors can paste several links or add playlist entries, and each item gets progress, cancel and retry.
- [x] **Subtitles.** They can be embedded in the video or downloaded as `.srt`.
- [x] **Embed metadata and cover art.**
- [x] **Show file details before downloading:** codec, FPS, HDR and estimated size, plus a "most compatible (H.264 MP4)" choice.
- [x] **Muted video.**
- [x] **Clip download** (`--download-sections`).
- [x] **SponsorBlock** (optional, YouTube only).

### Video converter
- [x] **Trim**, with an optional fast lossless cut.
- [x] **Compress to a target size.**
- [x] **Encoder settings:** quality, codec (H.264, H.265, VP9), audio bitrate, frame rate, mute and rotate.
- [ ] **Crop.**
- [x] **Batch convert** several files with the same settings, with "Download all".
- [ ] **Batch results as a single ZIP.**

### Image converter
- [x] **WebP and AVIF** output and input. Formats are only offered when the bundled ffmpeg has the encoder.
- [x] **HEIC/HEIF input and animated WebP input** when Vidget runs with a newer ffmpeg (`VIDGET_FFMPEG`: 7.1+ for HEIC/HEIF, 8.0+ for animated WebP). Vidget detects what the binary supports at startup. The bundled ffmpeg 6.1 supports neither.
- [ ] **Bundle a newer ffmpeg** by default so HEIC and animated WebP work out of the box. This is waiting on `ffmpeg-static`, or a switch to another package.
- [x] **Respect EXIF orientation.** ffmpeg already rotates photos by their EXIF tag when decoding, before metadata is stripped (verified for all 8 orientations), and uploads now report the rotated size.
- [x] **Resize and quality settings.**

### Audio
- [x] **Edit tags** (title, artist, album) before downloading. Applies to that one file only and isn't stored.
- [x] **Loudness normalization** for downloads and conversions.

---

## Phase 2: Reach and convenience

- [ ] **Installable app (PWA) with share target.** "Share → Vidget" on a phone opens the downloader with the link already filled in.
- [ ] **Browser extension and bookmarklet** that send the current page to any Vidget instance the user chooses.
- [ ] **Public API** (optional, rate-limited, no API keys), documented so third-party apps and shortcuts can use an instance. Admins can turn it off.
- [ ] **Instance list.** An optional, opt-in directory of public Vidget instances, so visitors have a backup when one is busy or down.
- [x] **Translations:** Spanish, French, German and Portuguese. Tests check that every language has every string.
- [ ] **More languages**, and translating admin-written text (site name, announcement, terms) per language.
- [x] **Accessibility pass:**
  - **Navigation:** a skip link, focus moves to the page on navigation, and segmented controls work as radio groups with arrow keys.
  - **Labels and values:** controls get accessible names, progress bars report their value, and format chips report their pressed state.
  - **Contrast:** text and button colors pass WCAG AA for every accent in both themes.
  - **High contrast:** works in Windows' high contrast mode.
- [ ] **Screen-reader testing** with NVDA, JAWS and VoiceOver on real devices.
- [x] **Browser notifications** when a job finishes while the tab is in the background (opt-in, in Settings).

---

## Engineering foundations

- [ ] **Docker image and `docker-compose.yml`.** This is the expected way to deploy a public instance.
- [x] **Keep yt-dlp current.** It updates itself daily (only between downloads, and new downloads wait during an update), and the admin has an "Update now" button.
- [x] **Reverse-proxy guide** ([docs/reverse-proxy.md](docs/reverse-proxy.md)) for Caddy and nginx. It covers HTTPS, `trust proxy`, upload limits, streaming progress and CDNs. Vidget can also bind to `127.0.0.1`.
- [x] **Stream results instead of buffering them, and skip needless re-encoding.**
  - **Streaming:** all results, including image conversions, are sent as normal file downloads straight from disk.
  - **Stream copy:** with "Original" quality, the converter copies any stream the target container can hold.
- [x] **Isolate stuck jobs.** yt-dlp and ffmpeg run as separate processes, and a watchdog stops jobs that run past the admin's time limit, so a stuck job can't hold a worker slot forever.
- [ ] **Scale across machines.** That needs a shared job store (e.g. Redis) instead of in-memory jobs.
- [x] **Hardware-accelerated encoding**: NVENC, Quick Sync, AMF, VideoToolbox and VAAPI. Each encoder is tested at startup, and a job falls back to the CPU if the GPU encoder fails.
- [x] **Tests and CI**: unit and API tests (`npm test`), a lint script (`npm run lint`), and GitHub Actions on Linux, Windows and macOS.
- [ ] **Browser end-to-end tests** in CI (e.g. Playwright), and **Docker image builds** once there's a Dockerfile.
- [x] **Windows and macOS install guides**: [docs/install-windows.md](docs/install-windows.md) and [docs/install-macos.md](docs/install-macos.md).

---

## Out of scope

These are common elsewhere but don't fit a public, anonymous, privacy-first utility:

- **User accounts, logins, profiles or server-side history.** History stays in the browser.
- **Server-side media libraries or file browsers.** Visitors must never see each other's files.
- **Channel/playlist subscriptions and scheduled archiving.** These are personal archiving features. Tube Archivist and Pinchflat cover this well.
- **Media server integration** (Jellyfin/Plex libraries)
- **Server-wide cookies or logged-in sessions** for age-restricted or members-only content. On a public instance this would share one person's account with every visitor and put that account at risk.
- Ads, sponsored placements, affiliate links, telemetry or analytics
- Paid tiers, feature locks, watermarks or daily limits beyond the admin's abuse protection
- Bypassing DRM

## Contributing

Pick an unchecked item and open an issue to discuss the approach before you start. New features should work for anonymous visitors, store nothing about them on the server, and be safe to run on a shared public instance.
