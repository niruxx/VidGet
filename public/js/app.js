'use strict';

// Translate the static page before anything below grabs references to its elements.
window.I18N?.translateDocument();
// Fallbacks if i18n.js is missing.
const t = window.t || ((s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? String(v[k]) : m)) : s));
const tn = window.tn || ((n, one, many, v) => t(n === 1 ? one : many, { n, ...(v || {}) }));

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
  if (diff < 60) return t('just now');
  if (diff < 3600) return t('{n} min ago', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('{n} h ago', { n: Math.floor(diff / 3600) });
  if (diff < 86400 * 7) return t('{n} d ago', { n: Math.floor(diff / 86400) });
  return new Date(ts).toLocaleDateString(document.documentElement.lang);
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
  notifications: false,
  language: 'auto',
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

/* ---------- Color contrast (WCAG AA, 4.5:1 for text) ---------- */
function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function rgbToHex(rgb) {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function mixRgb(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}
// Move a color toward `target` in small steps until it contrasts enough with every background.
function shadeUntil(rgb, target, backgrounds, min = 4.5) {
  for (let t = 0; t <= 1; t += 0.02) {
    const c = mixRgb(rgb, target, t);
    if (backgrounds.every((bg) => contrast(c, bg) >= min)) return c;
  }
  return target;
}

const WHITE = [255, 255, 255];
const INK = [17, 18, 26];
const BACKGROUNDS = {
  dark: ['#0a0b10', '#14161e', '#1b1e28'].map(hexToRgb),
  light: ['#f5f6fa', '#ffffff', '#f1f2f7'].map(hexToRgb),
};

// The accent stays the brand color for decoration; text and buttons get a
// shade of it that is readable on this theme's backgrounds.
function accessibleAccent(accentHex, theme) {
  const accent = hexToRgb(accentHex);
  const dark = theme !== 'light';
  const text = shadeUntil(accent, dark ? WHITE : INK, BACKGROUNDS[dark ? 'dark' : 'light']);
  // Buttons: keep the color and use dark text if that already passes;
  // otherwise darken the button until white text passes.
  let solid;
  let onSolid;
  if (contrast(accent, INK) >= 4.5 && contrast(accent, WHITE) < 3) {
    solid = accent;
    onSolid = INK;
  } else {
    solid = shadeUntil(accent, INK, [WHITE]);
    onSolid = WHITE;
  }
  const solidHover = shadeUntil(mixRgb(solid, onSolid === WHITE ? INK : WHITE, 0.08), onSolid === WHITE ? INK : WHITE, [onSolid]);
  return { text: rgbToHex(text), solid: rgbToHex(solid), solidHover: rgbToHex(solidHover), onSolid: rgbToHex(onSolid) };
}

function applySettings() {
  const root = document.documentElement;
  const theme = settings.theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : settings.theme;
  root.setAttribute('data-theme', theme);

  const palette = ACCENTS[settings.accent] || ACCENTS.violet;
  root.style.setProperty('--accent', palette.accent);
  root.style.setProperty('--accent-2', palette.accent2);
  const shades = accessibleAccent(palette.accent, theme);
  root.style.setProperty('--accent-text', shades.text);
  root.style.setProperty('--accent-solid', shades.solid);
  root.style.setProperty('--accent-solid-hover', shades.solidHover);
  root.style.setProperty('--on-accent', shades.onSolid);

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
  close.setAttribute('aria-label', t('Dismiss'));
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
      container.querySelectorAll('button[data-value]').forEach((b) => {
        const on = b.dataset.value === value;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1; // one tab stop; arrow keys move between options
      });
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
  // Behaves as a radio group for assistive technology.
  container.setAttribute('role', 'radiogroup');
  const buttons = [...container.querySelectorAll('button[data-value]')];
  buttons.forEach((btn) => {
    btn.setAttribute('role', 'radio');
    btn.addEventListener('click', () => control.set(btn.dataset.value));
  });
  container.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const enabled = buttons.filter((b) => !b.disabled);
    const index = enabled.findIndex((b) => b.dataset.value === control.value);
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (next) {
      control.set(next.dataset.value);
      next.focus();
    }
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
const PAGES = ['download', 'convert', 'image', 'history', 'why', 'about', 'privacy', 'settings'];
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

// Tools the instance admin has switched off (filled in from /api/meta).
const disabledPages = new Set();
let siteName = 'Vidget';

function firstAvailablePage() {
  return ['download', 'convert', 'image'].find((p) => !disabledPages.has(p)) || 'why';
}

function showPage(page) {
  if (!PAGES.includes(page) || disabledPages.has(page)) page = firstAvailablePage();
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

window.addEventListener('hashchange', () => {
  showPage(location.hash.slice(1));
  // Let keyboard and screen-reader users start at the new page's content.
  $('main').focus({ preventScroll: true });
});

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
  const base = pageTitle ? `${pageTitle} · ${siteName}` : siteName;
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
    ? t('Your downloads and conversions will show up here.')
    : t('History is turned off in Settings.');
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
    li.querySelector('.history-title').textContent = item.title || t('Untitled');
    li.querySelector('.history-title').title = item.title || '';
    li.querySelector('.tag').textContent = item.format || item.kind;
    li.querySelector('.h-detail').textContent = item.detail || '';
    li.querySelector('.h-time').textContent = timeAgo(item.time);
    li.querySelector('.h-time').title = new Date(item.time).toLocaleString();

    const actions = li.querySelector('.history-actions');
    if (item.url) {
      const again = document.createElement('button');
      again.className = 'icon-btn';
      again.title = t('Open in downloader');
      again.setAttribute('aria-label', again.title);
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
      open.title = t('Open original page');
      open.setAttribute('aria-label', open.title);
      open.innerHTML = icon('external');
      actions.append(again, open);
    }
    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.title = t('Remove from history');
    remove.setAttribute('aria-label', remove.title);
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
  toast(t('History cleared.'), {
    action: { label: t('Undo'), onClick: () => { saveHistory(previous); updateHistoryCount(); renderHistory(); } },
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
      onError(t(data.error || 'Something went wrong.'));
    } else if (data.status === 'done') {
      finished = true;
      source.close();
      onDone(data);
    } else {
      onProgress(data);
    }
  };
  source.onerror = () => {
    if (finished) return;
    finished = true;
    source.close();
    onError(t('Lost connection to the server.'));
  };
  return source;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(t(data.error || 'Request failed.'));
  return data;
}

// "1:30", "01:02:03", "90" -> seconds. Returns null for empty, NaN for invalid.
function parseClock(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parts = text.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

function readTimeRange(startInput, endInput) {
  const start = parseClock(startInput.value);
  const end = parseClock(endInput.value);
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error(t('Use times like 1:30, 1:02:03 or 90 (seconds).'));
  if (start !== null && end !== null && end <= start) throw new Error(t('The end time must be after the start time.'));
  return { start, end };
}

function qualityTier(height) {
  if (height >= 2160) return '4K';
  if (height >= 1440) return 'QHD';
  if (height >= 1080) return 'Full HD';
  if (height >= 720) return 'HD';
  return '';
}

const QUEUE_STATUS_TEXT = {
  waiting: t('Waiting'),
  starting: t('Starting…'),
  queued: t('Waiting for a free slot on the server…'),
  running: t('Downloading…'),
  done: t('Done'),
  error: t('Failed'),
  cancelled: t('Cancelled'),
};

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
const ytQueueBtn = $('yt-queue-add');
const ytSubsBtn = $('yt-download-subs');
const ytSubs = $('yt-subs');
const ytMore = $('yt-more');
const ytLoadPlaylistBtn = $('yt-load-playlist');
const ytPlaylist = $('yt-playlist');
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
  qualities: [],
  subtitles: [],
  isYouTube: false,
  jobId: null,
  cancelRequested: false,
  fetchId: 0,
  lastFetched: '',
  playlist: null,
};
let fetchDebounce;

const ytType = initSegmented($('yt-type'), settings.defaultType, updateYtTypeUI);

function updateYtTypeUI() {
  const audio = ytType.value === 'audio';
  ytQualityField.classList.toggle('hidden', audio || !yt.hasQualities);
  ytAudioField.classList.toggle('hidden', !audio);
  ytMore.querySelectorAll('.for-video').forEach((el) => {
    const isSubs = el.contains(ytSubs);
    el.classList.toggle('hidden', audio || (isSubs && !yt.subtitles.length));
  });
  ytMore.querySelectorAll('.for-audio').forEach((el) => el.classList.toggle('hidden', !audio));
  $('yt-sponsor-field').classList.toggle('hidden', !yt.isYouTube);
  ytSubsBtn.classList.toggle('hidden', !yt.subtitles.length);
  ytDownloadLabel.textContent = audio ? t('Download {format}', { format: ytAudioFormat.value.toUpperCase() }) : t('Download video');
  updateMoreSummary();
}
ytAudioFormat.addEventListener('change', updateYtTypeUI);

function updateMoreSummary() {
  const audio = ytType.value === 'audio';
  const parts = [];
  if (!audio && $('yt-muted').checked) parts.push(t('no audio'));
  if (!audio && ytSubs.value) parts.push(t('{lang} subtitles', { lang: ytSubs.selectedOptions[0]?.textContent || ytSubs.value }));
  if ($('yt-clip-start').value.trim() || $('yt-clip-end').value.trim()) parts.push(t('clip'));
  if (audio && $('yt-normalize').checked) parts.push(t('normalized'));
  if (audio && ['yt-tag-title', 'yt-tag-artist', 'yt-tag-album'].some((id) => $(id).dataset.edited === '1')) parts.push(t('custom tags'));
  if (yt.isYouTube && $('yt-sponsorblock').checked) parts.push(t('no sponsors'));
  if (!$('yt-cover').checked) parts.push(t('no cover art'));
  $('yt-more-summary').textContent = parts.length ? ` · ${parts.join(', ')}` : '';
}
ytMore.addEventListener('input', (e) => {
  if (e.target.id?.startsWith('yt-tag-')) e.target.dataset.edited = '1';
  updateMoreSummary();
});
ytMore.addEventListener('change', updateMoreSummary);

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
    if (!text) return toast(t('Your clipboard is empty.'));
    ytUrlInput.value = text;
    syncUrlField();
    if (looksLikeUrl(text)) fetchVideoInfo(text);
    else toast(t("That doesn't look like a link."), { type: 'error' });
  } catch {
    toast(t('Clipboard access was blocked. Press Ctrl+V in the box instead.'), { type: 'error' });
    ytUrlInput.focus();
  }
});

ytForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(fetchDebounce);
  const url = ytUrlInput.value.trim();
  if (looksLikeUrl(url)) fetchVideoInfo(url);
  else showYtError(t('Please enter a full link starting with http:// or https://'));
});

function showYtError(message) {
  ytError.textContent = t(message);
  ytError.classList.remove('hidden');
}

function proxiedThumb(src) {
  return `/api/youtube/thumbnail?${new URLSearchParams({ src, inline: '1' })}`;
}

function describeQuality(q) {
  const parts = [q.label];
  const tier = qualityTier(q.height);
  if (tier) parts.push(tier);
  if (q.fps && q.fps > 30) parts.push(`${q.fps} fps`);
  if (q.codec) parts.push(q.codec);
  if (q.hdr) parts.push('HDR');
  if (q.size) parts.push(`~${formatBytes(q.size)}`);
  return parts.join(' · ');
}

async function fetchVideoInfo(url, { playlist = false } = {}) {
  const requestId = ++yt.fetchId;
  ytError.classList.add('hidden');
  ytResult.classList.add('hidden');
  ytPlaylist.classList.add('hidden');
  ytFetchProgress.classList.remove('hidden');
  $('yt-fetch-btn').disabled = true;

  try {
    const query = new URLSearchParams({ url });
    if (playlist) query.set('playlist', '1');
    const res = await fetch(`/api/youtube/info?${query}`);
    const data = await res.json().catch(() => ({}));
    if (requestId !== yt.fetchId) return;
    if (!res.ok) throw new Error(data.error || t('Failed to fetch details for this link.'));

    yt.lastFetched = url;
    if (data.kind === 'playlist') {
      renderPlaylist(data);
      return;
    }

    yt.url = url;
    yt.title = data.title || 'video';
    yt.thumbnail = data.thumbnail || '';
    yt.hasVideo = data.hasVideo !== false;
    yt.qualities = Array.isArray(data.qualities) ? data.qualities : [];
    yt.hasQualities = yt.qualities.length > 0;
    yt.subtitles = Array.isArray(data.subtitles) ? data.subtitles : [];
    yt.isYouTube = !!data.isYouTube;

    // Load the thumbnail through our own server so the browser never contacts the source site.
    ytThumb.removeAttribute('src');
    if (yt.thumbnail) ytThumb.src = proxiedThumb(yt.thumbnail);
    $('yt-title').textContent = yt.title;
    $('yt-author').textContent = [data.author, hostOf(url)].filter(Boolean).join(' · ');
    const duration = formatDuration(data.duration);
    ytDuration.textContent = duration;
    ytDuration.classList.toggle('hidden', !duration);
    ytThumbBtn.classList.toggle('hidden', !yt.thumbnail);
    ytLoadPlaylistBtn.classList.toggle('hidden', !data.inPlaylist);

    ytQuality.innerHTML = '';
    if (yt.hasQualities) {
      for (const q of yt.qualities) {
        const opt = document.createElement('option');
        opt.value = q.formatId;
        opt.textContent = describeQuality(q);
        ytQuality.appendChild(opt);
      }
      const compat = document.createElement('option');
      compat.value = 'compat';
      compat.textContent = t('Most compatible (H.264 MP4, plays everywhere)');
      ytQuality.appendChild(compat);
      if (settings.defaultQuality) {
        const target = Number(settings.defaultQuality);
        // Pick the preferred height, or the closest one below it.
        const match = yt.qualities.find((q) => q.height <= target) || yt.qualities[yt.qualities.length - 1];
        if (match) ytQuality.value = match.formatId;
      }
    }

    ytSubs.innerHTML = '';
    ytSubs.appendChild(new Option(t('None'), ''));
    for (const sub of yt.subtitles) {
      const opt = document.createElement('option');
      opt.value = sub.lang;
      opt.textContent = sub.name;
      ytSubs.appendChild(opt);
    }

    // Reset per-video options.
    $('yt-tag-title').value = data.title || '';
    $('yt-tag-artist').value = data.artist || data.author || '';
    $('yt-tag-album').value = data.album || '';
    ['yt-tag-title', 'yt-tag-artist', 'yt-tag-album'].forEach((id) => { delete $(id).dataset.edited; });
    $('yt-clip-start').value = '';
    $('yt-clip-end').value = '';
    $('yt-muted').checked = false;
    $('yt-normalize').checked = false;
    $('yt-sponsorblock').checked = false;
    $('yt-cover').checked = true;
    ytMore.open = false;

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

ytLoadPlaylistBtn.addEventListener('click', () => fetchVideoInfo(yt.url, { playlist: true }));

// Everything the server needs to download the current video with the chosen options.
function collectYtOptions() {
  const type = ytType.value;
  const { start, end } = readTimeRange($('yt-clip-start'), $('yt-clip-end'));
  const body = {
    url: yt.url,
    type,
    title: yt.title,
    embedCover: $('yt-cover').checked,
    sponsorblock: yt.isYouTube && $('yt-sponsorblock').checked,
  };
  if (start !== null || end !== null) body.clip = { start: start ?? 0, end: end ?? undefined };
  if (type === 'audio') {
    body.audioFormat = ytAudioFormat.value;
    body.normalize = $('yt-normalize').checked;
    const tags = { title: $('yt-tag-title').value.trim(), artist: $('yt-tag-artist').value.trim(), album: $('yt-tag-album').value.trim() };
    if (['yt-tag-title', 'yt-tag-artist', 'yt-tag-album'].some((id) => $(id).dataset.edited === '1')) body.tags = tags;
  } else {
    body.formatId = ytQuality.value || undefined;
    body.muted = $('yt-muted').checked;
    if (ytSubs.value) body.subtitles = ytSubs.value;
  }
  return body;
}

function describeYtChoice(body) {
  if (body.type === 'audio') return body.audioFormat.toUpperCase();
  if (body.formatId === 'compat') return 'Compatible MP4';
  const q = yt.qualities.find((x) => x.formatId === body.formatId);
  return q ? q.label : t('Video');
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

const YT_STAGES = {
  queued: t('Waiting for a free slot on the server…'),
  starting: t('Starting…'),
  video: t('Downloading video…'),
  audio: t('Downloading audio…'),
  'audio-track': t('Downloading audio track…'),
  finalizing: t('Finishing up…'),
  normalizing: t('Normalizing loudness…'),
};

async function startYoutubeDownload() {
  if (!yt.url || yt.jobId) return;
  let body;
  try {
    body = collectYtOptions();
  } catch (err) {
    ytMore.open = true;
    showYtError(err.message);
    return;
  }
  const snapshot = { url: yt.url, title: yt.title, choice: describeYtChoice(body), type: body.type };

  ytError.classList.add('hidden');
  setYtBusy(true);
  yt.cancelRequested = false;
  ytProgressWrap.classList.remove('hidden');
  ytCancelBtn.disabled = false;
  ytProgressFill.style.width = '0%';
  ytProgressLabel.textContent = t('Starting…');
  ytProgressPercent.textContent = '';
  setJobActive('download', 0);

  try {
    const data = await postJson('/api/youtube/download', body);
    yt.jobId = data.jobId;
  } catch (err) {
    showYtError(err.message);
    ytProgressWrap.classList.add('hidden');
    finishYtJob();
    return;
  }

  const jobId = yt.jobId;
  watchJob(`/api/youtube/progress/${jobId}`, {
    onProgress(data) {
      const percent = data.percent || 0;
      ytProgressFill.style.width = `${percent}%`;
      ytProgressLabel.textContent = data.status === 'queued'
        ? t('Waiting for a free slot on the server (#{n} in line)…', { n: data.position || 1 })
        : YT_STAGES[data.stage] || t('Preparing…');
      ytProgressPercent.textContent = data.status === 'queued' ? '' : `${percent}%`;
      setJobActive('download', percent);
    },
    onDone(data) {
      ytProgressFill.style.width = '100%';
      ytProgressPercent.textContent = '100%';
      ytProgressLabel.textContent = t('Done! Your download is starting.');
      ytCancelBtn.disabled = true;
      triggerDownload(`/api/youtube/result/${jobId}`);
      toast(t('Downloaded “{title}”', { title: snapshot.title }), { type: 'success' });
      notifyDone(t('Download ready'), snapshot.title);
      addHistory({
        kind: 'download',
        mediaType: snapshot.type,
        title: snapshot.title,
        format: extOf(data.name || '') || (snapshot.type === 'audio' ? body.audioFormat : 'mp4'),
        detail: [snapshot.choice, hostOf(snapshot.url)].filter(Boolean).join(' · '),
        url: snapshot.url,
      });
      finishYtJob();
      setTimeout(() => { if (!yt.jobId) ytProgressWrap.classList.add('hidden'); }, 2500);
    },
    onError(message) {
      ytProgressWrap.classList.add('hidden');
      if (yt.cancelRequested) toast(t('Download cancelled.'));
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
  ytProgressLabel.textContent = t('Cancelling…');
  await fetch(`/api/youtube/cancel/${yt.jobId}`, { method: 'POST' }).catch(() => {});
});

ytThumbBtn.addEventListener('click', () => {
  if (!yt.thumbnail) return;
  triggerDownload(`/api/youtube/thumbnail?${new URLSearchParams({ src: yt.thumbnail, title: yt.title })}`);
});

ytQueueBtn.addEventListener('click', () => {
  if (!yt.url) return;
  try {
    const body = collectYtOptions();
    queueAdd(body, { title: yt.title, thumbnail: yt.thumbnail, choice: describeYtChoice(body) });
    toast(t('Added “{title}” to the queue.', { title: yt.title }), { type: 'success' });
  } catch (err) {
    ytMore.open = true;
    showYtError(err.message);
  }
});

ytSubsBtn.addEventListener('click', async () => {
  const lang = ytSubs.value || yt.subtitles[0]?.lang;
  if (!lang) return;
  const label = ytSubsBtn.lastChild;
  ytSubsBtn.disabled = true;
  const original = label.textContent;
  label.textContent = t('Getting subtitles…');
  const reset = () => { ytSubsBtn.disabled = false; label.textContent = original; };
  try {
    const { jobId } = await postJson('/api/youtube/subtitles', { url: yt.url, lang, title: yt.title });
    watchJob(`/api/youtube/progress/${jobId}`, {
      onProgress() {},
      onDone() { triggerDownload(`/api/youtube/result/${jobId}`); reset(); },
      onError(message) { toast(t(message), { type: 'error' }); reset(); },
    });
  } catch (err) {
    toast(err.message, { type: 'error' });
    reset();
  }
});

/* ---------- Playlists ---------- */
const plList = $('pl-list');
const plQueueBtn = $('pl-queue');
const plType = initSegmented($('pl-type'), settings.defaultType, updatePlTypeUI);

function updatePlTypeUI() {
  const audio = plType.value === 'audio';
  $('pl-quality').classList.toggle('hidden', audio);
  $('pl-audio-format').classList.toggle('hidden', !audio);
}

function updatePlQueueLabel() {
  const boxes = [...plList.querySelectorAll('input[type="checkbox"]')];
  const n = boxes.filter((b) => b.checked).length;
  $('pl-queue-label').textContent = n ? t('Add {n} to queue', { n }) : t('Add to queue');
  plQueueBtn.disabled = n === 0;
  $('pl-all').checked = n === boxes.length && n > 0;
  $('pl-all').indeterminate = n > 0 && n < boxes.length;
}

function renderPlaylist(data) {
  yt.playlist = data;
  $('pl-title').textContent = data.title;
  const count = data.entries.length;
  const meta = [tn(count, '{n} item', '{n} items')];
  if (data.truncated) meta.push(t('first {count} of {total}; this server allows up to {max}', { count, total: data.total, max: data.maxItems }));
  if (data.author) meta.push(data.author);
  $('pl-meta').textContent = meta.join(' · ');

  plList.innerHTML = '';
  data.entries.forEach((entry, i) => {
    const li = document.createElement('li');
    li.className = 'playlist-item';
    li.innerHTML = `
      <label class="check"><input type="checkbox" checked /><span class="pl-index"></span></label>
      <div class="pl-thumb"></div>
      <div class="pl-text"><span class="pl-title"></span><span class="muted small pl-duration"></span></div>`;
    li.querySelector('input').dataset.index = String(i);
    li.querySelector('.pl-index').textContent = String(i + 1);
    li.querySelector('.pl-title').textContent = entry.title || entry.label;
    li.querySelector('.pl-title').title = entry.title || entry.url;
    li.querySelector('.pl-duration').textContent = formatDuration(entry.duration);
    if (entry.thumbnail) {
      const thumb = document.createElement('img');
      thumb.loading = 'lazy';
      thumb.alt = '';
      thumb.src = proxiedThumb(entry.thumbnail);
      li.querySelector('.pl-thumb').appendChild(thumb);
    }
    plList.appendChild(li);
  });

  $('pl-quality').value = settings.defaultQuality || '';
  $('pl-audio-format').value = settings.defaultAudioFormat;
  plType.set(settings.defaultType, { silent: true });
  updatePlTypeUI();
  updatePlQueueLabel();
  ytPlaylist.classList.remove('hidden');
  requestAnimationFrame(layoutSegmented);
}

plList.addEventListener('change', updatePlQueueLabel);
$('pl-all').addEventListener('change', (e) => {
  plList.querySelectorAll('input[type="checkbox"]').forEach((b) => { b.checked = e.target.checked; });
  updatePlQueueLabel();
});

plQueueBtn.addEventListener('click', () => {
  if (!yt.playlist) return;
  const audio = plType.value === 'audio';
  const height = Number($('pl-quality').value) || undefined;
  const audioFormat = $('pl-audio-format').value;
  let added = 0;
  plList.querySelectorAll('input[type="checkbox"]:checked').forEach((box) => {
    const entry = yt.playlist.entries[Number(box.dataset.index)];
    if (!entry) return;
    const body = { url: entry.url, type: audio ? 'audio' : 'video', embedCover: true };
    if (entry.title) body.title = entry.title;
    if (audio) body.audioFormat = audioFormat;
    else if (height) body.height = height;
    queueAdd(body, { title: entry.title || entry.label, thumbnail: entry.thumbnail, choice: audio ? audioFormat.toUpperCase() : height ? `≤${height}p` : t('Best') }, { pump: false });
    added++;
  });
  pumpQueue();
  toast(tn(added, 'Added {n} item to the queue.', 'Added {n} items to the queue.'), { type: 'success' });
  $('queue-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------- Several links at once ---------- */
$('multi-toggle').addEventListener('click', () => {
  const panel = $('multi-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) $('multi-links').focus();
});

$('multi-add').addEventListener('click', () => {
  const lines = $('multi-links').value.split(/\s+/).map((l) => l.trim()).filter(Boolean);
  const links = [...new Set(lines.filter(looksLikeUrl))];
  if (!links.length) {
    toast(t('Paste at least one link starting with http:// or https://'), { type: 'error' });
    return;
  }
  for (const url of links) {
    const body = { url, type: settings.defaultType, embedCover: true };
    if (settings.defaultType === 'audio') body.audioFormat = settings.defaultAudioFormat;
    else if (settings.defaultQuality) body.height = Number(settings.defaultQuality);
    queueAdd(body, { title: '', choice: settings.defaultType === 'audio' ? settings.defaultAudioFormat.toUpperCase() : t('Video') }, { pump: false });
  }
  pumpQueue();
  const skipped = lines.length - links.length;
  $('multi-links').value = '';
  $('multi-panel').classList.add('hidden');
  toast(tn(links.length, 'Added {n} link to the queue.', 'Added {n} links to the queue.') + (skipped ? ` ${tn(skipped, "Skipped {n} line that wasn't a link.", "Skipped {n} lines that weren't links.")}` : ''), { type: 'success' });
});

/* ==========================================================================
   Download queue (lives only in this page; the server enforces its own limits)
   ========================================================================== */
const queueState = { items: [], running: null, seq: 0 };
const queueList = $('queue-list');

function queueAdd(body, meta, { pump = true } = {}) {
  const item = {
    id: ++queueState.seq,
    body,
    title: meta.title || '',
    thumbnail: meta.thumbnail || '',
    choice: meta.choice || '',
    status: 'waiting',
    percent: 0,
    jobId: null,
    name: '',
    error: '',
    el: null,
  };
  queueState.items.push(item);
  renderQueue();
  if (pump) pumpQueue();
  return item;
}

function queueItemTitle(item) {
  return item.title || (item.name ? stripExtension(item.name) : '') || hostOf(item.body.url) || item.body.url;
}

function renderQueue() {
  const card = $('queue-card');
  card.classList.toggle('hidden', queueState.items.length === 0);
  queueList.innerHTML = '';
  for (const item of queueState.items) {
    const li = document.createElement('li');
    li.className = 'queue-item';
    li.innerHTML = `
      <div class="q-icon"></div>
      <div class="q-body">
        <div class="q-title"></div>
        <div class="q-meta muted small"><span class="q-status"></span><span class="q-detail"></span></div>
        <div class="progress-bar q-bar"><div class="progress-fill"></div></div>
      </div>
      <div class="q-actions"></div>`;
    li.querySelector('.q-icon').innerHTML = icon(item.body.type === 'audio' ? 'music' : 'film');
    item.el = li;
    updateQueueItem(item);
    queueList.appendChild(li);
  }
  updateQueueSummary();
}

function queueAction(label, iconName, onClick) {
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = icon(iconName);
  btn.addEventListener('click', onClick);
  return btn;
}

function updateQueueItem(item) {
  const li = item.el;
  if (!li) return;
  li.dataset.status = item.status;
  const title = queueItemTitle(item);
  li.querySelector('.q-title').textContent = title;
  li.querySelector('.q-title').title = item.body.url;
  let status = QUEUE_STATUS_TEXT[item.status] || item.status;
  if (item.status === 'running') status = `${t('Downloading…')} ${item.percent}%`;
  if (item.status === 'queued' && item.position) status = t('Waiting for a free slot (#{n} in line)…', { n: item.position });
  if (item.status === 'error') status = t(item.error || 'Failed');
  li.querySelector('.q-status').textContent = status;
  li.querySelector('.q-detail').textContent = [item.choice, hostOf(item.body.url)].filter(Boolean).map((t) => ` · ${t}`).join('');
  const bar = li.querySelector('.q-bar');
  bar.classList.toggle('hidden', !['starting', 'queued', 'running'].includes(item.status));
  bar.classList.toggle('indeterminate', item.status !== 'running');
  li.querySelector('.progress-fill').style.width = `${item.percent}%`;

  const actions = li.querySelector('.q-actions');
  actions.innerHTML = '';
  if (item.status === 'done') {
    actions.appendChild(queueAction(t('Save again'), 'download', () => triggerDownload(`/api/youtube/result/${item.jobId}`)));
  }
  if (item.status === 'error' || item.status === 'cancelled') {
    actions.appendChild(queueAction(t('Retry'), 'refresh', () => {
      Object.assign(item, { status: 'waiting', percent: 0, error: '', jobId: null });
      updateQueueItem(item);
      updateQueueSummary();
      pumpQueue();
    }));
  }
  if (['starting', 'queued', 'running'].includes(item.status)) {
    actions.appendChild(queueAction(t('Cancel'), 'x', () => cancelQueueItem(item)));
  } else {
    actions.appendChild(queueAction(t('Remove from queue'), 'trash', () => {
      queueState.items = queueState.items.filter((i) => i !== item);
      renderQueue();
    }));
  }
}

function updateQueueSummary() {
  const items = queueState.items;
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const left = items.filter((i) => ['waiting', 'starting', 'queued', 'running'].includes(i.status)).length;
  const parts = [t('{done} of {total} done', { done, total: items.length })];
  if (left) parts.push(t('{n} left', { n: left }));
  if (failed) parts.push(t('{n} failed', { n: failed }));
  $('queue-summary').textContent = parts.join(' · ');
  $('queue-cancel-all').classList.toggle('hidden', left === 0);
  $('queue-clear-done').classList.toggle('hidden', left === items.length);
}

async function cancelQueueItem(item) {
  if (item.status === 'waiting') {
    item.status = 'cancelled';
  } else {
    item.cancelRequested = true;
    if (item.jobId) await fetch(`/api/youtube/cancel/${item.jobId}`, { method: 'POST' }).catch(() => {});
  }
  updateQueueItem(item);
  updateQueueSummary();
}

async function pumpQueue() {
  if (queueState.running) return;
  const item = queueState.items.find((i) => i.status === 'waiting');
  if (!item) {
    setJobActive('queue', null);
    return;
  }
  queueState.running = item;
  item.status = 'starting';
  item.cancelRequested = false;
  updateQueueItem(item);
  setJobActive('download', 0);

  try {
    const { jobId } = await postJson('/api/youtube/download', item.body);
    item.jobId = jobId;
  } catch (err) {
    item.status = 'error';
    item.error = err.message;
    queueState.running = null;
    updateQueueItem(item);
    updateQueueSummary();
    setJobActive('download', null);
    setTimeout(pumpQueue, 1500);
    return;
  }

  await new Promise((resolve) => {
    watchJob(`/api/youtube/progress/${item.jobId}`, {
      onProgress(data) {
        item.status = data.status === 'queued' ? 'queued' : 'running';
        item.position = data.position;
        item.percent = data.percent || 0;
        updateQueueItem(item);
        setJobActive('download', item.percent);
      },
      onDone(data) {
        item.status = 'done';
        item.percent = 100;
        item.name = data.name || '';
        triggerDownload(`/api/youtube/result/${item.jobId}`);
        addHistory({
          kind: 'download',
          mediaType: item.body.type,
          title: queueItemTitle(item),
          format: extOf(item.name) || (item.body.type === 'audio' ? item.body.audioFormat : 'mp4'),
          detail: [item.choice, hostOf(item.body.url)].filter(Boolean).join(' · '),
          url: item.body.url,
        });
        resolve();
      },
      onError(message) {
        item.status = item.cancelRequested ? 'cancelled' : 'error';
        item.error = message;
        resolve();
      },
    });
  });

  queueState.running = null;
  updateQueueItem(item);
  updateQueueSummary();
  setJobActive('download', null);
  if (!queueState.items.some((i) => i.status === 'waiting')) {
    const done = queueState.items.filter((i) => i.status === 'done').length;
    if (done) {
      toast(tn(done, 'Queue finished: {n} file saved.', 'Queue finished: {n} files saved.'), { type: 'success' });
      notifyDone(t('Downloads ready'), tn(done, '{n} file saved', '{n} files saved'));
    }
  }
  pumpQueue();
}

$('queue-clear-done').addEventListener('click', () => {
  queueState.items = queueState.items.filter((i) => ['waiting', 'starting', 'queued', 'running'].includes(i.status));
  renderQueue();
});

$('queue-cancel-all').addEventListener('click', () => {
  queueState.items.forEach((i) => { if (i.status === 'waiting') i.status = 'cancelled'; });
  if (queueState.running) cancelQueueItem(queueState.running);
  renderQueue();
});

/* ==========================================================================
   Video converter
   ========================================================================== */
const dropZone = $('drop-zone');
const fileInput = $('file-input');
const fileList = $('file-list');
const formatGridVideo = $('format-grid-video');
const formatGridAudio = $('format-grid-audio');
const convertOptions = $('convert-options');
const resolutionSelect = $('convert-resolution');
const codecSelect = $('convert-codec');
const convertBtn = $('convert-btn');
const progressWrap = $('progress-wrap');
const progressFill = $('progress-fill');
const progressLabel = $('progress-label');
const progressPercent = $('progress-percent');
const convertCancelBtn = $('convert-cancel');
const convertError = $('convert-error');
const convertResult = $('convert-result');
const convertDownloadLink = $('convert-download');

const CODEC_LABELS = { h264: t('H.264 (plays everywhere)'), h265: t('H.265 / HEVC (smaller files)'), vp9: t('VP9 (open, web-friendly)') };
const conv = {
  files: [],
  format: null,
  formats: { video: [], audio: [], lossyAudio: [], codecs: {} },
  running: false,
  current: null,
  cancelRequested: false,
  xhr: null,
  seq: 0,
};

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
    chip.setAttribute('aria-pressed', String(isMatch));
    if (isMatch) {
      chip.classList.remove('pop');
      void chip.offsetWidth;
      chip.classList.add('pop');
    }
  });
}

function formatKind(fmt) {
  if (!fmt) return null;
  if (fmt === 'gif') return 'gif';
  return conv.formats.audio.includes(fmt) ? 'audio' : 'video';
}

function updateOptionVisibility() {
  const kind = formatKind(conv.format);
  convertOptions.classList.toggle('hidden', !kind);
  if (!kind) return;
  const lossy = conv.formats.lossyAudio.includes(conv.format);
  convertOptions.querySelectorAll('[data-for]').forEach((el) => {
    const tags = el.dataset.for.split(' ');
    el.classList.toggle('hidden', !(tags.includes(kind) || (lossy && tags.includes('lossy'))));
  });
  const codecs = conv.formats.codecs[conv.format] || [];
  const previous = codecSelect.value;
  codecSelect.innerHTML = '';
  for (const c of codecs) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = CODEC_LABELS[c] || c;
    codecSelect.appendChild(opt);
  }
  if (codecs.includes(previous)) codecSelect.value = previous;
  // With "Original" quality the codec is only used if re-encoding turns out to be needed.
  $('convert-codec-field').classList.toggle('hidden', kind !== 'video' || codecs.length < 2 || $('convert-quality').value === 'original');
}

function selectConvertFormat(fmt) {
  conv.format = fmt;
  markChip($('page-convert'), fmt);
  updateOptionVisibility();
  updateConvertButton();
}

function fillSelect(select, values, label) {
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = label(v);
    select.appendChild(opt);
  }
}

async function loadFormats() {
  let data;
  try {
    data = await (await fetch('/api/convert/formats')).json();
  } catch {
    data = null;
  }
  if (!data || !Array.isArray(data.video)) {
    data = {
      video: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'gif'],
      audio: ['mp3', 'wav', 'flac', 'aac', 'ogg'],
      resolutions: [1080, 720, 480],
      fps: [60, 30, 24],
      audioBitrates: [128, 192, 256, 320],
      lossyAudio: ['mp3', 'aac', 'ogg'],
      codecs: { mp4: ['h264'] },
    };
  }
  conv.formats = data;
  buildFormatChips(formatGridVideo, data.video, selectConvertFormat);
  buildFormatChips(formatGridAudio, data.audio, selectConvertFormat);
  fillSelect(resolutionSelect, data.resolutions || [], (r) => (r === 2160 ? '2160p (4K)' : `${r}p`));
  fillSelect($('convert-fps'), data.fps || [], (f) => `${f} fps`);
  fillSelect($('convert-audio-bitrate'), data.audioBitrates || [], (b) => `${b} kbps`);
}
loadFormats();
$('convert-quality').addEventListener('change', updateOptionVisibility);

function pendingConvertFiles() {
  return conv.files.filter((f) => ['ready', 'error', 'cancelled'].includes(f.status));
}

function updateConvertButton() {
  const pending = pendingConvertFiles().length;
  convertBtn.disabled = !(pending && conv.format) || conv.running;
  if (!conv.format) convertBtn.textContent = t('Convert');
  else convertBtn.textContent = tn(pending, 'Convert to {format}', 'Convert {n} files to {format}', { format: conv.format.toUpperCase() });
}

const FILE_STATUS_TEXT = {
  ready: '',
  uploading: t('Uploading…'),
  queued: t('Waiting for a free slot…'),
  converting: t('Converting…'),
  done: t('Ready'),
  error: t('Failed'),
  cancelled: t('Cancelled'),
};

function renderFileList() {
  fileList.innerHTML = '';
  for (const f of conv.files) {
    const li = document.createElement('li');
    li.className = 'file-row';
    li.innerHTML = `
      <div class="file-icon"></div>
      <div class="file-text">
        <span class="file-name"></span>
        <span class="muted small file-meta"></span>
        <div class="progress-bar q-bar hidden"><div class="progress-fill"></div></div>
      </div>
      <div class="file-actions"></div>`;
    li.querySelector('.file-icon').innerHTML = icon(f.file.type.startsWith('audio/') ? 'music' : 'film');
    li.querySelector('.file-name').textContent = f.file.name;
    li.querySelector('.file-name').title = f.file.name;
    f.el = li;
    updateFileRow(f);
    fileList.appendChild(li);
  }
  fileList.classList.toggle('hidden', conv.files.length === 0);
  dropZone.classList.toggle('hidden', conv.files.length > 0);
  $('file-add-more').classList.toggle('hidden', conv.files.length === 0 || conv.running);
  updateConvertButton();
}

function updateFileRow(f) {
  const li = f.el;
  if (!li) return;
  li.dataset.status = f.status;
  let status = FILE_STATUS_TEXT[f.status];
  if (f.status === 'converting' || f.status === 'uploading') status = `${status} ${f.percent || 0}%`;
  if (f.status === 'error') status = t(f.error || 'Failed');
  li.querySelector('.file-meta').textContent = [formatBytes(f.file.size), extOf(f.file.name).toUpperCase(), status].filter(Boolean).join(' · ');
  const bar = li.querySelector('.q-bar');
  bar.classList.toggle('hidden', !['uploading', 'queued', 'converting'].includes(f.status));
  bar.classList.toggle('indeterminate', f.status === 'queued');
  li.querySelector('.progress-fill').style.width = `${f.percent || 0}%`;

  const actions = li.querySelector('.file-actions');
  actions.innerHTML = '';
  if (f.status === 'done') {
    const a = document.createElement('a');
    a.className = 'btn btn-secondary btn-sm';
    a.href = `/api/convert/result/${f.jobId}`;
    a.setAttribute('download', f.outName || '');
    a.innerHTML = icon('download');
    a.append(t('Download'));
    actions.appendChild(a);
  }
  if (!conv.running) {
    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.title = t('Remove file');
    remove.setAttribute('aria-label', remove.title);
    remove.innerHTML = icon('x');
    remove.addEventListener('click', () => {
      conv.files = conv.files.filter((x) => x !== f);
      if (!conv.files.length) convertResult.classList.add('hidden');
      renderFileList();
    });
    actions.appendChild(remove);
  }
}

function addConvertFiles(files) {
  if (conv.running) {
    toast(t('Please wait for the current conversion to finish.'), { type: 'error' });
    return;
  }
  // Starting a new batch: drop files that were already converted.
  if (conv.files.length && conv.files.every((f) => f.status === 'done')) conv.files = [];
  for (const file of files) conv.files.push({ id: ++conv.seq, file, status: 'ready', percent: 0 });
  convertError.classList.add('hidden');
  convertResult.classList.add('hidden');
  renderFileList();
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
$('file-add-more').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) addConvertFiles([...fileInput.files]);
  fileInput.value = '';
});

$('size-presets').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mb]');
  if (!btn) return;
  $('convert-target-size').value = btn.dataset.mb;
});

function showConvertError(message) {
  convertError.textContent = t(message);
  convertError.classList.remove('hidden');
}

function visible(el) {
  return !el.closest('.hidden');
}

// Only options that apply to the chosen format are sent.
function readConvertOptions() {
  const opts = {};
  const add = (key, el) => { if (visible(el) && el.value !== '') opts[key] = el.value; };
  add('resolution', resolutionSelect);
  add('quality', $('convert-quality'));
  if (!$('convert-codec-field').classList.contains('hidden') || codecSelect.options.length === 1) add('codec', codecSelect);
  add('fps', $('convert-fps'));
  add('rotate', $('convert-rotate'));
  add('audioBitrate', $('convert-audio-bitrate'));
  if (visible($('convert-trim-start'))) {
    const { start, end } = readTimeRange($('convert-trim-start'), $('convert-trim-end'));
    if (start !== null) opts.trimStart = String(start);
    if (end !== null) opts.trimEnd = String(end);
    if ((start !== null || end !== null) && visible($('convert-fast-cut')) && $('convert-fast-cut').checked) opts.fastCut = '1';
  }
  const size = $('convert-target-size');
  if (visible(size) && size.value) {
    const mb = Number(size.value);
    if (!(mb >= 1)) throw new Error(t('The target size must be at least 1 MB.'));
    opts.targetSizeMB = String(mb);
  }
  if (visible($('convert-mute')) && $('convert-mute').checked) opts.mute = '1';
  if (visible($('convert-normalize')) && $('convert-normalize').checked) opts.normalize = '1';
  return opts;
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
      else reject(new Error(t(data.error || 'Upload failed.')));
    };
    xhr.onerror = () => reject(new Error(t('Upload failed. Check your connection to the server.')));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(formData);
  });
}

function convertOne(f, format, opts, position, total) {
  return new Promise((resolve) => {
    const prefix = total > 1 ? `(${position}/${total}) ` : '';
    const setProgress = (label, pct, overall) => {
      progressLabel.textContent = `${prefix}${label}`;
      progressPercent.textContent = pct === null ? '' : `${pct}%`;
      progressFill.style.width = `${pct || 0}%`;
      setJobActive('convert', Math.round(((position - 1) * 100 + overall) / total));
    };
    const fail = (message) => {
      f.status = conv.cancelRequested ? 'cancelled' : 'error';
      f.error = message;
      f.percent = 0;
      updateFileRow(f);
      resolve();
    };

    f.status = 'uploading';
    f.percent = 0;
    f.error = '';
    updateFileRow(f);
    setProgress(t('Uploading {name}…', { name: f.file.name }), 0, 0);

    const formData = new FormData();
    formData.append('format', format);
    for (const [k, v] of Object.entries(opts)) formData.append(k, v);
    formData.append('file', f.file);

    uploadWithProgress('/api/convert/start', formData, (fraction) => {
      f.percent = Math.round(fraction * 100);
      updateFileRow(f);
      setProgress(f.percent >= 100 ? t('Upload complete, starting…') : t('Uploading {name}…', { name: f.file.name }), f.percent, f.percent / 2);
    }).then((data) => {
      f.jobId = data.jobId;
      conv.current = f;
      if (conv.cancelRequested) fetch(`/api/convert/cancel/${f.jobId}`, { method: 'POST' }).catch(() => {});
      watchJob(`/api/convert/progress/${f.jobId}`, {
        onProgress(d) {
          if (d.status === 'queued') {
            f.status = 'queued';
            setProgress(t('Waiting for a free slot on the server (#{n} in line)…', { n: d.position || 1 }), null, 50);
          } else {
            f.status = 'converting';
            f.percent = d.percent || 0;
            setProgress(d.stage === 'copying' ? t('Copying {name} without re-encoding…', { name: f.file.name }) : t('Converting {name} to {format}…', { name: f.file.name, format: format.toUpperCase() }), f.percent, 50 + f.percent / 2);
          }
          updateFileRow(f);
        },
        onDone(d) {
          f.status = 'done';
          f.percent = 100;
          f.outName = d.name || `${stripExtension(f.file.name)}.${format}`;
          updateFileRow(f);
          addHistory({
            kind: 'convert',
            mediaType: conv.formats.audio.includes(format) ? 'audio' : 'video',
            title: f.outName,
            format,
            detail: [`from ${extOf(f.file.name).toUpperCase() || 'file'}`, opts.resolution ? `${opts.resolution}p` : '', opts.targetSizeMB ? `≤${opts.targetSizeMB} MB` : '', formatBytes(f.file.size)].filter(Boolean).join(' · '),
          });
          resolve();
        },
        onError: fail,
      });
    }).catch((err) => fail(conv.cancelRequested || err.message === 'aborted' ? t('Cancelled') : err.message));
  });
}

convertBtn.addEventListener('click', async () => {
  const files = pendingConvertFiles();
  if (!files.length || !conv.format || conv.running) return;
  let opts;
  try {
    opts = readConvertOptions();
  } catch (err) {
    showConvertError(err.message);
    return;
  }
  const format = conv.format;

  conv.running = true;
  conv.cancelRequested = false;
  convertError.classList.add('hidden');
  convertResult.classList.add('hidden');
  progressWrap.classList.remove('hidden');
  convertCancelBtn.disabled = false;
  renderFileList();

  for (let i = 0; i < files.length; i++) {
    if (conv.cancelRequested) {
      files.slice(i).forEach((f) => { f.status = 'cancelled'; updateFileRow(f); });
      break;
    }
    await convertOne(files[i], format, opts, i + 1, files.length);
  }

  conv.running = false;
  conv.current = null;
  conv.xhr = null;
  progressWrap.classList.add('hidden');
  setJobActive('convert', null);
  renderFileList();

  const done = files.filter((f) => f.status === 'done');
  const failed = files.filter((f) => f.status === 'error');
  if (conv.cancelRequested) toast(t('Conversion cancelled.'));
  if (failed.length === 1 && files.length === 1) showConvertError(failed[0].error);
  else if (failed.length) showConvertError(tn(failed.length, '{n} file failed. See the list above for details.', '{n} files failed. See the list above for details.'));

  if (done.length) {
    $('convert-result-name').textContent = done.length === 1 ? done[0].outName : t('{n} files converted to {format}', { n: done.length, format: format.toUpperCase() });
    $('convert-download-label').textContent = done.length === 1 ? t('Download') : t('Download all');
    $('convert-result-title').textContent = done.length === 1 ? t('Your file is ready') : t('Your files are ready');
    convertDownloadLink.href = done.length === 1 ? `/api/convert/result/${done[0].jobId}` : '#';
    convertDownloadLink.onclick = done.length === 1 ? null : (e) => {
      e.preventDefault();
      // Browsers may ask once to allow several downloads.
      done.forEach((f, i) => setTimeout(() => triggerDownload(`/api/convert/result/${f.jobId}`, f.outName), i * 400));
    };
    convertResult.classList.remove('hidden');
    const summary = tn(done.length, 'Converted to {format}', 'Converted {n} files to {format}', { format: format.toUpperCase() });
    toast(summary, {
      type: 'success',
      action: currentPage !== 'convert' ? { label: t('View'), onClick: () => navigate('convert') } : undefined,
    });
    notifyDone(t('Conversion finished'), summary);
  }
});

convertCancelBtn.addEventListener('click', async () => {
  if (!conv.running) return;
  conv.cancelRequested = true;
  convertCancelBtn.disabled = true;
  progressLabel.textContent = t('Cancelling…');
  const current = conv.current;
  if (conv.xhr && conv.xhr.readyState !== 4) conv.xhr.abort();
  if (current?.jobId && !['done', 'error', 'cancelled'].includes(current.status)) {
    await fetch(`/api/convert/cancel/${current.jobId}`, { method: 'POST' }).catch(() => {});
  }
});

/* ==========================================================================
   Image converter
   ========================================================================== */
let IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff', 'gif', 'webp', 'avif', 'webm'];

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
const imageQuality = $('image-quality');

const img = { uploadId: null, originalName: '', format: null, previewUrl: null, size: 0, qualityFormats: ['jpg', 'webp', 'avif'] };

function selectImageFormat(fmt) {
  img.format = fmt;
  markChip(imageFormatGrid, fmt);
  $('image-quality-field').classList.toggle('hidden', !img.qualityFormats.includes(fmt));
  imageConvertBtn.disabled = false;
  imageConvertBtn.textContent = t('Convert to {format} & download', { format: fmt.toUpperCase() });
}

async function loadImageFormats() {
  let data = null;
  try { data = await (await fetch('/api/image/formats')).json(); } catch { /* ignore */ }
  const formats = data?.formats || ['png', 'jpg', 'bmp', 'tif', 'gif', 'webm'];
  if (data?.qualityFormats) img.qualityFormats = data.qualityFormats;
  if (data?.accepted) IMAGE_EXTENSIONS = data.accepted;
  buildFormatChips(imageFormatGrid, formats, selectImageFormat);
}
loadImageFormats();

imageQuality.addEventListener('input', () => { $('image-quality-value').textContent = imageQuality.value; });

function showImageError(message) {
  imageError.textContent = t(message);
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
  $('image-quality-field').classList.add('hidden');
  imageConvertBtn.disabled = true;
  imageConvertBtn.textContent = t('Convert & download');
  if (!keepError) imageError.classList.add('hidden');
  imageFormatGrid.querySelectorAll('.format-chip').forEach((chip) => chip.classList.remove('selected'));
}

function buildGifFrames(uploadId, frameCount, truncated) {
  gifFramesGrid.innerHTML = '';
  $('gif-frames-heading').textContent = truncated ? t('Frames (first {n})', { n: frameCount }) : t('Frames ({n})', { n: frameCount });

  for (let i = 1; i <= frameCount; i++) {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'gif-frame-thumb';
    thumb.title = t('Save frame {n}', { n: i });
    thumb.innerHTML = `<img src="/api/image/frame/${uploadId}/${i}" alt="Frame ${i}" loading="lazy" /><span class="frame-index">${i}</span><span class="frame-download-icon">${icon('download')}</span>`;
    thumb.addEventListener('click', () => triggerDownload(`/api/image/frame/${uploadId}/${i}/download`));
    gifFramesGrid.appendChild(thumb);
  }
  gifFramesSection.classList.remove('hidden');
}

async function uploadImageFile(file) {
  if (!IMAGE_EXTENSIONS.includes(extOf(file.name))) {
    showImageError(t('Unsupported file type. Use PNG, JPG, WebP, AVIF, BMP, TIFF, GIF or WebM.'));
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
    if (!res.ok) throw new Error(t(data.error || 'Upload failed.'));

    img.uploadId = data.uploadId;
    img.originalName = data.originalName;
    if (data.width && data.height) {
      $('image-file-meta').textContent = [formatBytes(file.size), extOf(file.name).toUpperCase(), `${data.width}×${data.height}`].join(' · ');
    }
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
  const body = { uploadId: img.uploadId, format };
  const maxWidth = Number($('image-max-width').value);
  const maxHeight = Number($('image-max-height').value);
  if (maxWidth > 0) body.maxWidth = Math.round(maxWidth);
  if (maxHeight > 0) body.maxHeight = Math.round(maxHeight);
  if (img.qualityFormats.includes(format)) body.quality = Number(imageQuality.value);

  imageError.classList.add('hidden');
  imageProgressWrap.classList.remove('hidden');
  imageConvertBtn.disabled = true;
  setJobActive('image', true);

  try {
    const { jobId } = await postJson('/api/image/convert', body);
    // Wait for the server, then let the browser download the file directly
    // (streamed to disk instead of held in memory).
    const data = await new Promise((resolve, reject) => {
      watchJob(`/api/image/progress/${jobId}`, { onProgress() {}, onDone: resolve, onError: (m) => reject(new Error(m)) });
    });
    const filename = data.name || `${stripExtension(img.originalName)}.${format}`;
    triggerDownload(`/api/image/result/${jobId}`, filename);

    toast(t('Saved {name}', { name: filename }), { type: 'success' });
    notifyDone(t('Image converted'), filename);
    addHistory({
      kind: 'image',
      title: filename,
      format,
      detail: [`from ${extOf(img.originalName).toUpperCase()}`, body.maxWidth || body.maxHeight ? 'resized' : ''].filter(Boolean).join(' · '),
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
  const files = [...e.dataTransfer.files];
  const mediaFiles = files.filter((f) => isMediaFile(f) && !isImageFile(f));
  if (files.length > 1 && mediaFiles.length > 1) {
    if (disabledPages.has('convert')) { toast(t('Video conversion is turned off on this server.'), { type: 'error' }); return; }
    navigate('convert');
    addConvertFiles(mediaFiles);
    return;
  }
  if (files[0]) routeDroppedFile(files[0]);
});

function isImageFile(file) {
  const ext = extOf(file.name);
  return (file.type.startsWith('image/') || (currentPage === 'image' && IMAGE_EXTENSIONS.includes(ext))) && IMAGE_EXTENSIONS.includes(ext);
}

function isMediaFile(file) {
  return file.type.startsWith('video/') || file.type.startsWith('audio/') || ['mkv', 'flv', 'ts', 'm4a', 'opus', 'wmv'].includes(extOf(file.name));
}

function routeDroppedFile(file) {
  const isImage = isImageFile(file);
  const isMedia = isMediaFile(file);

  if (isImage && IMAGE_EXTENSIONS.includes(ext)) {
    if (disabledPages.has('image')) { toast(t('Image conversion is turned off on this server.'), { type: 'error' }); return; }
    navigate('image');
    uploadImageFile(file);
  } else if (isMedia) {
    if (disabledPages.has('convert')) { toast(t('Video conversion is turned off on this server.'), { type: 'error' }); return; }
    navigate('convert');
    addConvertFiles([file]);
  } else {
    toast(t('Vidget can\'t convert “{name}”.', { name: file.name }), { type: 'error' });
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
  if (isTypingTarget(e.target) || disabledPages.has('download')) return;
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
    toast(t('New activity will no longer be saved.'), {
      action: { label: t('Clear existing'), onClick: () => { saveHistory([]); updateHistoryCount(); } },
    });
  }
});

function bindSelect(id, key) {
  const el = $(id);
  el.value = settings[key];
  el.addEventListener('change', () => { settings[key] = el.value; saveSettings(); });
}
/* ---------- Notifications (opt-in, only while the tab is in the background) ---------- */
function notifyDone(title, body) {
  if (!settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden) return; // the toast is enough when the page is visible
  try {
    const n = new Notification(title, { body, tag: 'vidget-job', lang: document.documentElement.lang });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* some browsers only allow notifications from a service worker */ }
}

const notificationsToggle = $('notifications-toggle');
notificationsToggle.checked = !!settings.notifications && 'Notification' in window && Notification.permission === 'granted';
notificationsToggle.addEventListener('change', async () => {
  if (!notificationsToggle.checked) {
    settings.notifications = false;
    saveSettings();
    return;
  }
  if (!('Notification' in window)) {
    notificationsToggle.checked = false;
    toast(t("This browser doesn't support notifications."), { type: 'error' });
    return;
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    notificationsToggle.checked = false;
    toast(t('Notifications are blocked for this site. Allow them in your browser settings to turn this on.'), { type: 'error' });
    return;
  }
  settings.notifications = true;
  saveSettings();
  toast(t("You'll get a notification when a job finishes in the background."), { type: 'success' });
});

const languageSelect = $('language-select');
languageSelect.value = settings.language || 'auto';
languageSelect.addEventListener('change', () => {
  settings.language = languageSelect.value;
  saveSettings();
  // Re-render everything in the new language.
  location.reload();
});

bindSelect('default-quality', 'defaultQuality');
bindSelect('default-audio-format', 'defaultAudioFormat');

$('clear-local-data').addEventListener('click', () => {
  if (!confirm(t('Clear your Vidget settings and history from this browser?'))) return;
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
  return tn(days, '{n} day', '{n} days');
}

const ANNOUNCEMENT_KEY = 'vidget:dismissed-announcement';

function applyInstanceMeta(meta) {
  siteName = meta.siteName || 'Vidget';
  document.querySelectorAll('.brand-name').forEach((el) => { el.textContent = siteName; });
  document.querySelectorAll('.brand-mark').forEach((el) => { el.textContent = siteName.charAt(0).toUpperCase(); });
  const sub = document.querySelector('.brand-sub');
  if (sub) { sub.textContent = t(meta.tagline || ''); sub.hidden = !meta.tagline; }

  const banner = $('announcement');
  let dismissed = null;
  try { dismissed = localStorage.getItem(ANNOUNCEMENT_KEY); } catch { /* ignore */ }
  if (meta.announcement && dismissed !== meta.announcement) {
    $('announcement-text').textContent = meta.announcement;
    banner.hidden = false;
    $('announcement-close').onclick = () => {
      banner.hidden = true;
      try { localStorage.setItem(ANNOUNCEMENT_KEY, meta.announcement); } catch { /* ignore */ }
    };
  }

  const features = meta.features || {};
  const pageFeature = { download: 'downloader', convert: 'videoConverter', image: 'imageConverter' };
  for (const [page, key] of Object.entries(pageFeature)) {
    if (features[key] === false) disabledPages.add(page);
    document.querySelectorAll(`.nav-item[data-page="${page}"]`).forEach((n) => { n.hidden = disabledPages.has(page); });
  }
  document.querySelectorAll('a.brand').forEach((a) => { a.href = `#${firstAvailablePage()}`; });
  if (disabledPages.has(currentPage)) showPage(currentPage);
  else updateTitle();
}

fetch('/api/meta')
  .then((r) => r.json())
  .then((meta) => {
    applyInstanceMeta(meta);
    $('fact-version').textContent = `v${meta.version}`;
    $('sidebar-version').textContent = `Vidget v${meta.version}`;
    const logs = $('fact-logs');
    logs.textContent = describeRetention(meta.logRetentionDays, { never: t('Off'), forever: t('On (kept forever)') });
    if (meta.logRetentionDays !== 0 && meta.logRetentionDays !== '*') logs.textContent = t('On (kept {time})', { time: logs.textContent });
    logs.classList.toggle('good', meta.logRetentionDays === 0);
    const ttl = formatMinutes(meta.resultTtlMinutes || 30);
    $('fact-saves').textContent = meta.keepCopies ? t('After {time} (the owner keeps copies)', { time: ttl }) : t('After {time}', { time: ttl });
    $('fact-video-limit').textContent = formatBytes(meta.limits.videoUploadMB * 1024 * 1024);
    $('fact-image-limit').textContent = formatBytes(meta.limits.imageUploadMB * 1024 * 1024);
    document.querySelectorAll('.ttl-text').forEach((el) => { el.textContent = ttl; });
    $('video-limit-text').textContent = formatBytes(meta.limits.videoUploadMB * 1024 * 1024);
    $('image-limit-text').textContent = formatBytes(meta.limits.imageUploadMB * 1024 * 1024);
    if (meta.keepCopies) {
      const li = document.createElement('li');
      const b = document.createElement('strong');
      b.textContent = t('Copies:');
      li.append(b, ' ', t('the owner of this server keeps a copy of downloads and uploaded images ({retention}).', { retention: describeRetention(meta.savesRetentionDays, { never: t('removed within an hour'), forever: t('kept indefinitely') }) }));
      $('files-policy').appendChild(li);
    }
    renderPrivacyPage(meta);
  })
  .catch(() => {});

function formatMinutes(minutes) {
  if (minutes % 60 === 0) return tn(minutes / 60, '{n} hour', '{n} hours');
  return tn(minutes, '{n} minute', '{n} minutes');
}

function listItem(strong, text) {
  const li = document.createElement('li');
  if (strong) {
    const b = document.createElement('strong');
    b.textContent = t(strong);
    li.append(b, ' ');
  }
  li.append(t(text));
  return li;
}

// Builds the Privacy & terms page from the server's live settings.
function renderPrivacyPage(meta) {
  const ttl = formatMinutes(meta.resultTtlMinutes || 30);
  const limits = meta.limits || {};

  const stored = $('privacy-stored');
  stored.innerHTML = '';
  stored.appendChild(meta.logRetentionDays === 0
    ? listItem('No download log.', 'Nothing records what you download.')
    : listItem('A download log', t('records your IP address and the link and title of each download. It is kept {time}.', { time: meta.logRetentionDays === '*' ? t('indefinitely') : t('for {time}', { time: describeRetention(meta.logRetentionDays, {}) }) })));
  stored.appendChild(listItem('Your files', t("(downloads, conversions and uploads) are only kept on the server until you've had time to save them, then deleted after {time}.", { time: ttl })));
  if (meta.keepCopies) {
    stored.appendChild(listItem('Copies:', t('the owner of this server keeps a copy of downloads and uploaded images ({retention}).', { retention: describeRetention(meta.savesRetentionDays, { never: t('removed within an hour'), forever: t('kept indefinitely') }) })));
  }
  stored.appendChild(listItem('Abuse limits', 'use your IP address in memory only, to count running jobs and recent requests. Nothing is written to disk and it is forgotten within minutes.'));
  stored.appendChild(listItem('Converted files', 'have location, device and other metadata removed.'));

  const facts = $('privacy-limits');
  facts.innerHTML = '';
  const fact = (dt, dd) => {
    const div = document.createElement('div');
    const t = document.createElement('dt');
    const d = document.createElement('dd');
    t.textContent = dt;
    d.textContent = dd;
    div.append(t, d);
    facts.appendChild(div);
  };
  fact(t('Max download quality'), limits.maxQuality ? `${limits.maxQuality}p` : t('No limit'));
  fact(t('Max media length'), limits.maxDurationMinutes ? formatMinutes(limits.maxDurationMinutes) : t('No limit'));
  fact(t('Max video upload'), formatBytes(limits.videoUploadMB * 1024 * 1024));
  fact(t('Max image upload'), formatBytes(limits.imageUploadMB * 1024 * 1024));
  fact(t('Playlists'), limits.maxPlaylistItems ? t('Up to {n} items', { n: limits.maxPlaylistItems }) : t('Turned off'));
  fact(t('Jobs per visitor at once'), String(limits.maxJobsPerIp));
  fact(t('Requests per minute'), limits.requestsPerMinute ? String(limits.requestsPerMinute) : t('No limit'));
  fact(t('Download links expire'), t('After {time}', { time: ttl }));

  const sites = meta.sites || { mode: 'all', list: [] };
  $('privacy-sites').textContent = sites.mode === 'allow'
    ? t('This server only downloads from: {sites}.', { sites: sites.list.join(', ') || t('(no sites)') })
    : sites.mode === 'block' && sites.list.length
      ? t("This server doesn't download from: {sites}.", { sites: sites.list.join(', ') })
      : t('This server supports the sites yt-dlp supports, unless the owner blocks them.');

  // Admin-written terms: plain text only (textContent), line breaks kept by CSS.
  const terms = (meta.terms || '').trim();
  $('privacy-terms').textContent = terms;
  $('privacy-terms-card').classList.toggle('hidden', !terms);

  const contact = $('privacy-contact');
  contact.innerHTML = '';
  const value = (meta.contact || '').trim();
  if (!value) {
    contact.textContent = t("The owner of this server hasn't published a contact address for copyright or abuse reports.");
    return;
  }
  contact.append(`${t('To report copyright infringement or abuse, contact the owner of this server:')} `);
  let href = null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) href = `mailto:${value}`;
  else if (/^https?:\/\//i.test(value)) href = value;
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = value;
    a.rel = 'noopener noreferrer';
    if (href.startsWith('http')) a.target = '_blank';
    contact.appendChild(a);
  } else {
    contact.append(value);
  }
}

/* ==========================================================================
   Boot
   ========================================================================== */
/* ---------- Accessibility wiring ---------- */
// Settings rows: give each control the row's title as its accessible name.
document.querySelectorAll('.setting').forEach((row) => {
  const name = row.querySelector('.setting-text strong')?.textContent.trim();
  if (!name) return;
  row.querySelectorAll('input, select, .segmented, .accent-swatches').forEach((el) => {
    if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) el.setAttribute('aria-label', name);
  });
});
// Fields whose visible label is a sibling <span> rather than a <label>.
document.querySelectorAll('.field').forEach((field) => {
  const label = field.querySelector(':scope > .field-label');
  const control = field.querySelector(':scope > select, :scope > .segmented');
  if (label && control && !control.hasAttribute('aria-label')) {
    if (!label.id) label.id = `lbl-${Math.random().toString(36).slice(2, 9)}`;
    control.setAttribute('aria-labelledby', label.id);
  }
});
// Keep role="progressbar" values in sync with the visual fill width.
const progressObserver = new MutationObserver((records) => {
  for (const r of records) {
    const bar = r.target.parentElement;
    if (bar?.getAttribute('role') === 'progressbar') {
      bar.setAttribute('aria-valuenow', String(parseInt(r.target.style.width, 10) || 0));
    }
  }
});
document.querySelectorAll('[role="progressbar"] > .progress-fill').forEach((fill) => {
  progressObserver.observe(fill, { attributes: true, attributeFilter: ['style'] });
});
$('drop-zone').setAttribute('aria-describedby', 'video-limit-text');

updateHistoryCount();
showPage(location.hash.slice(1) || 'download');
