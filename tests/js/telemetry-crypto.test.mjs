import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyTopology,
  formatRtt,
  inspectPeerConnection,
  renderTelemetryBadge,
} from '../../web/js/modules/telemetry.js';

import {
  bufToHex,
  computeSha256,
  shortHash,
  verifyChecksum,
} from '../../web/js/modules/crypto.js';

import {
  isSoundEnabled,
  setSoundEnabled,
  toggleSound,
  triggerHaptic,
  soundFileDrop,
  soundPeerJoin,
  soundTransferComplete,
} from '../../web/js/modules/sound.js';

import {
  acquireWakeLock,
  releaseWakeLock,
} from '../../web/js/modules/wakelock.js';

test('classifyTopology correctly identifies LAN, P2P, and Relay candidate combinations', () => {
  // Direct LAN when both are host
  const lan = classifyTopology('host', 'host');
  assert.equal(lan.type, 'lan');
  assert.equal(lan.icon, '⚡');
  assert.equal(lan.badgeClass, 'net-badge-lan');
  assert.match(lan.label, /Direct LAN/);

  // Relay if either candidate is relay (TURN)
  const relayLocal = classifyTopology('relay', 'host');
  assert.equal(relayLocal.type, 'relay');
  assert.equal(relayLocal.icon, '🔄');
  assert.equal(relayLocal.badgeClass, 'net-badge-relay');

  const relayRemote = classifyTopology('srflx', 'relay');
  assert.equal(relayRemote.type, 'relay');

  // Direct P2P via STUN hole punching (srflx/prflx/host combinations)
  const p2p1 = classifyTopology('srflx', 'prflx');
  assert.equal(p2p1.type, 'p2p');
  assert.equal(p2p1.icon, '🌐');
  assert.equal(p2p1.badgeClass, 'net-badge-p2p');

  const p2p2 = classifyTopology('host', 'srflx');
  assert.equal(p2p2.type, 'p2p');

  // Unknown/connecting when candidate types are missing
  const unknown = classifyTopology('', '');
  assert.equal(unknown.type, 'unknown');
  assert.equal(unknown.icon, '⏳');
});

test('formatRtt formats milliseconds cleanly', () => {
  assert.equal(formatRtt(null), '');
  assert.equal(formatRtt(undefined), '');
  assert.equal(formatRtt(NaN), '');
  assert.equal(formatRtt(0.2), '<1 ms');
  assert.equal(formatRtt(0), '<1 ms');
  assert.equal(formatRtt(14.8), '15 ms');
  assert.equal(formatRtt(120), '120 ms');
});

test('renderTelemetryBadge produces accessible HTML badges', () => {
  assert.equal(renderTelemetryBadge(null), '');

  const badgeHtml = renderTelemetryBadge({
    topology: 'lan',
    label: 'Direct LAN (Local Network)',
    shortLabel: 'Direct LAN',
    icon: '⚡',
    badgeClass: 'net-badge-lan',
    protocol: 'UDP',
    rttFormatted: '4 ms',
  });

  assert.ok(badgeHtml.includes('net-badge-lan'));
  assert.ok(badgeHtml.includes('⚡'));
  assert.ok(badgeHtml.includes('Direct LAN · 4 ms'));
  assert.ok(badgeHtml.includes('title="Direct LAN (Local Network) (UDP)"'));
});

test('inspectPeerConnection extracts RTT and topology metrics from getStats()', async () => {
  // Non-PC input returns null gracefully
  assert.equal(await inspectPeerConnection(null), null);
  assert.equal(await inspectPeerConnection({}), null);

  const mockStats = new Map();
  mockStats.set('pair-1', {
    id: 'pair-1',
    type: 'candidate-pair',
    selected: true,
    localCandidateId: 'cand-loc',
    remoteCandidateId: 'cand-rem',
    currentRoundTripTime: 0.0125, // 12.5 ms
    protocol: 'udp',
    bytesSent: 1048576,
    bytesReceived: 524288,
  });
  mockStats.set('cand-loc', {
    id: 'cand-loc',
    type: 'local-candidate',
    candidateType: 'host',
    address: '192.168.1.50',
    protocol: 'udp',
  });
  mockStats.set('cand-rem', {
    id: 'cand-rem',
    type: 'remote-candidate',
    candidateType: 'host',
    address: '192.168.1.75',
    protocol: 'udp',
  });

  const fakePc = {
    getStats: async () => mockStats,
  };

  const result = await inspectPeerConnection(fakePc);
  assert.ok(result);
  assert.equal(result.topology, 'lan');
  assert.equal(result.icon, '⚡');
  assert.equal(result.rttMs, 12.5);
  assert.equal(result.rttFormatted, '13 ms');
  assert.equal(result.localAddress, '192.168.1.50');
  assert.equal(result.remoteAddress, '192.168.1.75');
  assert.equal(result.bytesSent, 1048576);
  assert.equal(result.bytesReceived, 524288);
});

test('crypto engine: bufToHex converts raw buffers', () => {
  const bytes = new Uint8Array([0, 15, 16, 255]);
  assert.equal(bufToHex(bytes.buffer), '000f10ff');
});

test('crypto engine: computeSha256 produces valid SHA-256 digests', async () => {
  // Known SHA-256 of empty buffer
  const emptyHash = await computeSha256(new Uint8Array(0));
  assert.equal(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  // Known SHA-256 of string "AirRelay"
  const encoder = new TextEncoder();
  const airRelayHash = await computeSha256(encoder.encode('AirRelay'));
  assert.equal(typeof airRelayHash, 'string');
  assert.equal(airRelayHash.length, 64);
  assert.equal(airRelayHash, 'ba30f73b00716f79cbd330c7b0afbdbe54a6bdf390ae216248d379d19bcf5f55');
});

test('crypto engine: shortHash truncates for clean UI display', () => {
  assert.equal(shortHash(''), '');
  assert.equal(shortHash(null), '');
  assert.equal(shortHash('short'), 'short');

  const fullHash = 'ba30f73b00716f79cbd330c7b0afbdbe54a6bdf390ae216248d379d19bcf5f55';
  const shortened = shortHash(fullHash, 6, 6);
  assert.equal(shortened, 'ba30f7…cf5f55');
});

test('crypto engine: verifyChecksum performs constant-time integrity validation', () => {
  const hash1 = 'ba30f73b00716f79cbd330c7b0afbdbe54a6bdf390ae216248d379d19bcf5f55';
  const hash2 = 'BA30F73B00716F79CBD330C7B0AFBDBE54A6BDF390AE216248D379D19BCF5F55';
  const hash3 = 'ba30f73b00716f79cbd330c7b0afbdbe54a6bdf390ae216248d379d19bcf5f50'; // last char changed

  assert.equal(verifyChecksum(hash1, hash2), true); // case insensitive
  assert.equal(verifyChecksum(hash1, hash3), false);
  assert.equal(verifyChecksum(hash1, 'truncated'), false);
  assert.equal(verifyChecksum(null, hash1), false);
  assert.equal(verifyChecksum(hash1, undefined), false);
});

test('sound engine: controls and safe execution in non-audio environments', () => {
  setSoundEnabled(true);
  assert.equal(isSoundEnabled(), true);

  toggleSound();
  assert.equal(isSoundEnabled(), false);

  toggleSound();
  assert.equal(isSoundEnabled(), true);

  // Calling sound triggers should be completely safe even in Node environment without AudioContext
  assert.doesNotThrow(() => {
    soundFileDrop();
    soundPeerJoin();
    soundTransferComplete();
    triggerHaptic([20]);
  });
});

test('wakelock engine: safe acquisition and release lifecycle', async () => {
  // Non-supporting environments (Node.js) should never throw
  await assert.doesNotReject(async () => {
    await acquireWakeLock('file-test-1');
    await acquireWakeLock('file-test-2');
    await releaseWakeLock('file-test-1');
    await releaseWakeLock('file-test-2');
  });
});
