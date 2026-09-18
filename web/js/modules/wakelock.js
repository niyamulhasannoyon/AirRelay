// ==========================================================================
// AirRelay Screen Wake Lock Controller
// Prevents mobile and desktop devices from sleeping or throttling WebRTC
// DataChannels during large file transfers.
// ==========================================================================

let _wakeLockSentinel = null;
const _activeLocks = new Set();

async function requestLock() {
  if (typeof navigator === 'undefined' || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
    return;
  }
  if (_wakeLockSentinel && !_wakeLockSentinel.released) {
    return;
  }

  try {
    _wakeLockSentinel = await navigator.wakeLock.request('screen');
    _wakeLockSentinel.addEventListener('release', () => {
      _wakeLockSentinel = null;
    });
  } catch (err) {
    // WakeLock request can fail if low battery or permission denied
    console.debug('WakeLock request was not granted:', err);
  }
}

async function dropLock() {
  if (_wakeLockSentinel && !_wakeLockSentinel.released) {
    try {
      await _wakeLockSentinel.release();
    } catch {}
    _wakeLockSentinel = null;
  }
}

// Re-acquire lock if tab was minimized and restored while transfers were still running
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && _activeLocks.size > 0) {
      await requestLock();
    }
  });
}

/**
 * Acquire a screen wake lock for a specific task/file.
 * @param {string} tag
 */
export async function acquireWakeLock(tag) {
  _activeLocks.add(tag);
  await requestLock();
}

/**
 * Release a screen wake lock for a specific task/file.
 * @param {string} tag
 */
export async function releaseWakeLock(tag) {
  _activeLocks.delete(tag);
  if (_activeLocks.size === 0) {
    await dropLock();
  }
}
