// ---------- Settings ----------
const ACCENT_PALETTES = {
  violet: { accent: '#7c5cff', accent2: '#ff5c9c' },
  pink: { accent: '#ff5c9c', accent2: '#7c5cff' },
  teal: { accent: '#22c7ab', accent2: '#3d8bff' },
  amber: { accent: '#ffa53d', accent2: '#ff5c9c' },
  blue: { accent: '#3d8bff', accent2: '#22c7ab' },
};

const SETTINGS_KEY = 'vidget:settings';
const DEFAULT_SETTINGS = { theme: 'dark', accent: 'violet', reduceMotion: false, animatedBackground: false, defaultQuality: '' };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore persistence failures (e.g. private browsing) */
  }
}

let settings = loadSettings();

function applySettings() {
  if (settings.theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }

  const palette = ACCENT_PALETTES[settings.accent] || ACCENT_PALETTES.violet;
  document.documentElement.style.setProperty('--accent', palette.accent);
  document.documentElement.style.setProperty('--accent-2', palette.accent2);

  document.documentElement.classList.toggle('reduce-motion', !!settings.reduceMotion);
  document.documentElement.classList.toggle('bg-animated', !!settings.animatedBackground && !settings.reduceMotion);
}

applySettings();

// ---------- Ripple + micro-interactions on every button ----------
function createRipple(el, x, y) {
  const rect = el.getBoundingClientRect();
  const ripple = document.createElement('span');
  const size = Math.max(rect.width, rect.height) * 1.2;
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${x - rect.left - size / 2}px`;
  ripple.style.top = `${y - rect.top - size / 2}px`;
  el.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('.btn-primary, .btn-secondary, .tab, .format-chip, .icon-btn, .swatch, .segmented button');
  if (!el || el.disabled) return;
  createRipple(el, e.clientX || 0, e.clientY || 0);
});

// ---------- Settings drawer ----------
const settingsBtn = document.getElementById('settings-btn');
const drawer = document.getElementById('settings-drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const drawerClose = document.getElementById('drawer-close');

function openDrawer() {
  drawer.classList.add('open');
  drawerOverlay.classList.add('visible');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawerOverlay.classList.remove('visible');
  drawer.setAttribute('aria-hidden', 'true');
}

settingsBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

// ---------- Theme segmented control ----------
const themeOptions = document.getElementById('theme-options');
const themeIndicator = themeOptions.querySelector('.segmented-indicator');

function moveSegmentedIndicator(container, indicator, activeBtn) {
  if (!activeBtn) return;
  const containerRect = container.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  const containerPadding = parseFloat(getComputedStyle(container).paddingLeft) || 0;
  indicator.style.width = `${btnRect.width}px`;
  indicator.style.transform = `translateX(${btnRect.left - containerRect.left - containerPadding}px)`;
}

function setThemeUI(theme) {
  const buttons = themeOptions.querySelectorAll('button[data-theme-choice]');
  buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset.themeChoice === theme));
  moveSegmentedIndicator(themeOptions, themeIndicator, themeOptions.querySelector(`button[data-theme-choice="${theme}"]`));
}

themeOptions.querySelectorAll('button[data-theme-choice]').forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.theme = btn.dataset.themeChoice;
    saveSettings(settings);
    applySettings();
    setThemeUI(settings.theme);
  });
});

// ---------- Accent swatches ----------
const accentSwatches = document.getElementById('accent-swatches');

function setAccentUI(accent) {
  accentSwatches.querySelectorAll('.swatch').forEach((sw) => sw.classList.toggle('selected', sw.dataset.accent === accent));
}

accentSwatches.querySelectorAll('.swatch').forEach((sw) => {
  sw.addEventListener('click', () => {
    settings.accent = sw.dataset.accent;
    saveSettings(settings);
    applySettings();
    setAccentUI(settings.accent);
  });
});

// ---------- Reduce motion toggle ----------
const reduceMotionToggle = document.getElementById('reduce-motion-toggle');
reduceMotionToggle.checked = settings.reduceMotion;
reduceMotionToggle.addEventListener('change', () => {
  settings.reduceMotion = reduceMotionToggle.checked;
  saveSettings(settings);
  applySettings();
});

// ---------- Animated background toggle ----------
const animatedBgToggle = document.getElementById('animated-bg-toggle');
animatedBgToggle.checked = settings.animatedBackground;
animatedBgToggle.addEventListener('change', () => {
  settings.animatedBackground = animatedBgToggle.checked;
  saveSettings(settings);
  applySettings();
});

// ---------- Default quality ----------
const defaultQualitySelect = document.getElementById('default-quality');
defaultQualitySelect.value = settings.defaultQuality;
defaultQualitySelect.addEventListener('change', () => {
  settings.defaultQuality = defaultQualitySelect.value;
  saveSettings(settings);
});

setThemeUI(settings.theme);
setAccentUI(settings.accent);
window.addEventListener('resize', () => setThemeUI(settings.theme));

// ---------- Tabs ----------
const tabsContainer = document.getElementById('tabs');
const tabIndicator = document.getElementById('tab-indicator');
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

function moveTabIndicator(activeTab) {
  moveSegmentedIndicator(tabsContainer, tabIndicator, activeTab);
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    panels.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    moveTabIndicator(tab);
  });
});

moveTabIndicator(document.querySelector('.tab.active'));
window.addEventListener('resize', () => moveTabIndicator(document.querySelector('.tab.active')));

// ---------- YouTube Downloader ----------
const ytForm = document.getElementById('yt-form');
const ytUrlInput = document.getElementById('yt-url');
const ytUrlField = ytUrlInput.closest('.url-field');
const ytFetchProgress = document.getElementById('yt-fetch-progress');
const ytError = document.getElementById('yt-error');
const ytResult = document.getElementById('yt-result');
const ytThumb = document.getElementById('yt-thumb');
const ytTitle = document.getElementById('yt-title');
const ytAuthor = document.getElementById('yt-author');
const ytQuality = document.getElementById('yt-quality');
const ytDownloadVideoBtn = document.getElementById('yt-download-video');
const ytDownloadAudioBtn = document.getElementById('yt-download-audio');
const ytDownloadThumbBtn = document.getElementById('yt-download-thumb');
const ytProgressWrap = document.getElementById('yt-progress-wrap');
const ytProgressFill = document.getElementById('yt-progress-fill');
const ytProgressLabel = document.getElementById('yt-progress-label');

let currentVideoUrl = '';
let currentVideoTitle = '';
let currentThumbnailUrl = '';
let typingTimeout;
let fetchDebounceTimer;
let fetchRequestId = 0;
let lastFetchedUrl = '';

function looksLikeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

ytUrlInput.addEventListener('input', () => {
  ytUrlField.classList.toggle('is-typing', ytUrlInput.value.length > 0);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => ytUrlField.classList.remove('is-typing'), 900);

  const value = ytUrlInput.value.trim();
  clearTimeout(fetchDebounceTimer);
  if (looksLikeUrl(value) && value !== lastFetchedUrl) {
    fetchDebounceTimer = setTimeout(() => fetchVideoInfo(value), 700);
  }
});
ytUrlInput.addEventListener('blur', () => ytUrlField.classList.remove('is-typing'));

ytForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(fetchDebounceTimer);
  const url = ytUrlInput.value.trim();
  if (looksLikeUrl(url)) fetchVideoInfo(url);
});

function showYtError(message) {
  ytError.textContent = message;
  ytError.classList.remove('hidden');
  ytResult.classList.add('hidden');
}

async function fetchVideoInfo(url) {
  const requestId = ++fetchRequestId;

  ytError.classList.add('hidden');
  ytResult.classList.add('hidden');
  ytProgressWrap.classList.add('hidden');
  ytFetchProgress.classList.remove('hidden');

  try {
    const res = await fetch(`/api/youtube/info?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (requestId !== fetchRequestId) return;
    if (!res.ok) throw new Error(data.error || 'Failed to fetch video info.');

    lastFetchedUrl = url;
    currentVideoUrl = url;
    currentVideoTitle = data.title || 'video';
    currentThumbnailUrl = data.thumbnail || '';
    ytThumb.src = currentThumbnailUrl;
    ytTitle.textContent = data.title;
    ytAuthor.textContent = data.author || '';

    const hasQualities = data.qualities && data.qualities.length > 0;
    ytDownloadVideoBtn.classList.toggle('hidden', data.hasVideo === false);
    ytDownloadThumbBtn.classList.toggle('hidden', !currentThumbnailUrl);
    document.querySelector('.quality-row').classList.toggle('hidden', !hasQualities);

    ytQuality.innerHTML = '';
    if (hasQualities) {
      data.qualities.forEach((q) => {
        const opt = document.createElement('option');
        opt.value = q.formatId;
        opt.textContent = q.label;
        ytQuality.appendChild(opt);
      });
      if (settings.defaultQuality) {
        const preferred = data.qualities.find((q) => String(q.height) === settings.defaultQuality);
        if (preferred) ytQuality.value = preferred.formatId;
      }
    }

    ytResult.classList.remove('hidden');
  } catch (err) {
    if (requestId !== fetchRequestId) return;
    showYtError(err.message);
  } finally {
    if (requestId === fetchRequestId) ytFetchProgress.classList.add('hidden');
  }
}

function triggerDownload(url) {
  const link = document.createElement('a');
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function setYtButtonsDisabled(disabled) {
  ytDownloadVideoBtn.disabled = disabled;
  ytDownloadAudioBtn.disabled = disabled;
}

async function startYoutubeDownload(type) {
  if (!currentVideoUrl) return;

  ytError.classList.add('hidden');
  setYtButtonsDisabled(true);
  ytProgressWrap.classList.remove('hidden');
  ytProgressFill.style.width = '0%';
  ytProgressLabel.textContent = 'Starting…';

  const body = { url: currentVideoUrl, type, title: currentVideoTitle };
  if (type !== 'audio') body.formatId = ytQuality.value || undefined;

  try {
    const res = await fetch('/api/youtube/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Download failed.');
    watchYoutubeProgress(data.jobId);
  } catch (err) {
    showYtError(err.message);
    ytProgressWrap.classList.add('hidden');
    setYtButtonsDisabled(false);
  }
}

function watchYoutubeProgress(jobId) {
  const source = new EventSource(`/api/youtube/progress/${jobId}`);
  const stageLabels = { video: 'Downloading video…', audio: 'Downloading audio…', finalizing: 'Merging…' };

  source.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.status === 'error') {
      source.close();
      showYtError(data.error || 'Download failed.');
      ytProgressWrap.classList.add('hidden');
      setYtButtonsDisabled(false);
      return;
    }

    const percent = data.status === 'done' ? 100 : (data.percent || 0);
    ytProgressFill.style.width = `${percent}%`;
    ytProgressLabel.textContent = data.status === 'done' ? 'Done!' : (stageLabels[data.stage] || 'Preparing…') + ` ${percent}%`;

    if (data.status === 'done') {
      source.close();
      triggerDownload(`/api/youtube/result/${jobId}`);
      setTimeout(() => {
        ytProgressWrap.classList.add('hidden');
        setYtButtonsDisabled(false);
      }, 1500);
    }
  };

  source.onerror = () => {
    source.close();
    setYtButtonsDisabled(false);
  };
}

ytDownloadVideoBtn.addEventListener('click', () => startYoutubeDownload('video'));
ytDownloadAudioBtn.addEventListener('click', () => startYoutubeDownload('audio'));

ytDownloadThumbBtn.addEventListener('click', () => {
  if (!currentThumbnailUrl) return;
  const params = new URLSearchParams({ src: currentThumbnailUrl, title: currentVideoTitle });
  triggerDownload(`/api/youtube/thumbnail?${params.toString()}`);
});

// ---------- Video Converter ----------
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const fileRemoveBtn = document.getElementById('file-remove');
const formatGridVideo = document.getElementById('format-grid-video');
const formatGridAudio = document.getElementById('format-grid-audio');
const convertBtn = document.getElementById('convert-btn');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const convertError = document.getElementById('convert-error');
const convertResult = document.getElementById('convert-result');
const convertDownloadLink = document.getElementById('convert-download');

let selectedFile = null;
let selectedFormat = null;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = bytes;
  let i = -1;
  do { val /= 1024; i++; } while (val >= 1024 && i < units.length - 1);
  return `${val.toFixed(1)} ${units[i]}`;
}

function buildFormatChips(container, formats) {
  container.innerHTML = '';
  formats.forEach((fmt) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'format-chip';
    chip.textContent = fmt;
    chip.dataset.format = fmt;
    chip.addEventListener('click', () => selectFormat(fmt));
    container.appendChild(chip);
  });
}

function selectFormat(fmt) {
  selectedFormat = fmt;
  document.querySelectorAll('.format-chip').forEach((chip) => {
    const isMatch = chip.dataset.format === fmt;
    chip.classList.toggle('selected', isMatch);
    if (isMatch) {
      chip.classList.remove('pop');
      void chip.offsetWidth;
      chip.classList.add('pop');
    }
  });
  updateConvertButton();
}

async function loadFormats() {
  try {
    const res = await fetch('/api/convert/formats');
    const data = await res.json();
    buildFormatChips(formatGridVideo, data.video);
    buildFormatChips(formatGridAudio, data.audio);
  } catch (err) {
    buildFormatChips(formatGridVideo, ['mp4', 'mov', 'avi', 'mkv', 'webm', 'gif']);
    buildFormatChips(formatGridAudio, ['mp3', 'wav', 'flac', 'aac', 'ogg']);
  }
}
loadFormats();

function updateConvertButton() {
  convertBtn.disabled = !(selectedFile && selectedFormat);
}

function setFile(file) {
  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  fileInfo.classList.remove('hidden');
  dropZone.classList.add('hidden');
  convertError.classList.add('hidden');
  convertResult.classList.add('hidden');
  updateConvertButton();
}

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

['dragenter', 'dragover'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  });
});
dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

fileRemoveBtn.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropZone.classList.remove('hidden');
  updateConvertButton();
});

convertBtn.addEventListener('click', async () => {
  if (!selectedFile || !selectedFormat) return;

  convertError.classList.add('hidden');
  convertResult.classList.add('hidden');
  progressWrap.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressLabel.textContent = 'Uploading…';
  convertBtn.disabled = true;

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('format', selectedFormat);

  try {
    const res = await fetch('/api/convert/start', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');

    watchProgress(data.jobId);
  } catch (err) {
    showConvertError(err.message);
  }
});

function showConvertError(message) {
  convertError.textContent = message;
  convertError.classList.remove('hidden');
  progressWrap.classList.add('hidden');
  convertBtn.disabled = false;
}

function watchProgress(jobId) {
  const source = new EventSource(`/api/convert/progress/${jobId}`);

  source.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.status === 'error') {
      source.close();
      showConvertError(data.error || 'Conversion failed.');
      return;
    }

    const percent = data.status === 'done' ? 100 : (data.percent || 0);
    progressFill.style.width = `${percent}%`;
    progressLabel.textContent = data.status === 'processing' ? `Converting… ${percent}%` : 'Preparing…';

    if (data.status === 'done') {
      source.close();
      progressLabel.textContent = 'Done!';
      convertDownloadLink.href = `/api/convert/result/${jobId}`;
      progressWrap.classList.add('hidden');
      convertResult.classList.remove('hidden');
      convertBtn.disabled = false;
    }
  };

  source.onerror = () => {
    source.close();
  };
}

// ---------- Image Converter ----------
const imageDropZone = document.getElementById('image-drop-zone');
const imageFileInput = document.getElementById('image-file-input');
const imageFetchProgress = document.getElementById('image-fetch-progress');
const imageFileInfo = document.getElementById('image-file-info');
const imageFileName = document.getElementById('image-file-name');
const imageFileRemove = document.getElementById('image-file-remove');
const imageError = document.getElementById('image-error');
const gifFramesSection = document.getElementById('gif-frames-section');
const gifFramesHeading = document.getElementById('gif-frames-heading');
const gifFramesGrid = document.getElementById('gif-frames-grid');
const imageFormatSection = document.getElementById('image-format-section');
const imageFormatGrid = document.getElementById('image-format-grid');
const imageConvertBtn = document.getElementById('image-convert-btn');
const imageProgressWrap = document.getElementById('image-progress-wrap');
const imageConvertResult = document.getElementById('image-convert-result');

let currentImageUploadId = null;
let currentImageOriginalName = '';
let selectedImageFormat = null;

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function stripExtension(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

function showImageError(message) {
  imageError.textContent = message;
  imageError.classList.remove('hidden');
}

function resetImagePanel() {
  currentImageUploadId = null;
  currentImageOriginalName = '';
  selectedImageFormat = null;
  imageFileInput.value = '';
  imageFileInfo.classList.add('hidden');
  imageDropZone.classList.remove('hidden');
  gifFramesSection.classList.add('hidden');
  gifFramesGrid.innerHTML = '';
  imageFormatSection.classList.add('hidden');
  imageConvertBtn.classList.add('hidden');
  imageConvertBtn.disabled = true;
  imageConvertResult.classList.add('hidden');
  imageError.classList.add('hidden');
  document.querySelectorAll('#image-format-grid .format-chip').forEach((chip) => chip.classList.remove('selected'));
}

function buildImageFormatChips() {
  imageFormatGrid.innerHTML = '';
  const formats = ['png', 'jpg', 'bmp', 'tif', 'gif', 'webm'];
  formats.forEach((fmt) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'format-chip';
    chip.textContent = fmt;
    chip.dataset.format = fmt;
    chip.addEventListener('click', () => selectImageFormat(fmt));
    imageFormatGrid.appendChild(chip);
  });
}
buildImageFormatChips();

function selectImageFormat(fmt) {
  selectedImageFormat = fmt;
  imageFormatGrid.querySelectorAll('.format-chip').forEach((chip) => {
    const isMatch = chip.dataset.format === fmt;
    chip.classList.toggle('selected', isMatch);
    if (isMatch) {
      chip.classList.remove('pop');
      void chip.offsetWidth;
      chip.classList.add('pop');
    }
  });
  imageConvertBtn.disabled = false;
}

function buildGifFrames(uploadId, frameCount, truncated) {
  gifFramesGrid.innerHTML = '';
  gifFramesHeading.textContent = truncated ? `Frames (showing first ${frameCount})` : `Frames (${frameCount})`;

  for (let i = 1; i <= frameCount; i++) {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'gif-frame-thumb';
    thumb.title = `Download frame ${i}`;

    const img = document.createElement('img');
    img.src = `/api/image/frame/${uploadId}/${i}`;
    img.alt = `Frame ${i}`;
    img.loading = 'lazy';

    const badge = document.createElement('span');
    badge.className = 'frame-index';
    badge.textContent = i;

    const dlIcon = document.createElement('span');
    dlIcon.className = 'frame-download-icon';
    dlIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0-4-4m4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    thumb.append(img, badge, dlIcon);
    thumb.addEventListener('click', () => triggerDownload(`/api/image/frame/${uploadId}/${i}/download`));
    gifFramesGrid.appendChild(thumb);
  }

  gifFramesSection.classList.remove('hidden');
}

async function uploadImageFile(file) {
  imageError.classList.add('hidden');
  imageConvertResult.classList.add('hidden');
  gifFramesSection.classList.add('hidden');
  imageFormatSection.classList.add('hidden');
  imageConvertBtn.classList.add('hidden');
  imageFetchProgress.classList.remove('hidden');

  imageFileName.textContent = file.name;
  imageFileInfo.classList.remove('hidden');
  imageDropZone.classList.add('hidden');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/image/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');

    currentImageUploadId = data.uploadId;
    currentImageOriginalName = data.originalName;

    if (data.isGif && data.frameCount > 0) {
      buildGifFrames(data.uploadId, data.frameCount, data.truncated);
    }

    imageFormatSection.classList.remove('hidden');
    imageConvertBtn.classList.remove('hidden');
  } catch (err) {
    showImageError(err.message);
    resetImagePanel();
  } finally {
    imageFetchProgress.classList.add('hidden');
  }
}

imageDropZone.addEventListener('click', () => imageFileInput.click());
imageFileInput.addEventListener('change', () => {
  if (imageFileInput.files[0]) uploadImageFile(imageFileInput.files[0]);
});

['dragenter', 'dragover'].forEach((evt) => {
  imageDropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    imageDropZone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  imageDropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    imageDropZone.classList.remove('dragover');
  });
});
imageDropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) uploadImageFile(file);
});

imageFileRemove.addEventListener('click', resetImagePanel);

imageConvertBtn.addEventListener('click', async () => {
  if (!currentImageUploadId || !selectedImageFormat) return;

  imageError.classList.add('hidden');
  imageConvertResult.classList.add('hidden');
  imageProgressWrap.classList.remove('hidden');
  imageConvertBtn.disabled = true;

  try {
    const res = await fetch('/api/image/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: currentImageUploadId, format: selectedImageFormat }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Conversion failed.');
    }

    const blob = await res.blob();
    const filename = `${stripExtension(currentImageOriginalName)}.${selectedImageFormat}`;
    triggerBlobDownload(blob, filename);

    imageConvertResult.classList.remove('hidden');
  } catch (err) {
    showImageError(err.message);
  } finally {
    imageProgressWrap.classList.add('hidden');
    imageConvertBtn.disabled = false;
  }
});
