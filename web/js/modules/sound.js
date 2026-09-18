// ==========================================================================
// AirRelay Sound & Haptics Engine
// 100% synthesized via Web Audio API — zero external assets, zero latency,
// CSP-compliant, and fully respectful of user audio preferences.
// ==========================================================================

let _audioCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!_audioCtx) {
    _audioCtx = new AudioContextClass();
  }
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

// Sound enabled preference (defaults to true)
let _soundEnabled = true;
if (typeof window !== 'undefined' && window.localStorage) {
  const saved = window.localStorage.getItem('airrelay_sound_enabled');
  if (saved !== null) {
    _soundEnabled = saved === 'true';
  }
}

export function isSoundEnabled() {
  return _soundEnabled;
}

export function setSoundEnabled(enabled) {
  _soundEnabled = Boolean(enabled);
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem('airrelay_sound_enabled', String(_soundEnabled));
  }
  return _soundEnabled;
}

export function toggleSound() {
  return setSoundEnabled(!_soundEnabled);
}

// Gentle haptic feedback on supported mobile devices
export function triggerHaptic(pattern = [15]) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {}
  }
}

/**
 * Play a subtle, elegant synthesized tone.
 * @param {Array<{freq: number, start: number, duration: number, type?: OscillatorType, gain?: number}>} notes
 */
function playToneSequence(notes) {
  if (!_soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  // Keep master gain subtle (around 0.12) so it's pleasant and non-jarring
  masterGain.gain.setValueAtTime(0.12, now);
  masterGain.connect(ctx.destination);

  for (const n of notes) {
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();

    osc.type = n.type || 'sine';
    osc.frequency.setValueAtTime(n.freq, now + n.start);

    const startTime = now + n.start;
    const endTime = startTime + n.duration;
    const peakGain = n.gain !== undefined ? n.gain : 1.0;

    // Quick gentle envelope: 5ms attack, exponential decay
    noteGain.gain.setValueAtTime(0.001, startTime);
    noteGain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.005);
    noteGain.gain.exponentialRampToValueAtTime(0.001, endTime);

    osc.connect(noteGain);
    noteGain.connect(masterGain);

    osc.start(startTime);
    osc.stop(endTime);
  }
}

// Tactile pop on file drop or selection
export function soundFileDrop() {
  triggerHaptic([12]);
  playToneSequence([
    { freq: 280, start: 0, duration: 0.04, type: 'triangle', gain: 0.8 },
    { freq: 440, start: 0.02, duration: 0.06, type: 'sine', gain: 0.9 },
  ]);
}

// Welcoming ascending two-tone chime when a peer joins
export function soundPeerJoin() {
  triggerHaptic([15, 40, 15]);
  playToneSequence([
    { freq: 523.25, start: 0, duration: 0.08, type: 'sine', gain: 0.7 },      // C5
    { freq: 659.25, start: 0.07, duration: 0.12, type: 'sine', gain: 0.85 },  // E5
  ]);
}

// Subtle descending chime when a peer departs
export function soundPeerLeave() {
  triggerHaptic([10]);
  playToneSequence([
    { freq: 587.33, start: 0, duration: 0.08, type: 'sine', gain: 0.5 },      // D5
    { freq: 440.00, start: 0.07, duration: 0.10, type: 'sine', gain: 0.4 },  // A4
  ]);
}

// Uplifting 3-note harmonic arpeggio on successful transfer completion
export function soundTransferComplete() {
  triggerHaptic([20, 60, 20]);
  playToneSequence([
    { freq: 523.25, start: 0, duration: 0.09, type: 'sine', gain: 0.7 },      // C5
    { freq: 659.25, start: 0.08, duration: 0.09, type: 'sine', gain: 0.8 },  // E5
    { freq: 783.99, start: 0.16, duration: 0.22, type: 'sine', gain: 1.0 },  // G5
  ]);
}

// Discreet error alert tone
export function soundError() {
  triggerHaptic([30, 50, 30]);
  playToneSequence([
    { freq: 240, start: 0, duration: 0.08, type: 'triangle', gain: 0.6 },
    { freq: 180, start: 0.07, duration: 0.12, type: 'triangle', gain: 0.6 },
  ]);
}
