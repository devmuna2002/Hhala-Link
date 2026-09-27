// Network helpers shared across screens.
//
// Supabase/fetch promises can hang indefinitely on a dead connection
// (no error, no resolution). Wrapping every network call with a timeout
// guarantees screens always fall back to cache/offline state instead of
// sitting on a spinner forever.
export function withTimeout(promise, ms = 12000, label = 'request') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// True when the failure looks transient (radio blip, tower handoff, cold
// backend) and is worth retrying — as opposed to auth/RLS/validation
// errors, which will fail identically on every attempt.
export function isTransientError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  return /network|fetch|timeout|timed out|abort|econn|etimedout|esocket|socket|offline|failed to fetch|load failed|too many|429|50[034]|gateway|unavailable/i.test(m);
}

// Run an async query factory with exponential backoff. Transient blips
// (tower handoff, elevator, backend cold-start) heal silently inside these
// retries instead of flipping the whole app to the offline banner.
export async function withRetry(fn, { attempts = 3, baseDelayMs = 800, label = 'request' } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const transient = isTransientError(e);
      if (!transient || i === attempts - 1) throw e;
      const delay = baseDelayMs * 2 ** i + Math.random() * 300;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
