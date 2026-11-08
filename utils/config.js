const fs = require('fs');
const path = require('path');

const { CONFIG_PATH } = require('./paths');

// Heights a public instance can be capped at (0 = no cap).
const QUALITY_CAPS = [0, 2160, 1440, 1080, 720, 480, 360];
const SITE_MODES = ['all', 'allow', 'block'];

const DEFAULT_CONFIG = {
  port: 3000,
  logRetentionDays: 0,
  savesRetentionDays: '*',
  siteName: 'Vidget',
  tagline: 'Self-hosted media toolkit',
  announcement: '',
  contact: '',
  terms: '',
  trustProxy: false,
  // Address to listen on; '' = every interface. Use 127.0.0.1 behind a reverse proxy.
  host: '',
  // Run "yt-dlp -U" about once a day (only between downloads).
  ytdlpAutoUpdate: true,
  // Use a working GPU encoder (NVENC, Quick Sync, AMF, VideoToolbox, VAAPI) for H.264/H.265.
  hardwareEncoding: false,
  features: {
    downloader: true,
    videoConverter: true,
    imageConverter: true,
  },
  storage: {
    // false: finished files live in tmp/ only and are deleted after resultTtlMinutes.
    // true: a copy of every download/upload is also kept in Saves/ (subject to savesRetentionDays).
    keepCopies: false,
    resultTtlMinutes: 30,
  },
  limits: {
    maxQuality: 0,
    maxDurationMinutes: 0,
    videoUploadMB: 2048,
    imageUploadMB: 500,
    maxPlaylistItems: 50,
    maxConcurrentJobs: 3,
    maxJobsPerIp: 3,
    requestsPerMinute: 30,
    // A job running longer than this is stopped so it can't hold a worker slot forever (0 = no limit).
    maxJobMinutes: 120,
  },
  sites: {
    mode: 'all',
    list: [],
  },
};

function normalizeRetention(value, fallback) {
  if (value === '*') return '*';
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function normalizePort(value, fallback) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 && num < 65536 ? num : fallback;
}

function normalizeText(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function normalizeInt(value, fallback, min, max) {
  const num = Number(value);
  return Number.isInteger(num) && num >= min && num <= max ? num : fallback;
}

// An IPv4/IPv6 address or hostname to bind to; anything else falls back.
function normalizeHost(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const host = value.trim();
  if (host === '') return '';
  return /^[\w.:-]{1,253}$/.test(host) ? host : fallback;
}

function normalizeBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  let host = value.trim().toLowerCase();
  if (!host) return null;
  try {
    if (host.includes('/')) host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^\*\./, '').replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host) ? host : null;
}

function normalizeSiteList(value) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  return [...new Set(items.map(normalizeDomain).filter(Boolean))].slice(0, 500);
}

function normalize(parsed) {
  const d = DEFAULT_CONFIG;
  const features = parsed.features || {};
  const storage = parsed.storage || {};
  const limits = parsed.limits || {};
  const sites = parsed.sites || {};
  return {
    port: normalizePort(parsed.port, d.port),
    logRetentionDays: normalizeRetention(parsed.logRetentionDays, d.logRetentionDays),
    savesRetentionDays: normalizeRetention(parsed.savesRetentionDays, d.savesRetentionDays),
    siteName: normalizeText(parsed.siteName, d.siteName, 40) || d.siteName,
    tagline: normalizeText(parsed.tagline, d.tagline, 60),
    announcement: normalizeText(parsed.announcement, d.announcement, 300),
    contact: normalizeText(parsed.contact, d.contact, 300),
    terms: normalizeText(parsed.terms, d.terms, 5000),
    trustProxy: normalizeBool(parsed.trustProxy, d.trustProxy),
    host: normalizeHost(parsed.host, d.host),
    ytdlpAutoUpdate: normalizeBool(parsed.ytdlpAutoUpdate, d.ytdlpAutoUpdate),
    hardwareEncoding: normalizeBool(parsed.hardwareEncoding, d.hardwareEncoding),
    features: {
      downloader: normalizeBool(features.downloader, d.features.downloader),
      videoConverter: normalizeBool(features.videoConverter, d.features.videoConverter),
      imageConverter: normalizeBool(features.imageConverter, d.features.imageConverter),
    },
    storage: {
      keepCopies: normalizeBool(storage.keepCopies, d.storage.keepCopies),
      resultTtlMinutes: normalizeInt(storage.resultTtlMinutes, d.storage.resultTtlMinutes, 5, 24 * 60),
    },
    limits: {
      maxQuality: QUALITY_CAPS.includes(Number(limits.maxQuality)) ? Number(limits.maxQuality) : d.limits.maxQuality,
      maxDurationMinutes: normalizeInt(limits.maxDurationMinutes, d.limits.maxDurationMinutes, 0, 24 * 60),
      videoUploadMB: normalizeInt(limits.videoUploadMB, d.limits.videoUploadMB, 1, 100 * 1024),
      imageUploadMB: normalizeInt(limits.imageUploadMB, d.limits.imageUploadMB, 1, 10 * 1024),
      maxPlaylistItems: normalizeInt(limits.maxPlaylistItems, d.limits.maxPlaylistItems, 0, 1000),
      maxConcurrentJobs: normalizeInt(limits.maxConcurrentJobs, d.limits.maxConcurrentJobs, 1, 64),
      maxJobsPerIp: normalizeInt(limits.maxJobsPerIp, d.limits.maxJobsPerIp, 1, 100),
      requestsPerMinute: normalizeInt(limits.requestsPerMinute, d.limits.requestsPerMinute, 0, 10000),
      maxJobMinutes: normalizeInt(limits.maxJobMinutes, d.limits.maxJobMinutes, 0, 24 * 60),
    },
    sites: {
      mode: SITE_MODES.includes(sites.mode) ? sites.mode : d.sites.mode,
      list: normalizeSiteList(sites.list),
    },
  };
}

if (!fs.existsSync(CONFIG_PATH)) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
}

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
  } catch {
    return {};
  }
}

// config.json is read on nearly every request, so cache it briefly. Edits made
// by hand still apply within a couple of seconds; admin edits apply instantly.
const CACHE_MS = 2000;
let cache = null;
let cacheTime = 0;

function getConfig() {
  if (!cache || Date.now() - cacheTime > CACHE_MS) {
    cache = normalize(readRaw());
    cacheTime = Date.now();
  }
  return cache;
}

const NESTED_KEYS = ['features', 'storage', 'limits', 'sites'];

// Merges a (possibly partial) patch into config.json and returns the normalized result.
// Unknown keys already present in the file are preserved.
function saveConfig(patch) {
  const raw = readRaw();
  const merged = { ...raw, ...patch };
  for (const key of NESTED_KEYS) merged[key] = { ...(raw[key] || {}), ...(patch[key] || {}) };
  const normalized = normalize(merged);
  const toWrite = { ...raw, ...normalized };
  const tmpPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(toWrite, null, 2)}\n`);
  fs.renameSync(tmpPath, CONFIG_PATH);
  cache = normalized;
  cacheTime = Date.now();
  return normalized;
}

// retentionDays: a non-negative number of days, or '*' for "keep forever".
// 0 means "never within retention" (nothing is kept).
function isWithinRetention(timestampMs, retentionDays) {
  if (retentionDays === '*') return true;
  if (retentionDays === 0) return false;
  const ageMs = Date.now() - timestampMs;
  return ageMs <= retentionDays * 24 * 60 * 60 * 1000;
}

// Is this hostname allowed by the admin's site allow/blocklist?
function isSiteAllowed(hostname) {
  const { sites } = getConfig();
  if (sites.mode === 'all') return true;
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  const listed = sites.list.some((d) => host === d || host.endsWith(`.${d}`));
  return sites.mode === 'allow' ? listed : !listed;
}

module.exports = { getConfig, saveConfig, isWithinRetention, isSiteAllowed, CONFIG_PATH, QUALITY_CAPS, DEFAULT_CONFIG };
