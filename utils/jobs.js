const fs = require('fs');
const { getConfig } = require('./config');

// In-memory job table. Nothing here is persisted: a restart forgets every job
// (and the temp-file sweep on startup removes their files).
const jobs = new Map();
const queue = []; // jobIds waiting for a free worker slot, in order
let running = 0;

function createJob(id, data) {
  const job = { id, status: 'pending', percent: 0, error: null, createdAt: Date.now(), ...data };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id);
}

function isFinished(job) {
  return job.status === 'done' || job.status === 'error';
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  const wasFinished = isFinished(job);
  Object.assign(job, patch);
  if (!wasFinished && isFinished(job)) {
    job.finishedAt = Date.now();
    if (job.holdsSlot) {
      job.holdsSlot = false;
      running = Math.max(0, running - 1);
      setImmediate(drainQueue);
    }
    const queued = queue.indexOf(id);
    if (queued !== -1) queue.splice(queued, 1);
    scheduleCleanup(id);
  }
  return job;
}

function scheduleCleanup(id) {
  const ttlMs = getConfig().storage.resultTtlMinutes * 60 * 1000;
  setTimeout(() => {
    const job = jobs.get(id);
    if (!job) return;
    for (const filePath of [job.uploadPath, job.outputPath, ...(job.extraFiles || [])]) {
      if (filePath) fs.promises.unlink(filePath).catch(() => {});
    }
    jobs.delete(id);
  }, ttlMs).unref();
}

/* ---------- Queue & per-visitor limits ---------- */

// Jobs this IP has that are still waiting or running.
function countJobsForIp(ip) {
  let count = 0;
  for (const job of jobs.values()) if (job.ip === ip && !isFinished(job)) count++;
  return count;
}

// Returns an error message if this visitor may not start another job right now.
function checkJobAllowance(ip) {
  const { maxJobsPerIp } = getConfig().limits;
  if (countJobsForIp(ip) >= maxJobsPerIp) {
    return `You already have ${maxJobsPerIp} job${maxJobsPerIp === 1 ? '' : 's'} running on this server. Wait for one to finish, then try again.`;
  }
  return null;
}

// Runs `start(job)` as soon as a worker slot is free. Until then the job is
// 'queued' and reports its position.
function runWhenReady(id, start) {
  const job = jobs.get(id);
  if (!job) return;
  job.start = start;
  job.status = 'queued';
  queue.push(id);
  job.cancel = () => updateJob(id, { cancelled: true, status: 'error', error: 'Cancelled.' });
  drainQueue();
}

// yt-dlp and ffmpeg already run as separate processes, so a stuck one can't
// block the web server, but it could hold a worker slot forever. Stop jobs
// that run longer than the admin's limit.
function armWatchdog(id) {
  const minutes = getConfig().limits.maxJobMinutes;
  if (!minutes) return;
  setTimeout(() => {
    const job = jobs.get(id);
    if (!job || isFinished(job)) return;
    const message = `Stopped: this took longer than the server's ${minutes}-minute limit.`;
    if (typeof job.cancel === 'function') job.cancel();
    updateJob(id, { cancelled: true, status: 'error', error: message });
    job.error = message; // the cancel handler may have set its own message first
    console.warn(`Job ${id} (${job.kind || 'job'}) stopped after ${minutes} minutes.`);
  }, minutes * 60 * 1000).unref();
}

// Jobs of the given kinds currently running (e.g. to avoid updating yt-dlp mid-download).
function countRunning(kinds) {
  let count = 0;
  for (const job of jobs.values()) if (job.status === 'processing' && kinds.includes(job.kind)) count++;
  return count;
}

function drainQueue() {
  const { maxConcurrentJobs } = getConfig().limits;
  while (running < maxConcurrentJobs && queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job || isFinished(job)) continue;
    running++;
    job.holdsSlot = true;
    job.status = 'processing';
    job.cancel = null;
    job.startedAt = Date.now();
    armWatchdog(id);
    const { start } = job;
    job.start = null;
    Promise.resolve()
      .then(() => start(job))
      .catch((err) => updateJob(id, { status: 'error', error: err?.message || 'Job failed.' }));
  }
}

function queuePosition(id) {
  const idx = queue.indexOf(id);
  return idx === -1 ? 0 : idx + 1;
}

function countActiveJobs() {
  let count = 0;
  for (const job of jobs.values()) if (job.status === 'processing' || job.status === 'pending') count++;
  return count;
}

function countQueuedJobs() {
  return queue.length;
}

// Paths that belong to jobs still in memory (used by the temp sweeper).
function knownJobPaths() {
  const paths = new Set();
  for (const job of jobs.values()) {
    for (const p of [job.uploadPath, job.outputPath, ...(job.extraFiles || [])]) if (p) paths.add(p);
  }
  return paths;
}

function hasJob(id) {
  return jobs.has(id);
}

module.exports = {
  createJob,
  getJob,
  updateJob,
  hasJob,
  runWhenReady,
  queuePosition,
  checkJobAllowance,
  countActiveJobs,
  countRunning,
  countQueuedJobs,
  knownJobPaths,
};
