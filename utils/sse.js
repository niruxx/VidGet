function streamJobProgress(getJob) {
  return (req, res) => {
    const { jobId } = req.params;
    if (!getJob(jobId)) return res.status(404).json({ error: 'Job not found.' });

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    const send = () => {
      const job = getJob(jobId);
      if (!job) {
        res.write(`data: ${JSON.stringify({ status: 'error', error: 'Job expired.' })}\n\n`);
        clearInterval(interval);
        res.end();
        return;
      }
      res.write(`data: ${JSON.stringify({ status: job.status, percent: job.percent, stage: job.stage, error: job.error })}\n\n`);
      if (job.status === 'done' || job.status === 'error') {
        clearInterval(interval);
        res.end();
      }
    };

    const interval = setInterval(send, 500);
    send();

    req.on('close', () => clearInterval(interval));
  };
}

module.exports = { streamJobProgress };
