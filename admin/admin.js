/* Vidget admin portal */
const $ = (id) => document.getElementById(id);

/* ---------- Theme: follow the visitor's public-site preference, else the OS ---------- */
(function applyTheme() {
  // Keep in sync with ACCENTS in public/js/app.js.
  const ACCENTS = { violet: ['#7c5cff', '#f0508f'], pink: ['#f0508f', '#7c5cff'], teal: ['#14b8a6', '#3b82f6'], amber: ['#f59e0b', '#f0508f'], blue: ['#3b82f6', '#14b8a6'] };
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('vidget:settings')) || {}; } catch { /* ignore */ }
  const theme = prefs.theme === 'light' || prefs.theme === 'dark'
    ? prefs.theme
    : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  const accent = ACCENTS[prefs.accent];
  if (accent) {
    document.documentElement.style.setProperty('--accent', accent[0]);
    document.documentElement.style.setProperty('--accent-2', accent[1]);
  }
})();

/* ---------- Helpers ---------- */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/admin/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/login' && path !== '/account') {
    showView('login');
    throw new Error(data.error || 'Please sign in.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const msg = document.createElement('span');
  msg.className = 'toast-msg';
  msg.textContent = message;
  el.appendChild(msg);
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function showView(name) {
  for (const v of ['loading', 'setup', 'login', 'dashboard']) $(`view-${v}`).hidden = v !== name;
  const focus = { setup: 'setup-token', login: 'login-username' }[name];
  if (focus) setTimeout(() => $(focus).focus(), 0);
}

function bindSubmit(form, errorEl, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await handler();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- Setup ---------- */
bindSubmit($('setup-form'), $('setup-error'), async () => {
  if ($('setup-password').value !== $('setup-confirm').value) throw new Error('Passwords do not match.');
  await api('/setup', {
    method: 'POST',
    body: { token: $('setup-token').value, username: $('setup-username').value, password: $('setup-password').value },
  });
  toast('Admin account created. Vidget is now open to visitors.', 'success');
  await openDashboard();
});

/* ---------- Login / logout ---------- */
bindSubmit($('login-form'), $('login-error'), async () => {
  await api('/login', { method: 'POST', body: { username: $('login-username').value, password: $('login-password').value } });
  $('login-password').value = '';
  await openDashboard();
});

$('logout-btn').addEventListener('click', async () => {
  await api('/logout', { method: 'POST', body: {} }).catch(() => {});
  showView('login');
});

/* ---------- Dashboard: stats ---------- */
const STORAGE_LABELS = {
  video: ['Saves/video', 'Downloaded videos'],
  audio: ['Saves/audio', 'Downloaded audio'],
  Uploaded: ['Saves/Uploaded', 'Uploaded images'],
  temp: ['tmp/', 'Work files and results waiting to be downloaded'],
  logs: ['logs/', 'Download log'],
};

async function loadStats() {
  const s = await api('/stats');
  $('stat-version').textContent = `v${s.version}`;
  $('stat-uptime').textContent = formatUptime(s.uptimeSeconds);
  $('stat-jobs').textContent = `${s.activeJobs} / ${s.queuedJobs}`;
  $('stat-port').textContent = String(s.port);
  $('stat-runtime').textContent = `Node ${s.node} on ${s.platform}`;
  renderToolStatus(s);
  const list = $('storage-list');
  list.replaceChildren();
  for (const [key, [path, label]] of Object.entries(STORAGE_LABELS)) {
    const st = s.storage[key] || { files: 0, bytes: 0 };
    const row = document.createElement('div');
    row.className = 'storage-row';
    const left = document.createElement('span');
    const code = document.createElement('code');
    code.textContent = path;
    left.append(code, document.createTextNode(label));
    const right = document.createElement('span');
    right.className = 'muted';
    right.textContent = `${st.files} file${st.files === 1 ? '' : 's'} · ${formatBytes(st.bytes)}`;
    row.append(left, right);
    list.appendChild(row);
  }
}
function timeAgo(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function renderYtdlpStatus(y) {
  const parts = [y.version ? `yt-dlp ${y.version}` : 'yt-dlp version unknown'];
  if (y.updating) parts.push('updating…');
  else if (y.lastCheck) parts.push(`last checked ${timeAgo(y.lastCheck)}`);
  if (y.message && !y.updating) parts.push(y.message);
  const el = $('ytdlp-status');
  el.textContent = parts.join(' · ');
  el.classList.toggle('bad', y.lastResult === 'failed');
}

function renderToolStatus(s) {
  if (s.ytdlp) renderYtdlpStatus(s.ytdlp);
  const hw = s.hardware || {};
  const hwEl = $('hw-status');
  if (!hw.checked) hwEl.textContent = 'Checking which GPU encoders work…';
  else if (hw.h264 || hw.h265) hwEl.textContent = `Working on this server: ${[hw.h264, hw.h265].filter(Boolean).join(', ')}.`;
  else hwEl.textContent = 'No working GPU encoder was found on this server, so conversions will use the CPU.';
  hwEl.classList.toggle('bad', hw.checked && !hw.h264 && !hw.h265);
  const f = s.ffmpeg || {};
  const extras = [f.heif ? 'HEIC/HEIF photos' : null, f.animatedWebp ? 'animated WebP' : null].filter(Boolean);
  $('ffmpeg-status').textContent = `ffmpeg ${f.version || 'unknown'}${f.custom ? ' (custom, from VIDGET_FFMPEG)' : ' (bundled)'}. `
    + (extras.length
      ? `Can also read ${extras.join(' and ')}.`
      : 'For HEIC/HEIF photos and animated WebP, point VIDGET_FFMPEG at ffmpeg 7.1 or newer (8.0+ for animated WebP).');
}

$('ytdlp-update-btn').addEventListener('click', async () => {
  const btn = $('ytdlp-update-btn');
  btn.disabled = true;
  btn.textContent = 'Updating…';
  renderYtdlpStatus({ updating: true });
  try {
    const y = await api('/ytdlp/update', { method: 'POST', body: {} });
    renderYtdlpStatus(y);
    toast(y.lastResult === 'failed' ? `yt-dlp update failed: ${y.message}` : y.message, y.lastResult === 'failed' ? 'error' : 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update now';
  }
});

$('refresh-stats').addEventListener('click', () => loadStats().catch((e) => toast(e.message, 'error')));

document.querySelectorAll('[data-purge]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const target = btn.dataset.purge;
    const what = target === 'saves' ? 'every file in Saves/' : 'the download log';
    if (!confirm(`Permanently delete ${what}? This can't be undone.`)) return;
    try {
      await api('/purge', { method: 'POST', body: { target } });
      toast('Deleted.', 'success');
      loadStats();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
});

/* ---------- Dashboard: settings form ---------- */
let saved = null;
const form = $('settings-form');

function setRetention(key, value) {
  const wrap = form.querySelector(`.retention[data-key="${key}"]`);
  const select = wrap.querySelector('select');
  const input = wrap.querySelector('input');
  if (value === '*') select.value = 'forever';
  else if (value === 0) select.value = 'off';
  else { select.value = 'days'; input.value = value; }
  if (!input.value) input.value = 30;
  wrap.classList.toggle('days', select.value === 'days');
}

function getRetention(key) {
  const wrap = form.querySelector(`.retention[data-key="${key}"]`);
  const mode = wrap.querySelector('select').value;
  if (mode === 'forever') return '*';
  if (mode === 'off') return 0;
  return Math.max(1, Math.round(Number(wrap.querySelector('input').value) || 1));
}

form.querySelectorAll('.retention select').forEach((sel) => {
  sel.addEventListener('change', () => sel.parentElement.classList.toggle('days', sel.value === 'days'));
});

function fillForm(s) {
  $('s-siteName').value = s.siteName;
  $('s-tagline').value = s.tagline;
  $('s-announcement').value = s.announcement;
  $('s-contact').value = s.contact;
  $('s-terms').value = s.terms;
  updateTermsCount();
  $('s-keepCopies').checked = s.storage.keepCopies;
  $('s-resultTtlMinutes').value = s.storage.resultTtlMinutes;
  for (const k of ['maxPlaylistItems', 'maxConcurrentJobs', 'maxJobsPerIp', 'requestsPerMinute', 'maxJobMinutes']) $(`s-${k}`).value = s.limits[k];
  $('s-sitesMode').value = s.sites.mode;
  $('s-sitesList').value = s.sites.list.join('\n');
  $('sites-list-field').classList.toggle('hidden', s.sites.mode === 'all');
  $('s-trustProxy').checked = s.trustProxy;
  $('s-host').value = s.host;
  $('s-ytdlpAutoUpdate').checked = s.ytdlpAutoUpdate;
  $('s-hardwareEncoding').checked = s.hardwareEncoding;
  for (const k of ['downloader', 'videoConverter', 'imageConverter']) $(`s-feature-${k}`).checked = s.features[k];
  $('s-maxQuality').value = String(s.limits.maxQuality);
  $('s-maxDurationMinutes').value = s.limits.maxDurationMinutes;
  $('s-videoUploadMB').value = s.limits.videoUploadMB;
  $('s-imageUploadMB').value = s.limits.imageUploadMB;
  setRetention('logRetentionDays', s.logRetentionDays);
  setRetention('savesRetentionDays', s.savesRetentionDays);
  $('s-port').value = s.port;
  $('dash-site-name').textContent = s.siteName;
  markDirty();
}

function readForm() {
  return {
    siteName: $('s-siteName').value.trim(),
    tagline: $('s-tagline').value.trim(),
    announcement: $('s-announcement').value.trim(),
    contact: $('s-contact').value.trim(),
    terms: $('s-terms').value.trim(),
    trustProxy: $('s-trustProxy').checked,
    host: $('s-host').value.trim(),
    ytdlpAutoUpdate: $('s-ytdlpAutoUpdate').checked,
    hardwareEncoding: $('s-hardwareEncoding').checked,
    storage: {
      keepCopies: $('s-keepCopies').checked,
      resultTtlMinutes: Math.round(Number($('s-resultTtlMinutes').value)),
    },
    sites: {
      mode: $('s-sitesMode').value,
      list: $('s-sitesList').value.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean),
    },
    features: {
      downloader: $('s-feature-downloader').checked,
      videoConverter: $('s-feature-videoConverter').checked,
      imageConverter: $('s-feature-imageConverter').checked,
    },
    limits: {
      maxQuality: Number($('s-maxQuality').value),
      maxDurationMinutes: Math.max(0, Math.round(Number($('s-maxDurationMinutes').value) || 0)),
      videoUploadMB: Math.round(Number($('s-videoUploadMB').value)),
      imageUploadMB: Math.round(Number($('s-imageUploadMB').value)),
      maxPlaylistItems: Math.round(Number($('s-maxPlaylistItems').value)),
      maxConcurrentJobs: Math.round(Number($('s-maxConcurrentJobs').value)),
      maxJobsPerIp: Math.round(Number($('s-maxJobsPerIp').value)),
      requestsPerMinute: Math.round(Number($('s-requestsPerMinute').value)),
      maxJobMinutes: Math.round(Number($('s-maxJobMinutes').value)),
    },
    logRetentionDays: getRetention('logRetentionDays'),
    savesRetentionDays: getRetention('savesRetentionDays'),
    port: Math.round(Number($('s-port').value)),
  };
}

function comparable(s) {
  return JSON.stringify({
    siteName: s.siteName, tagline: s.tagline, announcement: s.announcement, contact: s.contact, terms: s.terms, trustProxy: s.trustProxy,
    host: s.host, ytdlpAutoUpdate: s.ytdlpAutoUpdate, hardwareEncoding: s.hardwareEncoding,
    features: s.features, storage: s.storage, sites: s.sites,
    limits: s.limits, logRetentionDays: s.logRetentionDays, savesRetentionDays: s.savesRetentionDays, port: s.port,
  });
}

function markDirty() {
  if (!saved) return;
  const dirty = comparable(readForm()) !== comparable(saved);
  $('save-bar').classList.toggle('dirty', dirty);
  $('save-status').textContent = dirty ? 'You have unsaved changes' : 'No unsaved changes';
  $('save-btn').disabled = !dirty;
  $('discard-btn').disabled = !dirty;
}
$('s-sitesMode').addEventListener('change', () => { $('sites-list-field').classList.toggle('hidden', $('s-sitesMode').value === 'all'); });
function updateTermsCount() {
  const n = $('s-terms').value.length;
  $('terms-count').textContent = n ? `${n} / 5000 characters.` : '';
}
$('s-terms').addEventListener('input', updateTermsCount);
form.addEventListener('input', markDirty);
form.addEventListener('change', markDirty);
$('discard-btn').addEventListener('click', () => fillForm(saved));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form.reportValidity()) return;
  $('save-btn').disabled = true;
  try {
    const portBefore = saved.port;
    const res = await api('/settings', { method: 'PUT', body: readForm() });
    saved = res.settings;
    fillForm(saved);
    let message = 'Settings saved and live.';
    if (res.restartRequired) message = 'Saved. Restart Vidget to use the new port or listen address.';
    else if (res.portOverridden && saved.port !== portBefore) message = 'Saved. Note: the PORT environment variable overrides the port setting.';
    toast(message, 'success');
  } catch (err) {
    toast(err.message, 'error');
    markDirty();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (!$('view-dashboard').hidden && !$('save-btn').disabled) e.preventDefault();
});

/* ---------- Account ---------- */
bindSubmit($('account-form'), $('account-error'), async () => {
  const newPassword = $('a-new').value;
  if (newPassword !== $('a-confirm').value) throw new Error('New passwords do not match.');
  const res = await api('/account', {
    method: 'POST',
    body: { currentPassword: $('a-current').value, newPassword: newPassword || undefined, newUsername: $('a-username').value },
  });
  for (const id of ['a-new', 'a-confirm', 'a-current']) $(id).value = '';
  $('dash-user').textContent = `Signed in as ${res.username}`;
  toast('Account updated.', 'success');
});

/* ---------- Boot ---------- */
async function openDashboard() {
  const [state, data] = await Promise.all([api('/state'), api('/settings')]);
  const q = $('s-maxQuality');
  q.replaceChildren();
  for (const h of data.qualityCaps) {
    const opt = document.createElement('option');
    opt.value = String(h);
    opt.textContent = h ? `${h}p` : 'No limit';
    q.appendChild(opt);
  }
  saved = data.settings;
  fillForm(saved);
  $('a-username').value = state.username || '';
  $('dash-user').textContent = state.username ? `Signed in as ${state.username}` : '';
  showView('dashboard');
  loadStats().catch(() => {});
}

(async function boot() {
  try {
    const state = await api('/state');
    $('setup-password-hint').textContent = `At least ${state.minPasswordLength} characters.`;
    if (!state.configured) showView('setup');
    else if (!state.authenticated) showView('login');
    else await openDashboard();
  } catch (err) {
    $('view-loading').querySelector('p').textContent = `Could not reach the server: ${err.message}`;
  }
})();
