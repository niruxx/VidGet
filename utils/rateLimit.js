// Fixed-window, in-memory request counters per visitor IP. Nothing is written
// to disk, and entries disappear when their window ends.
const buckets = new Map(); // `${name}:${ip}` -> { count, reset }

function hit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    bucket = { count: 0, reset: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;
  return { ok: bucket.count <= limit, retryAfter: Math.ceil((bucket.reset - now) / 1000) };
}

// getLimit() is read per request so admin changes apply immediately. A limit
// of 0 turns the limiter off.
function rateLimit(name, getLimit, windowMs = 60 * 1000) {
  return (req, res, next) => {
    const limit = getLimit();
    if (!limit) return next();
    const { ok, retryAfter } = hit(`${name}:${req.ip}`, limit, windowMs);
    if (ok) return next();
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({ error: `Too many requests. Please wait ${retryAfter} seconds and try again.` });
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
}, 60 * 1000).unref();

module.exports = { rateLimit };
