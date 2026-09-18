// ==========================================================================
// AirRelay Network Telemetry & Topology Engine
// Deep inspection of WebRTC ICE candidate pairs, transport protocols,
// round-trip time (RTT), and physical link classification.
// ==========================================================================

/**
 * Classifies an active ICE candidate pair into human-readable topology.
 * @param {string} localType - 'host' | 'srflx' | 'prflx' | 'relay'
 * @param {string} remoteType - 'host' | 'srflx' | 'prflx' | 'relay'
 * @returns {{ type: 'lan'|'p2p'|'relay'|'unknown', label: string, shortLabel: string, icon: string, badgeClass: string }}
 */
export function classifyTopology(localType, remoteType) {
  if (!localType && !remoteType) {
    return {
      type: 'unknown',
      label: 'Connecting...',
      shortLabel: 'Connecting',
      icon: '⏳',
      badgeClass: 'net-badge-unknown',
    };
  }

  // Both endpoints are using host candidates => same local network / subnet
  if (localType === 'host' && remoteType === 'host') {
    return {
      type: 'lan',
      label: 'Direct LAN (Local Network)',
      shortLabel: 'Direct LAN',
      icon: '⚡',
      badgeClass: 'net-badge-lan',
    };
  }

  // Either endpoint is routing through a TURN relay
  if (localType === 'relay' || remoteType === 'relay') {
    return {
      type: 'relay',
      label: 'Encrypted Relay (Coturn)',
      shortLabel: 'Relayed',
      icon: '🔄',
      badgeClass: 'net-badge-relay',
    };
  }

  // STUN hole-punched direct P2P WAN connection across NAT
  return {
    type: 'p2p',
    label: 'Direct P2P (UDP NAT)',
    shortLabel: 'Direct P2P',
    icon: '🌐',
    badgeClass: 'net-badge-p2p',
  };
}

/**
 * Formats RTT in milliseconds to a crisp readable string.
 * @param {number|null} rttMs
 * @returns {string}
 */
export function formatRtt(rttMs) {
  if (rttMs === null || rttMs === undefined || !Number.isFinite(rttMs)) return '';
  if (rttMs < 1) return '<1 ms';
  return `${Math.round(rttMs)} ms`;
}

/**
 * Inspects an RTCPeerConnection via getStats() to extract live network metrics.
 * @param {RTCPeerConnection} pc
 * @returns {Promise<Object|null>}
 */
export async function inspectPeerConnection(pc) {
  if (!pc || typeof pc.getStats !== 'function') return null;

  try {
    const stats = await pc.getStats();
    let selectedPair = null;

    // Find the nominated/selected candidate pair
    for (const report of stats.values()) {
      if (report.type === 'candidate-pair' && (report.selected || report.nominated || report.state === 'succeeded')) {
        selectedPair = report;
        break;
      }
    }

    if (!selectedPair) {
      // Fallback: look for transport report with selectedCandidatePairId
      for (const report of stats.values()) {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          selectedPair = stats.get(report.selectedCandidatePairId);
          break;
        }
      }
    }

    if (!selectedPair) {
      return {
        topology: 'unknown',
        label: 'Establishing link...',
        shortLabel: 'P2P',
        icon: '⏳',
        rttMs: null,
        rttFormatted: '',
        protocol: 'UDP',
        localType: '',
        remoteType: '',
        localAddress: '',
        remoteAddress: '',
        badgeClass: 'net-badge-unknown',
      };
    }

    const localCand = stats.get(selectedPair.localCandidateId) || {};
    const remoteCand = stats.get(selectedPair.remoteCandidateId) || {};

    const localType = localCand.candidateType || '';
    const remoteType = remoteCand.candidateType || '';
    const protocol = (localCand.protocol || selectedPair.protocol || 'UDP').toUpperCase();

    const rttSec = typeof selectedPair.currentRoundTripTime === 'number'
      ? selectedPair.currentRoundTripTime
      : null;
    const rttMs = rttSec !== null ? rttSec * 1000 : null;

    const classification = classifyTopology(localType, remoteType);

    return {
      topology: classification.type,
      label: classification.label,
      shortLabel: classification.shortLabel,
      icon: classification.icon,
      badgeClass: classification.badgeClass,
      rttMs,
      rttFormatted: formatRtt(rttMs),
      protocol,
      localType,
      remoteType,
      localAddress: localCand.address || localCand.ip || '',
      remoteAddress: remoteCand.address || remoteCand.ip || '',
      bytesSent: selectedPair.bytesSent || 0,
      bytesReceived: selectedPair.bytesReceived || 0,
    };
  } catch (err) {
    console.warn('inspectPeerConnection failed:', err);
    return null;
  }
}

/**
 * Creates an HTML badge snippet representing the network link.
 * @param {Object} telemetry
 * @returns {string}
 */
export function renderTelemetryBadge(telemetry) {
  if (!telemetry) return '';
  const rttPart = telemetry.rttFormatted ? ` · ${telemetry.rttFormatted}` : '';
  return `
    <span class="net-topology-badge ${telemetry.badgeClass}" title="${telemetry.label} (${telemetry.protocol})">
      <span class="net-badge-icon">${telemetry.icon}</span>
      <span class="net-badge-text">${telemetry.shortLabel}${rttPart}</span>
    </span>
  `.trim();
}
