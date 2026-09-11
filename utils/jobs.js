const fs = require('fs');

const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function createJob(id, data) {
  const job = { id, status: 'pending', percent: 0, error: null, ...data };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id);
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  if (job.status === 'done' || job.status === 'error') {
    scheduleCleanup(id);
  }
  return job;
}

function scheduleCleanup(id) {
  setTimeout(() => {
    const job = jobs.get(id);
    if (!job) return;
    const filesToRemove = [job.uploadPath, job.keepOutput ? null : job.outputPath];
    for (const filePath of filesToRemove) {
      if (filePath) {
        fs.promises.unlink(filePath).catch(() => {});
      }
    }
    jobs.delete(id);
  }, JOB_TTL_MS);
}

module.exports = { createJob, getJob, updateJob };
