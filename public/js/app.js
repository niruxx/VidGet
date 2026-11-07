'use strict';

/* ==========================================================================
   Helpers
   ========================================================================== */
const $ = (id) => document.getElementById(id);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = -1;
  do { val /= 1024; i++; } while (val >= 1024 && i < units.length - 1);
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(totalSeconds) {
  const s = Math.round(Number(totalSeconds) || 0);
  if (s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function timeAgo(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}

function looksLikeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function stripExtension(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

function extOf(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function icon(name) {
  return `<svg><use href="#i-${name}"/></svg>`;
}

function triggerDownload(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  if (filename) link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/* ==========================================================================
   Settings
   ========================================================================== */
const ACCENTS = {
  violet: { accent: '#7c5cff', accent2: '#f0508f' },
  pink: { accent: '#f0508f', accent2: '#7c5cff' },
  teal: { accent: '#14b8a6', accent2: '#3b82f6' },
  amber: { accent: '#f59e0b', accent2: '#f0508f' },
  blue: { accent: '#3b82f6', accent2: '#14b8a6' },
};

const SETTINGS_KEY = 'vidget:settings';
const HISTORY_KEY = 'vidget:history';
const DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: 'violet',
  reduceMotion: false,
  animatedBackground: false,
  defaultQuality: '',
  defaultType: 'video',
  defaultAudioFormat: 'mp3',
  autoFetch: true,
  keepHistory: true,
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore persistence failures (e.g. private browsing) */
  }
}

let settings = loadSettings();
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applySettings() {
  const root = document.documentElement;
  const theme = settings.theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : settings.theme;
  root.setAttribute('data-theme', theme);

  const palette = ACCENTS[settings.accent] || ACCENTS.violet;
  root.style.setProperty('--accent', palette.accent);
  root.style.setProperty('--accent-2', palette.accent2);
  // Amber is too light for white text in light mode.
  root.style.setProperty('--on-accent', settings.accent === 'amber' ? '#1a1200' : '#fff');

  root.classList.toggle('reduce-motion', !!settings.reduceMotion);
  root.classList.toggle('bg-animated', !!settings.animatedBackground && !settings.reduceMotion);
}

applySettings();
systemDark.addEventListener('change', () => { if (settings.theme === 'system') applySettings(); });

/* ==========================================================================
   Toasts
   ========================================================================== */
const toastsEl = $('toasts');

function toast(message, { type = 'info', action, duration = 4500 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'x' : 'info';
  el.innerHTML = `<span class="toast-icon">${icon(iconName)}</span><span class="toast-msg"></span>`;
  el.querySelector('.toast-msg').textContent = message;

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'ghost-btn with-label';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.onClick(); dismiss(); });
    el.appendChild(btn);
  }
  const close = document.createElement('button');
  close.className = 'ghost-btn';
  close.setAttribute('aria-label', 'Dismiss');
  close.innerHTML = icon('x');
  close.addEventListener('click', () => dismiss());
  el.appendChild(close);

  toastsEl.appendChild(el);
  let timer = setTimeout(dismiss, duration);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(dismiss, 2000); });

  function dismiss() {
    clearTimeout(timer);
    if (!el.isConnected || el.classList.contains('leaving')) return;
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 500);
  }
}

/* ==========================================================================
   Ripple feedback
   ========================================================================== */
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.btn, .format-chip');
  if (!el || el.disabled) return;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  el.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

/* ==========================================================================
   Segmented controls
   ========================================================================== */
const segmentedControls = [];

function initSegmented(container, initialValue, onChange) {
  const indicator = container.querySelector('.segmented-indicator');
  const control = {
    container,
    value: initialValue,
    set(value, { silent = false } = {}) {
      control.value = value;
      container.querySelectorAll('button[data-value]').forEach((b) => b.classList.toggle('active', b.dataset.value === value));
      control.layout();
      if (!silent && onChange) onChange(value);
    },
    layout() {
      const active = container.querySelector(`button[data-value="${control.value}"]`);
      if (!active || !active.offsetWidth) return;
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.transform = `translateX(${active.offsetLeft - 3}px)`;
    },
  };
  container.querySelectorAll('button[data-value]').forEach((btn) => {
    btn.addEventListener('click', () => control.set(btn.dataset.value));
  });
  control.set(initialValue, { silent: true });
  segmentedControls.push(control);
  return control;
}

function layoutSegmented() {
  segmentedControls.forEach((c) => c.layout());
}
window.addEventListener('resize', layoutSegmented);

/* ==========================================================================
   Routing & navigation
   ========================================================================== */
const PAGES = ['download', 'convert', 'image', 'history', 'why', 'about', 'settings'];
const sidebar = $('sidebar');
const sidebarOverlay = $('sidebar-overlay');
let currentPage = 'download';

function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('visible');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
}
$('menu-btn').addEventListener('click', openSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

function showPage(page) {
  if (!PAGES.includes(page)) page = 'download';
  currentPage = page;
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  document.querySelectorAll('.nav-item').forEach((n) => {
    const active = n.dataset.page === page;
    n.classList.toggle('active', active);
    if (active) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  closeSidebar();
  requestAnimationFrame(layoutSegmented);
  if (page === 'history') renderHistory();
  updateTitle();
  window.scrollTo({ top: 0 });
}

function navigate(page) {
  if (location.hash === `#${page}`) showPage(page);
  else location.hash = page;
}

window.addEventListener('hashchange', () => showPage(location.hash.slice(1)));

/* ==========================================================================
   Active jobs (title progress + nav badges)
   ========================================================================== */
const activeJobs = new Map();

function setJobActive(key, percent) {
  if (percent === null) activeJobs.delete(key);
  else activeJobs.set(key, percent);
  document.querySelectorAll('[data-badge]').forEach((b) => b.classList.toggle('on', activeJobs.has(b.dataset.badge)));
  updateTitle();
}

function updateTitle() {
  const pageTitle = document.querySelector('.page.active')?.dataset.title || '';
  const base = pageTitle ? `${pageTitle} · Vidget` : 'Vidget';
  const percents = [...activeJobs.values()].filter((p) => typeof p === 'number');
  if (percents.length) {
    const avg = Math.round(percents.reduce((a, b) => a + b, 0) / percents.length);
    document.title = `(${avg}%) ${base}`;
  } else {
    document.title = base;
  }
}

/* ==========================================================================
   History (local only)
   ========================================================================== */
const HISTORY_LIMIT = 200;
let historyFilter = 'all';

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function saveHistory(items) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT))); } catch { /* ignore */ }
}

function addHistory(entry) {
  if (!settings.keepHistory) return;
  const items = loadHistory();
  items.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time: Date.now(), ...entry });
  saveHistory(items);
  updateHistoryCount();
  if (currentPage === 'history') renderHistory();
}

function updateHistoryCount() {
  const n = loadHistory().length;
  $('history-count').textContent = n ? String(n) : '';
}

function renderHistory() {
  const list = $('history-list');
  const items = loadHistory().filter((i) => historyFilter === 'all' || i.kind === historyFilter);
  list.innerHTML = '';

  $('history-empty').classList.toggle('hidden', items.length > 0);
  $('history-empty-text').textContent = settings.keepHistory
    ? 'Your downloads and conversions will show up here.'
    : 'History is turned off in Settings.';
  $('history-clear').disabled = loadHistory().length === 0;

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'history-item';
    const iconName = item.kind === 'image' ? 'image' : item.mediaType === 'audio' ? 'music' : item.kind === 'download' ? 'download' : 'film';
    const iconClass = item.kind === 'image' ? 'image' : item.mediaType === 'audio' ? 'audio' : '';
    li.innerHTML = `
      <div class="history-icon ${iconClass}">${icon(iconName)}</div>
      <div class="history-body">
        <div class="history-title"></div>
        <div class="history-meta"><span class="tag"></span><span class="h-detail"></span><span>·</span><span class="h-time"></span></div>
      </div>
      <div class="history-actions"></div>`;
    li.querySelector('.history-title').textContent = item.title || 'Untitled';
    li.querySelector('.history-title').title = item.title || '';
    li.querySelector('.tag').textContent = item.format || item.kind;
    li.querySelector('.h-detail').textContent = item.detail || '';
    li.querySelector('.h-time').textContent = timeAgo(item.time);
    li.querySelector('.h-time').title = new Date(item.time).toLocaleString();

    const actions = li.querySelector('.history-actions');
    if (item.url) {
      const again = document.createElement('button');
      again.className = 'icon-btn';
      again.title = 'Open in downloader';
      again.setAttribute('aria-label', 'Open in downloader');
      again.innerHTML = icon('refresh');
      again.addEventListener('click', () => {
        navigate('download');
        ytUrlInput.value = item.url;
        syncUrlField();
        fetchVideoInfo(item.url);
      });
      const open = document.createElement('a');
      open.className = 'icon-btn';
      open.href = item.url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.title = 'Open original page';
      open.setAttribute('aria-label', 'Open original page');
      open.innerHTML = icon('external');
      actions.append(again, open);
    }
    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.title = 'Remove from history';
    remove.setAttribute('aria-label', 'Remove from history');
    remove.innerHTML = icon('trash');
    remove.addEventListener('click', () => {
      saveHistory(loadHistory().filter((i) => i.id !== item.id));
      updateHistoryCount();
      renderHistory();
    });
    actions.appendChild(remove);
    list.appendChild(li);
  }
}

document.querySelectorAll('#history-filter button').forEach((btn) => {
  btn.addEventListener('click', () => {
    historyFilter = btn.dataset.filter;
    document.querySelectorAll('#history-filter button').forEach((b) => b.classList.toggle('active', b === btn));
    renderHistory();
  });
});

$('history-clear').addEventListener('click', () => {
  const previous = loadHistory();
  saveHistory([]);
  updateHistoryCount();
  renderHistory();
  toast('History cleared.', {
    action: { label: 'Undo', onClick: () => { saveHistory(previous); updateHistoryCount(); renderHistory(); } },
  });
});

/* ==========================================================================
   Job progress via Server-Sent Events
   ========================================================================== */
function watchJob(url, { onProgress, onDone, onError }) {
  const source = new EventSource(url);
  let finished = false;
  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status === 'error') {
      finished = true;
      source.close();
      onError(data.error || 'Something went wrong.');
    } else if (data.status === 'done') {
      finished = true;
      source.close();
      onDone();
    } else {
      onProgress(data);
    }
  };
  source.onerror = () => {
    if (finished) return;
    finished = true;
    source.close();
    onError('Lost connection to the Vidget server.');
  };
  return source;
}

/* ==========================================================================
   Downloader
   ========================================================================== */
const ytForm = $('yt-form');
const ytUrlInput = $('yt-url');
const ytUrlField = $('yt-url-field');
const ytFetchProgress = $('yt-fetch-progress');
const ytError = $('yt-error');
const ytResult = $('yt-result');
const ytThumb = $('yt-thumb');
const ytDuration = $('yt-duration');
const ytQuality = $('yt-quality');
const ytQualityField = $('yt-quality-field');
const ytAudioField = $('yt-audio-field');
const ytAudioFormat = $('yt-audio-format');
const ytTypeField = $('yt-type-field');
const ytDownloadBtn = $('yt-download');
const ytDownloadLabel = $('yt-download-label');
const ytThumbBtn = $('yt-download-thumb');
const ytProgressWrap = $('yt-progress-wrap');
const ytProgressFill = $('yt-progress-fill');
const ytProgressLabel = $('yt-progress-label');
const ytProgressPercent = $('yt-progress-percent');
const ytCancelBtn = $('yt-cancel');

const yt = {
  url: '',
  title: '',
  thumbnail: '',
  hasVideo: true,
  hasQualities: false,
  jobId: null,
  cancelRequested: false,
  fetchId: 0,
  lastFetched: '',
};
let fetchDebounce;

const ytType = initSegmented($('yt-type'), settings.defaultType, updateYtTypeUI);

function updateYtTypeUI() {
  const audio = ytType.value === 'audio';
  ytQualityField.classList.toggle('hidden', audio || !yt.hasQualities);
  ytAudioField.classList.toggle('hidden', !audio);
  ytDownloadLabel.textContent = audio ? `Download ${ytAudioFormat.value.toUpperCase()}` : 'Download video';
}
ytAudioFormat.addEventListener('change', updateYtTypeUI);

function syncUrlField() {
  ytUrlField.classList.toggle('has-value', ytUrlInput.value.length > 0);
}

ytUrlInput.addEventListener('input', () => {
  syncUrlField();
  clearTimeout(fetchDebounce);
  const value = ytUrlInput.value.trim();
  if (settings.autoFetch && looksLikeUrl(value) && value !== yt.lastFetched) {
    fetchDebounce = setTimeout(() => fetchVideoInfo(value), 600);
  }
});

ytUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ytUrlInput.value) {
    e.stopPropagation();
    clearLink();
  }
});

function clearLink() {
  ytUrlInput.value = '';
  syncUrlField();
  ytUrlInput.focus();
}

$('yt-clear').addEventListener('click', clearLink);

$('yt-paste').addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) return toast('Your clipboard is empty.');
    ytUrlInput.value = text;
    syncUrlField();
    if (looksLikeUrl(text)) fetchVideoInfo(text);
    else toast("That doesn't look like a link.", { type: 'error' });
  } catch {
    toast('Clipboard access was blocked. Press Ctrl+V in the box instead.', { type: 'error' });
    ytUrlInput.focus();
  }
});

ytForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(fetchDebounce);
  const url = ytUrlInput.value.trim();
  if (looksLikeUrl(url)) fetchVideoInfo(url);
  else showYtError('Please enter a full link starting with http:// or https://');
});

function showYtError(message) {
  ytError.textContent = message;
  ytError.classList.remove('hidden');
}

async function fetchVideoInfo(url) {
  const requestId = ++yt.fetchId;
  ytError.classList.add('hidden');
  ytResult.classList.add('hidden');
  ytFetchProgress.classList.remove('hidden');
  $('yt-fetch-btn').disabled = true;

  try {
    const res = await fetch(`/api/youtube/info?url=${encodeURIComponent(url)}`);
    const data = await res.json().catch(() => ({}));
    if (requestId !== yt.fetchId) return;
    if (!res.ok) throw new Error(data.error || 'Failed to fetch video info.');

    yt.lastFetched = url;
    yt.url = url;
    yt.title = data.title || 'video';
    yt.thumbnail = data.thumbnail || '';
    yt.hasVideo = data.hasVideo !== false;
    yt.hasQualities = Array.isArray(data.qualities) && data.qualities.length > 0;

    // Load the thumbnail through our own server so the browser never contacts the source site.
    ytThumb.removeAttribute('src');
    if (yt.thumbnail) {
      ytThumb.src = `/api/youtube/thumbnail?${new URLSearchParams({ src: yt.thumbnail, inline: '1' })}`;
    }
    $('yt-title').textContent = yt.title;
    $('yt-author').textContent = [data.author, hostOf(url)].filter(Boolean).join(' · ');
    const duration = formatDuration(data.duration);
    ytDuration.textContent = duration;
    ytDuration.classList.toggle('hidden', !duration);
    ytThumbBtn.classList.toggle('hidden', !yt.thumbnail);

    ytQuality.innerHTML = '';
    if (yt.hasQualities) {
      for (const q of data.qualities) {
        const opt = document.createElement('option');
        opt.value = q.formatId;
        opt.textContent = q.height >= 2160 ? `${q.label} · 4K` : q.height >= 1440 ? `${q.label} · QHD` : q.height >= 1080 ? `${q.label} · Full HD` : q.height >= 720 ? `${q.label} · HD` : q.label;
        ytQuality.appendChild(opt);
      }
      if (settings.defaultQuality) {
        const target = Number(settings.defaultQuality);
        // Pick the preferred height, or the closest one below it.
        const match = data.qualities.find((q) => q.height <= target) || data.qualities[data.qualities.length - 1];
        if (match) ytQuality.value = match.formatId;
      }
    }

    ytAudioFormat.value = settings.defaultAudioFormat;
    ytTypeField.classList.toggle('hidden', !yt.hasVideo);
    ytType.set(yt.hasVideo ? settings.defaultType : 'audio', { silent: true });
    updateYtTypeUI();

    ytResult.classList.remove('hidden');
    requestAnimationFrame(layoutSegmented);
  } catch (err) {
    if (requestId !== yt.fetchId) return;
    showYtError(err.message);
  } finally {
    if (requestId === yt.fetchId) {
      ytFetchProgress.classList.add('hidden');
      $('yt-fetch-btn').disabled = false;
    }
  }
}

function setYtBusy(busy) {
  ytDownloadBtn.disabled = busy;
  ytTypeField.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
  ytQuality.disabled = busy;
  ytAudioFormat.disabled = busy;
}

function finishYtJob() {
  yt.jobId = null;
  setJobActive('download', null);
  setYtBusy(false);
}

async function startYoutubeDownload() {
  if (!yt.url || yt.jobId) return;
  const type = ytType.value;
  const audioFormat = ytAudioFormat.value;
  const qualityLabel = ytQuality.selectedOptions[0]?.textContent.split(' ·')[0] || '';
  const snapshot = { url: yt.url, title: yt.title };

  ytError.classList.add('hidden');
  setYtBusy(true);
  yt.cancelRequested = false;
  ytProgressWrap.classList.remove('hidden');
  ytCancelBtn.disabled = false;
  ytProgressFill.style.width = '0%';
  ytProgressLabel.textContent = 'Starting…';
  ytProgressPercent.textContent = '';
  setJobActive('download', 0);

  const body = { url: yt.url, type, title: yt.title };
  if (type === 'audio') body.audioFormat = audioFormat;
  else body.formatId = ytQuality.value || undefined;

  try {
    const res = await fetch('/api/youtube/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Download failed.');
    yt.jobId = data.jobId;
  } catch (err) {
    showYtError(err.message);
    ytProgressWrap.classList.add('hidden');
    finishYtJob();
    return;
  }

  const jobId = yt.jobId;
  const stageLabels = { starting: 'Starting…', video: type === 'audio' ? 'Downloading audio…' : 'Downloading video…', audio: 'Downloading audio track…', finalizing: type === 'audio' ? 'Converting audio…' : 'Merging video & audio…' };

  watchJob(`/api/youtube/progress/${jobId}`, {
    onProgress(data) {
      const percent = data.percent || 0;
      ytProgressFill.style.width = `${percent}%`;
      ytProgressLabel.textContent = stageLabels[data.stage] || 'Preparing…';
      ytProgressPercent.textContent = `${percent}%`;
      setJobActive('download', percent);
    },
    onDone() {
      ytProgressFill.style.width = '100%';
      ytProgressPercent.textContent = '100%';
      ytProgressLabel.textContent = 'Done! Your download is starting.';
      ytCancelBtn.disabled = true;
      triggerDownload(`/api/youtube/result/${jobId}`);
      toast(`Downloaded “${snapshot.title}”`, { type: 'success' });
      addHistory({
        kind: 'download',
        mediaType: type,
        title: snapshot.title,
        format: type === 'audio' ? audioFormat : 'mp4',
        detail: [type === 'audio' ? 'Audio' : qualityLabel || 'Video', hostOf(snapshot.url)].filter(Boolean).join(' · '),
        url: snapshot.url,
      });
      finishYtJob();
      setTimeout(() => { if (!yt.jobId) ytProgressWrap.classList.add('hidden'); }, 2500);
    },
    onError(message) {
      ytProgressWrap.classList.add('hidden');
      if (yt.cancelRequested) toast('Download cancelled.');
      else showYtError(message);
      finishYtJob();
    },
  });
}

ytDownloadBtn.addEventListener('click', startYoutubeDownload);

ytCancelBtn.addEventListener('click', async () => {
  if (!yt.jobId) return;
  yt.cancelRequested = true;
  ytCancelBtn.disabled = true;
  ytProgressLabel.textContent = 'Cancelling…';
  await fetch(`/api/youtube/cancel/${yt.jobId}`, { method: 'POST' }).catch(() => {});
});

ytThumbBtn.addEventListener('click', () => {
  if (!yt.thumbnail) return;
  triggerDownload(`/api/youtube/thumbnail?${new URLSearchParams({ src: yt.thumbnail, title: yt.title })}`);
});

/* ==========================================================================
   Video converter
   ========================================================================== */
const dropZone = $('drop-zone');
const fileInput = $('file-input');
const fileInfo = $('file-info');
const formatGridVideo = $('format-grid-video');
const formatGridAudio = $('format-grid-audio');
const resolutionSection = $('resolution-section');
const resolutionSelect = $('convert-resolution');
const convertBtn = $('convert-btn');
const progressWrap = $('progress-wrap');
const progressFill = $('progress-fill');
const progressLabel = $('progress-label');
const progressPercent = $('progress-percent');
const convertCancelBtn = $('convert-cancel');
const convertError = $('convert-error');
const convertResult = $('convert-result');
const convertDownloadLink = $('convert-download');

const conv = { file: null, format: null, audioFormats: [], jobId: null, cancelRequested: false, xhr: null };

function buildFormatChips(container, formats, onSelect) {
  container.innerHTML = '';
  for (const fmt of formats) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'format-chip';
    chip.textContent = fmt;
    chip.dataset.format = fmt;
    chip.addEventListener('click', () => onSelect(fmt));
    container.appendChild(chip);
  }
}

function markChip(scope, fmt) {
  scope.querySelectorAll('.format-chip').forEach((chip) => {
    const isMatch = chip.dataset.format === fmt;
    chip.classList.toggle('selected', isMatch);
    if (isMatch) {
      chip.classList.remove('pop');
      void chip.offsetWidth;
      chip.classList.add('pop');
    }
  });
}

function selectConvertFormat(fmt) {
  conv.format = fmt;
  markChip($('page-convert'), fmt);
  resolutionSection.classList.toggle('hidden', conv.audioFormats.includes(fmt));
  updateConvertButton();
}

async function loadFormats() {
  let data;
  try {
    data = await (await fetch('/api/convert/formats')).json();
  } catch {
    data = { video: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'gif'], audio: ['mp3', 'wav', 'flac', 'aac', 'ogg'], resolutions: [1080, 720, 480] };
  }
  conv.audioFormats = data.audio;
  buildFormatChips(formatGridVideo, data.video, selectConvertFormat);
  buildFormatChips(formatGridAudio, data.audio, selectConvertFormat);
  for (const r of data.resolutions || []) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r === 2160 ? '2160p (4K)' : `${r}p`;
    resolutionSelect.appendChild(opt);
  }
}
loadFormats();

function updateConvertButton() {
  convertBtn.disabled = !(conv.file && conv.format) || !!conv.jobId;
  convertBtn.textContent = conv.format ? `Convert to ${conv.format.toUpperCase()}` : 'Convert';
}

function setConvertFile(file) {
  conv.file = file;
  $('file-name').textContent = file.name;
  $('file-name').title = file.name;
  $('file-size').textContent = [formatBytes(file.size), extOf(file.name).toUpperCase()].filter(Boolean).join(' · ');
  const isAudio = file.type.startsWith('audio/');
  fileInfo.querySelector('.file-icon').innerHTML = icon(isAudio ? 'music' : 'film');
  fileInfo.classList.remove('hidden');
  dropZone.classList.add('hidden');
  convertError.classList.add('hidden');
  convertResult.classList.add('hidden');
  updateConvertButton();
}

function clearConvertFile() {
  conv.file = null;
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropZone.classList.remove('hidden');
  convertResult.classList.add('hidden');
  updateConvertButton();
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setConvertFile(fileInput.files[0]); });
$('file-remove').addEventListener('click', () => { if (!conv.jobId) clearConvertFile(); });

function showConvertError(message) {
  convertError.textContent = message;
  convertError.classList.remove('hidden');
}

function finishConvertJob() {
  conv.jobId = null;
  conv.xhr = null;
  setJobActive('convert', null);
  $('file-remove').disabled = false;
  updateConvertButton();
}

// XHR instead of fetch so we can show real upload progress for big files.
function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    conv.xhr = xhr;
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Upload failed.'));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection to the server.'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(formData);
  });
}

convertBtn.addEventListener('click', async () => {
  if (!conv.file || !conv.format || conv.jobId) return;
  const file = conv.file;
  const format = conv.format;
  const resolution = conv.audioFormats.includes(format) ? '' : resolutionSelect.value;

  convertError.classList.add('hidden');
  convertResult.classList.add('hidden');
  progressWrap.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressLabel.textContent = 'Uploading…';
  progressPercent.textContent = '';
  convertCancelBtn.disabled = false;
  $('file-remove').disabled = true;
  conv.cancelRequested = false;
  conv.jobId = 'uploading';
  updateConvertButton();
  setJobActive('convert', 0);

  const formData = new FormData();
  formData.append('format', format);
  if (resolution) formData.append('resolution', resolution);
  formData.append('file', file);

  try {
    const data = await uploadWithProgress('/api/convert/start', formData, (fraction) => {
      const pct = Math.round(fraction * 100);
      progressFill.style.width = `${pct}%`;
      progressPercent.textContent = `${pct}%`;
      progressLabel.textContent = pct >= 100 ? 'Upload complete, starting…' : `Uploading ${formatBytes(file.size)}…`;
      setJobActive('convert', Math.round(pct / 2));
    });
    conv.jobId = data.jobId;
  } catch (err) {
    progressWrap.classList.add('hidden');
    if (conv.cancelRequested) toast('Upload cancelled.');
    else showConvertError(err.message);
    finishConvertJob();
    return;
  }

  if (conv.cancelRequested) {
    await fetch(`/api/convert/cancel/${conv.jobId}`, { method: 'POST' }).catch(() => {});
  }

  const jobId = conv.jobId;
  const outName = `${stripExtension(file.name)}.${format}`;
  progressFill.style.width = '0%';

  watchJob(`/api/convert/progress/${jobId}`, {
    onProgress(data) {
      const percent = data.percent || 0;
      progressFill.style.width = `${percent}%`;
      progressPercent.textContent = `${percent}%`;
      progressLabel.textContent = `Converting to ${format.toUpperCase()}…`;
      setJobActive('convert', 50 + Math.round(percent / 2));
    },
    onDone() {
      progressWrap.classList.add('hidden');
      convertDownloadLink.href = `/api/convert/result/${jobId}`;
      $('convert-result-name').textContent = outName;
      convertResult.classList.remove('hidden');
      toast(`Converted to ${format.toUpperCase()}`, {
        type: 'success',
        action: currentPage !== 'convert' ? { label: 'View', onClick: () => navigate('convert') } : undefined,
      });
      addHistory({
        kind: 'convert',
        mediaType: conv.audioFormats.includes(format) ? 'audio' : 'video',
        title: outName,
        format,
        detail: [`from ${extOf(file.name).toUpperCase() || 'file'}`, resolution ? `${resolution}p` : '', formatBytes(file.size)].filter(Boolean).join(' · '),
      });
      finishConvertJob();
    },
    onError(message) {
      progressWrap.classList.add('hidden');
      if (conv.cancelRequested) toast('Conversion cancelled.');
      else showConvertError(message);
      finishConvertJob();
    },
  });
});

convertCancelBtn.addEventListener('click', async () => {
  if (!conv.jobId) return;
  conv.cancelRequested = true;
  convertCancelBtn.disabled = true;
  progressLabel.textContent = 'Cancelling…';
  if (conv.jobId === 'uploading') {
    conv.xhr?.abort();
    return;
  }
  await fetch(`/api/convert/cancel/${conv.jobId}`, { method: 'POST' }).catch(() => {});
});

/* ==========================================================================
   Image converter
   ========================================================================== */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff', 'gif', 'webm'];
const IMAGE_TARGETS = ['png', 'jpg', 'bmp', 'tif', 'gif', 'webm'];

const imageDropZone = $('image-drop-zone');
const imageFileInput = $('image-file-input');
const imageFetchProgress = $('image-fetch-progress');
const imageFileInfo = $('image-file-info');
const imagePreview = $('image-preview');
const imageError = $('image-error');
const gifFramesSection = $('gif-frames-section');
const gifFramesGrid = $('gif-frames-grid');
const imageFormatSection = $('image-format-section');
const imageFormatGrid = $('image-format-grid');
const imageConvertBtn = $('image-convert-btn');
const imageProgressWrap = $('image-progress-wrap');

const img = { uploadId: null, originalName: '', format: null, previewUrl: null, size: 0 };

buildFormatChips(imageFormatGrid, IMAGE_TARGETS, (fmt) => {
  img.format = fmt;
  markChip(imageFormatGrid, fmt);
  imageConvertBtn.disabled = false;
  imageConvertBtn.textContent = `Convert to ${fmt.toUpperCase()} & download`;
});

function showImageError(message) {
  imageError.textContent = message;
  imageError.classList.remove('hidden');
}

function resetImagePanel({ keepError = false } = {}) {
  img.uploadId = null;
  img.originalName = '';
  img.format = null;
  if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
  img.previewUrl = null;
  imagePreview.removeAttribute('src');
  imageFileInput.value = '';
  imageFileInfo.classList.add('hidden');
  imageDropZone.classList.remove('hidden');
  gifFramesSection.classList.add('hidden');
  gifFramesGrid.innerHTML = '';
  imageFormatSection.classList.add('hidden');
  imageConvertBtn.disabled = true;
  imageConvertBtn.textContent = 'Convert & download';
  if (!keepError) imageError.classList.add('hidden');
  imageFormatGrid.querySelectorAll('.format-chip').forEach((chip) => chip.classList.remove('selected'));
}

function buildGifFrames(uploadId, frameCount, truncated) {
  gifFramesGrid.innerHTML = '';
  $('gif-frames-heading').textContent = truncated ? `Frames (first ${frameCount})` : `Frames (${frameCount})`;

  for (let i = 1; i <= frameCount; i++) {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'gif-frame-thumb';
    thumb.title = `Save frame ${i}`;
    thumb.innerHTML = `<img src="/api/image/frame/${uploadId}/${i}" alt="Frame ${i}" loading="lazy" /><span class="frame-index">${i}</span><span class="frame-download-icon">${icon('download')}</span>`;
    thumb.addEventListener('click', () => triggerDownload(`/api/image/frame/${uploadId}/${i}/download`));
    gifFramesGrid.appendChild(thumb);
  }
  gifFramesSection.classList.remove('hidden');
}

async function uploadImageFile(file) {
  if (!IMAGE_EXTENSIONS.includes(extOf(file.name))) {
    showImageError('Unsupported file type. Use PNG, JPG, BMP, TIFF, GIF or WebM.');
    return;
  }
  resetImagePanel();
  imageFetchProgress.classList.remove('hidden');
  imageDropZone.classList.add('hidden');

  img.size = file.size;
  $('image-file-name').textContent = file.name;
  $('image-file-name').title = file.name;
  $('image-file-meta').textContent = [formatBytes(file.size), extOf(file.name).toUpperCase()].join(' · ');
  if (file.type.startsWith('image/')) {
    img.previewUrl = URL.createObjectURL(file);
    imagePreview.onload = () => {
      $('image-file-meta').textContent = [formatBytes(file.size), extOf(file.name).toUpperCase(), `${imagePreview.naturalWidth}×${imagePreview.naturalHeight}`].join(' · ');
    };
    imagePreview.src = img.previewUrl;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/image/upload', { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed.');

    img.uploadId = data.uploadId;
    img.originalName = data.originalName;
    imageFileInfo.classList.remove('hidden');
    if (data.isGif && data.frameCount > 0) buildGifFrames(data.uploadId, data.frameCount, data.truncated);
    imageFormatSection.classList.remove('hidden');
  } catch (err) {
    resetImagePanel();
    showImageError(err.message);
  } finally {
    imageFetchProgress.classList.add('hidden');
  }
}

imageDropZone.addEventListener('click', () => imageFileInput.click());
imageDropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); imageFileInput.click(); } });
imageFileInput.addEventListener('change', () => { if (imageFileInput.files[0]) uploadImageFile(imageFileInput.files[0]); });
$('image-file-remove').addEventListener('click', () => resetImagePanel());

imageConvertBtn.addEventListener('click', async () => {
  if (!img.uploadId || !img.format) return;
  const format = img.format;

  imageError.classList.add('hidden');
  imageProgressWrap.classList.remove('hidden');
  imageConvertBtn.disabled = true;
  setJobActive('image', true);

  try {
    const res = await fetch('/api/image/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: img.uploadId, format }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Conversion failed.');
    }

    const blob = await res.blob();
    const filename = `${stripExtension(img.originalName)}.${format}`;
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    toast(`Saved ${filename} (${formatBytes(blob.size)})`, { type: 'success' });
    addHistory({
      kind: 'image',
      title: filename,
      format,
      detail: [`from ${extOf(img.originalName).toUpperCase()}`, formatBytes(blob.size)].join(' · '),
    });
  } catch (err) {
    showImageError(err.message);
  } finally {
    imageProgressWrap.classList.add('hidden');
    imageConvertBtn.disabled = false;
    setJobActive('image', null);
  }
});

/* ==========================================================================
   Drop a file anywhere
   ========================================================================== */
const dropOverlay = $('drop-overlay');
let dragDepth = 0;

function hasFiles(e) {
  return e.dataTransfer && [...e.dataTransfer.types].includes('Files');
}

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay.classList.add('visible');
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.remove('visible');
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('visible');
  const file = e.dataTransfer.files[0];
  if (file) routeDroppedFile(file);
});

function routeDroppedFile(file) {
  const ext = extOf(file.name);
  const isImage = file.type.startsWith('image/') || (currentPage === 'image' && IMAGE_EXTENSIONS.includes(ext));
  const isMedia = file.type.startsWith('video/') || file.type.startsWith('audio/') || ['mkv', 'flv', 'ts', 'm4a', 'opus', 'wmv'].includes(ext);

  if (isImage && IMAGE_EXTENSIONS.includes(ext)) {
    navigate('image');
    uploadImageFile(file);
  } else if (isMedia) {
    if (conv.jobId) {
      toast('Please wait for the current conversion to finish.', { type: 'error' });
      return;
    }
    navigate('convert');
    setConvertFile(file);
  } else {
    toast(`Vidget can't convert “${file.name}”.`, { type: 'error' });
  }
}

/* ==========================================================================
   Keyboard shortcuts & global paste
   ========================================================================== */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSidebar(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(document.activeElement)) return;

  if (e.key === '/') {
    e.preventDefault();
    navigate('download');
    ytUrlInput.focus();
  } else if (['1', '2', '3'].includes(e.key)) {
    navigate(['download', 'convert', 'image'][Number(e.key) - 1]);
  }
});

document.addEventListener('paste', (e) => {
  if (isTypingTarget(e.target)) return;
  const text = (e.clipboardData?.getData('text') || '').trim();
  if (!looksLikeUrl(text)) return;
  e.preventDefault();
  navigate('download');
  ytUrlInput.value = text;
  syncUrlField();
  fetchVideoInfo(text);
});

/* ==========================================================================
   Settings page
   ========================================================================== */
initSegmented($('theme-options'), settings.theme, (value) => {
  settings.theme = value;
  saveSettings();
  applySettings();
});

initSegmented($('default-type-options'), settings.defaultType, (value) => {
  settings.defaultType = value;
  saveSettings();
  if (!yt.jobId && yt.hasVideo) { ytType.set(value, { silent: true }); updateYtTypeUI(); }
});

const accentSwatches = $('accent-swatches');
function setAccentUI() {
  accentSwatches.querySelectorAll('.swatch').forEach((sw) => {
    const selected = sw.dataset.accent === settings.accent;
    sw.classList.toggle('selected', selected);
    sw.setAttribute('aria-pressed', String(selected));
  });
}
accentSwatches.querySelectorAll('.swatch').forEach((sw) => {
  sw.addEventListener('click', () => {
    settings.accent = sw.dataset.accent;
    saveSettings();
    applySettings();
    setAccentUI();
  });
});
setAccentUI();

function bindToggle(id, key, after) {
  const el = $(id);
  el.checked = !!settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked;
    saveSettings();
    applySettings();
    if (after) after(el.checked);
  });
}
bindToggle('reduce-motion-toggle', 'reduceMotion');
bindToggle('animated-bg-toggle', 'animatedBackground');
bindToggle('auto-fetch-toggle', 'autoFetch');
bindToggle('history-toggle', 'keepHistory', (on) => {
  if (!on && loadHistory().length) {
    toast('New activity will no longer be saved.', {
      action: { label: 'Clear existing', onClick: () => { saveHistory([]); updateHistoryCount(); } },
    });
  }
});

function bindSelect(id, key) {
  const el = $(id);
  el.value = settings[key];
  el.addEventListener('change', () => { settings[key] = el.value; saveSettings(); });
}
bindSelect('default-quality', 'defaultQuality');
bindSelect('default-audio-format', 'defaultAudioFormat');

$('clear-local-data').addEventListener('click', () => {
  if (!confirm('Clear your Vidget settings and history from this browser?')) return;
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch { /* ignore */ }
  location.reload();
});

/* ==========================================================================
   Server info (About page)
   ========================================================================== */
function describeRetention(days, { never, forever }) {
  if (days === '*') return forever;
  if (days === 0) return never;
  return `${days} day${days === 1 ? '' : 's'}`;
}

fetch('/api/meta')
  .then((r) => r.json())
  .then((meta) => {
    $('fact-version').textContent = `v${meta.version}`;
    $('sidebar-version').textContent = `Vidget v${meta.version}`;
    const logs = $('fact-logs');
    logs.textContent = describeRetention(meta.logRetentionDays, { never: 'Off', forever: 'On (kept forever)' });
    if (meta.logRetentionDays !== 0 && meta.logRetentionDays !== '*') logs.textContent = `On (kept ${logs.textContent})`;
    logs.classList.toggle('good', meta.logRetentionDays === 0);
    $('fact-saves').textContent = describeRetention(meta.savesRetentionDays, { never: 'Removed within an hour', forever: 'Until you delete them' });
    $('fact-video-limit').textContent = formatBytes(meta.limits.videoUploadMB * 1024 * 1024);
    $('fact-image-limit').textContent = formatBytes(meta.limits.imageUploadMB * 1024 * 1024);
  })
  .catch(() => {});

/* ==========================================================================
   Boot
   ========================================================================== */
updateHistoryCount();
showPage(location.hash.slice(1) || 'download');
