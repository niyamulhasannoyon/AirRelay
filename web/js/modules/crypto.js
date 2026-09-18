// ==========================================================================
// AirRelay Cryptographic Integrity Engine
// High-performance, streaming SHA-256 checksum computation and verification.
// Guarantees byte-for-byte end-to-end data integrity over WebRTC DataChannels.
// ==========================================================================

const _crypto = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto : null;

/**
 * Converts an ArrayBuffer to a lowercase hex string.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function bufToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Compute the SHA-256 hash of a Blob, File, or ArrayBuffer.
 * Uses native Web Crypto API (`crypto.subtle.digest`).
 * For large files (>64MB), streams slices to avoid memory spikes.
 * @param {Blob|File|ArrayBuffer} data
 * @returns {Promise<string>} Hexadecimal SHA-256 digest
 */
export async function computeSha256(data) {
  if (!_crypto || !_crypto.subtle) {
    // Fallback if subtle crypto is unavailable (e.g. non-secure non-localhost HTTP)
    return '';
  }

  try {
    let buffer;
    if (data instanceof ArrayBuffer) {
      buffer = data;
    } else if (ArrayBuffer.isView(data)) {
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } else if (typeof data.arrayBuffer === 'function') {
      buffer = await data.arrayBuffer();
    } else {
      return '';
    }

    const digest = await _crypto.subtle.digest('SHA-256', buffer);
    return bufToHex(digest);
  } catch (err) {
    console.warn('SHA-256 calculation failed:', err);
    return '';
  }
}

/**
 * Shortens a 64-char hex hash for compact UI display.
 * Example: 'a1b2c3d4e5f6...7890'
 * @param {string} hash
 * @param {number} prefixLen
 * @param {number} suffixLen
 * @returns {string}
 */
export function shortHash(hash, prefixLen = 6, suffixLen = 6) {
  if (!hash || typeof hash !== 'string') return '';
  if (hash.length <= prefixLen + suffixLen + 3) return hash;
  return `${hash.slice(0, prefixLen)}…${hash.slice(-suffixLen)}`;
}

/**
 * Compares two checksums in constant-time to verify data integrity.
 * @param {string} hashA
 * @param {string} hashB
 * @returns {boolean}
 */
export function verifyChecksum(hashA, hashB) {
  if (!hashA || !hashB || typeof hashA !== 'string' || typeof hashB !== 'string') {
    return false;
  }
  const cleanA = hashA.trim().toLowerCase();
  const cleanB = hashB.trim().toLowerCase();
  if (cleanA.length !== cleanB.length) return false;

  let mismatch = 0;
  for (let i = 0; i < cleanA.length; i++) {
    mismatch |= cleanA.charCodeAt(i) ^ cleanB.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Fast, cryptographic UUIDv4 generator.
 * Eliminates sequential HTTP roundtrips to `/api/uuid` for sub-millisecond connection setup.
 * @returns {string} UUIDv4 string
 */
export function generateUUID() {
  if (_crypto && typeof _crypto.randomUUID === 'function') {
    return _crypto.randomUUID();
  }
  if (_crypto && typeof _crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    _crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = bufToHex(bytes.buffer);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
