// ==========================================================================
// AirRelay Professional Admin Console Controller
// Real-time peer monitoring, session telemetry, diagnostics & controls
// ==========================================================================

const API_BASE = '/api/admin';

// State
const state = {
  token: localStorage.getItem('airrelay_admin_token') || sessionStorage.getItem('airrelay_admin_token') || null,
  activeTab: 'peers',
  refreshInterval: 3000,
  timerId: null,
  isFetching: false,
  metrics: null,
  peers: [],
  rooms: [],
  events: [],
  sparklineData: [], // rolling array of signal activity
  searchQuery: '',
  statusFilter: 'all',
  roleFilter: 'all',
  osFilter: 'all',
};

// DOM references
const dom = {
  // Header
  pulseStatus: document.getElementById('pulse-status'),
  pulseText: document.getElementById('pulse-text'),
  activeCountHeader: document.getElementById('header-active-count'),
  refreshIntervalSelect: document.getElementById('refresh-interval-select'),
  manualRefreshBtn: document.getElementById('manual-refresh-btn'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeText: document.getElementById('theme-text'),
  broadcastOpenBtn: document.getElementById('broadcast-open-btn'),
  exportBtn: document.getElementById('export-btn'),
  logoutBtn: document.getElementById('logout-btn'),

  // Alerts
  advisoryBanner: document.getElementById('advisory-banner'),

  // KPIs
  kpiActivePeers: document.getElementById('kpi-active-peers'),
  kpiActiveSub: document.getElementById('kpi-active-sub'),
  kpiActiveRooms: document.getElementById('kpi-active-rooms'),
  kpiRoomsSub: document.getElementById('kpi-rooms-sub'),
  kpiTotalSessions: document.getElementById('kpi-total-sessions'),
  kpiSessionsSub: document.getElementById('kpi-sessions-sub'),
  kpiRelayedTraffic: document.getElementById('kpi-relayed-traffic'),
  kpiTrafficSub: document.getElementById('kpi-traffic-sub'),
  kpiSystemResources: document.getElementById('kpi-system-resources'),
  kpiResourcesSub: document.getElementById('kpi-resources-sub'),
  kpiUptime: document.getElementById('kpi-uptime'),
  kpiUptimeSub: document.getElementById('kpi-uptime-sub'),

  // Charts
  sparklineSvg: document.getElementById('sparkline-svg'),
  sparklineRate: document.getElementById('sparkline-rate'),
  osDistList: document.getElementById('os-dist-list'),
  browserDistList: document.getElementById('browser-dist-list'),

  // Tabs & Toolbar
  tabPeersBtn: document.getElementById('tab-peers-btn'),
  tabRoomsBtn: document.getElementById('tab-rooms-btn'),
  tabHistoryBtn: document.getElementById('tab-history-btn'),
  tabEventsBtn: document.getElementById('tab-events-btn'),
  tabPeersCount: document.getElementById('tab-peers-count'),
  tabRoomsCount: document.getElementById('tab-rooms-count'),
  tabHistoryCount: document.getElementById('tab-history-count'),
  tabEventsCount: document.getElementById('tab-events-count'),
  searchInput: document.getElementById('table-search-input'),
  statusFilterSelect: document.getElementById('table-status-filter'),
  roleFilterSelect: document.getElementById('table-role-filter'),
  osFilterSelect: document.getElementById('table-os-filter'),

  // Views
  viewPeers: document.getElementById('view-peers'),
  viewRooms: document.getElementById('view-rooms'),
  viewHistory: document.getElementById('view-history'),
  viewEvents: document.getElementById('view-events'),

  // Tables & Feeds
  peersTableBody: document.getElementById('peers-table-body'),
  roomsTableBody: document.getElementById('rooms-table-body'),
  historyTableBody: document.getElementById('history-table-body'),
  eventsFeedList: document.getElementById('events-feed-list'),

  // Modals
  loginModal: document.getElementById('login-modal'),
  loginForm: document.getElementById('login-form'),
  loginUsernameInput: document.getElementById('login-username-input'),
  loginPasswordInput: document.getElementById('login-password-input'),
  loginRememberCheck: document.getElementById('login-remember-check'),
  loginError: document.getElementById('login-error'),
  loginBtn: document.getElementById('login-submit-btn'),

  peerDetailModal: document.getElementById('peer-detail-modal'),
  peerDetailContent: document.getElementById('peer-detail-content'),
  peerDetailCloseBtn: document.getElementById('peer-detail-close-btn'),

  broadcastModal: document.getElementById('broadcast-modal'),
  broadcastForm: document.getElementById('broadcast-form'),
  broadcastMsgInput: document.getElementById('broadcast-msg-input'),
  broadcastRoomInput: document.getElementById('broadcast-room-input'),
  broadcastLevelSelect: document.getElementById('broadcast-level-select'),
  broadcastCancelBtn: document.getElementById('broadcast-cancel-btn'),
  broadcastSubmitBtn: document.getElementById('broadcast-submit-btn'),

  kickModal: document.getElementById('kick-modal'),
  kickTargetName: document.getElementById('kick-target-name'),
  kickReasonInput: document.getElementById('kick-reason-input'),
  kickConfirmBtn: document.getElementById('kick-confirm-btn'),
  kickCancelBtn: document.getElementById('kick-cancel-btn'),

  toastContainer: document.getElementById('admin-toast-container'),
};

let currentKickPeerId = null;

// ==========================================================================
// Formatting & Helpers
// ==========================================================================

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 1) return '< 1s';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor((seconds / 3600) % 24);
  const d = Math.floor(seconds / 86400);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  if (!dom.toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'admin-toast';

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'danger') icon = '⚠️';

  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function copyToClipboard(text, label = 'Copied') {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${label} to clipboard!`, 'success');
  }).catch(() => {
    showToast('Failed to copy to clipboard', 'danger');
  });
}

// OS SVG Icons
function getOsIcon(osName) {
  const os = (osName || '').toLowerCase();
  if (os.includes('apple') || os.includes('mac') || os.includes('ios')) {
    return `<svg width="14" height="14" viewBox="0 0 170 170" fill="currentColor"><path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.69-3.04-7.67-7.81-11.96-14.34-6.41-9.78-11.48-20.98-15.19-33.6-3.71-12.63-5.57-24.28-5.57-34.96 0-14.34 3.73-26.08 11.19-35.21 7.46-9.13 16.71-13.78 27.75-13.96 4.35 0 9.16 1.05 14.42 3.17 5.26 2.12 9.07 3.24 11.44 3.35 2.13 0 6.07-1.17 11.83-3.53 5.76-2.35 10.74-3.35 14.96-2.99 15.86 1.05 27.78 7.31 35.76 18.77-13.94 8.44-20.76 19.99-20.46 34.65.29 11.44 4.54 20.97 12.74 28.59 4.12 3.8 8.78 6.64 13.98 8.52-2.82 8.27-6.52 16.77-11.1 25.5zm-33.15-117.84c.14 3.32-.48 6.78-1.87 10.37-1.39 3.59-3.51 6.94-6.35 10.05-3.04 3.32-6.55 5.92-10.53 7.8-3.98 1.88-7.79 2.99-11.44 3.34-.14-3.32.48-6.72 1.87-10.2 1.39-3.48 3.55-6.84 6.47-10.08 3.04-3.32 6.55-5.96 10.53-7.92 3.98-1.96 7.76-3.07 11.32-3.36z"/></svg>`;
  }
  if (os.includes('win')) {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 2.222v5.438h7.243V1.2L0 2.222zm0 6.1v5.457l7.243 1.022v-6.48H0zm7.986-7.34v6.677H16V0L7.986.982zM16 8.322H7.986v6.697L16 16V8.322z"/></svg>`;
  }
  if (os.includes('android')) {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2.76 3.061l-1.074-1.073a.473.473 0 0 0-.668.668l1.01 1.01a6.602 6.602 0 0 0-1.003 3.334h13.95a6.603 6.603 0 0 0-1.004-3.334l1.01-1.01a.473.473 0 0 0-.668-.668l-1.074 1.073A6.52 6.52 0 0 0 8 2a6.52 6.52 0 0 0-5.24 1.061zM4.5 5.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zm7 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM1 8v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8H1z"/></svg>`;
  }
  if (os.includes('linux')) {
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0c-2.3 0-3.5 1.5-3.5 3.5 0 .8.2 1.9.6 2.8C4.4 7 3.5 8.3 3.5 10c0 1.5.8 2.8 2 3.4-.2.4-.5.8-1 1.1-.3.2-.2.6.2.6 1.8 0 3.2-.9 3.8-2.1.2 0 .3 0 .5 0s.3 0 .5 0c.6 1.2 2 2.1 3.8 2.1.4 0 .5-.4.2-.6-.5-.3-.8-.7-1-1.1 1.2-.6 2-1.9 2-3.4 0-1.7-.9-3-1.6-3.7.4-.9.6-2 .6-2.8C11.5 1.5 10.3 0 8 0zM6.5 3.5c.4 0 .7.3.7.7s-.3.8-.7.8-.7-.4-.7-.8.3-.7.7-.7zm3 0c.4 0 .7.3.7.7s-.3.8-.7.8-.7-.4-.7-.8.3-.7.7-.7z"/></svg>`;
  }
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h6zM5 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H5z"/><path d="M8 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>`;
}

// ==========================================================================
// API Client
// ==========================================================================

async function apiRequest(endpoint, options = {}) {
  const headers = options.headers || {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(errorData.detail || `Error: ${res.status}`);
  }

  return res.json();
}

function handleUnauthorized() {
  state.token = null;
  localStorage.removeItem('airrelay_admin_token');
  sessionStorage.removeItem('airrelay_admin_token');
  stopPolling();
  openLoginModal();
}

// ==========================================================================
// Authentication Flow
// ==========================================================================

function openLoginModal() {
  if (dom.loginModal) {
    dom.loginModal.classList.add('open');
    if (dom.loginUsernameInput && !dom.loginUsernameInput.value) {
      dom.loginUsernameInput.value = 'airrelay_admin';
    }
    if (dom.loginPasswordInput) {
      dom.loginPasswordInput.value = '';
      if (dom.loginUsernameInput && dom.loginUsernameInput.value) {
        dom.loginPasswordInput.focus();
      } else if (dom.loginUsernameInput) {
        dom.loginUsernameInput.focus();
      }
    }
    if (dom.loginError) dom.loginError.style.display = 'none';
  }
}

function closeLoginModal() {
  if (dom.loginModal) dom.loginModal.classList.remove('open');
}

async function handleLogin(e) {
  e.preventDefault();
  const username = dom.loginUsernameInput ? dom.loginUsernameInput.value.trim() : '';
  const password = dom.loginPasswordInput ? dom.loginPasswordInput.value.trim() : '';

  if (!username) {
    if (dom.loginError) {
      dom.loginError.textContent = 'Please enter admin username';
      dom.loginError.style.display = 'block';
    }
    if (dom.loginUsernameInput) dom.loginUsernameInput.focus();
    return;
  }

  if (!password) {
    if (dom.loginError) {
      dom.loginError.textContent = 'Please enter admin password';
      dom.loginError.style.display = 'block';
    }
    if (dom.loginPasswordInput) dom.loginPasswordInput.focus();
    return;
  }

  dom.loginBtn.disabled = true;
  dom.loginBtn.textContent = 'Verifying...';
  if (dom.loginError) dom.loginError.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Incorrect username or password' }));
      throw new Error(err.detail || 'Authentication failed');
    }

    const data = await res.json();
    state.token = data.token;

    if (dom.loginRememberCheck && dom.loginRememberCheck.checked) {
      localStorage.setItem('airrelay_admin_token', data.token);
    } else {
      sessionStorage.setItem('airrelay_admin_token', data.token);
    }

    closeLoginModal();
    showToast('Authenticated successfully', 'success');
    startPolling();
    refreshAllData();
  } catch (err) {
    if (dom.loginError) {
      dom.loginError.textContent = err.message;
      dom.loginError.style.display = 'block';
    }
  } finally {
    dom.loginBtn.disabled = false;
    dom.loginBtn.textContent = 'Sign In';
  }
}

function handleLogout() {
  state.token = null;
  localStorage.removeItem('airrelay_admin_token');
  sessionStorage.removeItem('airrelay_admin_token');
  stopPolling();
  openLoginModal();
  showToast('Logged out', 'info');
}

// ==========================================================================
// Data Fetching & Polling
// ==========================================================================

async function refreshAllData() {
  if (!state.token || state.isFetching) return;
  state.isFetching = true;

  try {
    const [overview, peersRes, roomsRes, eventsRes] = await Promise.all([
      apiRequest('/overview'),
      apiRequest(`/peers?scope=all&limit=200`),
      apiRequest('/rooms'),
      apiRequest('/events?limit=80'),
    ]);

    state.metrics = overview;
    state.peers = peersRes.peers || [];
    state.rooms = roomsRes.rooms || [];
    state.events = eventsRes.events || [];

    renderOverview();
    renderTables();
  } catch (err) {
    console.error('Failed to refresh data:', err);
  } finally {
    state.isFetching = false;
  }
}

function startPolling() {
  stopPolling();
  if (state.refreshInterval > 0) {
    state.timerId = setInterval(refreshAllData, state.refreshInterval);
  }
}

function stopPolling() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

// ==========================================================================
// Rendering: Overview & KPIs
// ==========================================================================

function renderOverview() {
  const m = state.metrics;
  if (!m) return;

  // Advisory warning
  if (dom.advisoryBanner) {
    dom.advisoryBanner.style.display = m.is_default_password ? 'flex' : 'none';
  }

  // Header stats
  if (dom.activeCountHeader) {
    dom.activeCountHeader.textContent = `${m.active_connections} Active`;
  }

  // KPIs
  if (dom.kpiActivePeers) dom.kpiActivePeers.textContent = m.active_connections;
  if (dom.kpiActiveSub) dom.kpiActiveSub.textContent = `Peak: ${m.peak_concurrent_connections} concurrent`;

  if (dom.kpiActiveRooms) dom.kpiActiveRooms.textContent = m.active_rooms_count;
  if (dom.kpiRoomsSub) dom.kpiRoomsSub.textContent = `${state.rooms.reduce((acc, r) => acc + (r.total_members || 0), 0)} peers in rooms`;

  if (dom.kpiTotalSessions) dom.kpiTotalSessions.textContent = m.total_connections_served;
  if (dom.kpiSessionsSub) dom.kpiSessionsSub.textContent = `All-time connections served`;

  if (dom.kpiRelayedTraffic) dom.kpiRelayedTraffic.textContent = formatBytes(m.total_bytes_relayed);
  if (dom.kpiTrafficSub) dom.kpiTrafficSub.textContent = `${m.total_signals_relayed.toLocaleString()} WebRTC signals`;

  if (dom.kpiSystemResources) dom.kpiSystemResources.textContent = `${m.memory_usage_mb} MB`;
  if (dom.kpiResourcesSub) {
    const loadStr = m.cpu_load ? m.cpu_load.join(', ') : '0, 0, 0';
    dom.kpiResourcesSub.textContent = `Load: ${loadStr}`;
  }

  if (dom.kpiUptime) dom.kpiUptime.textContent = formatDuration(m.uptime_seconds);
  if (dom.kpiUptimeSub) dom.kpiUptimeSub.textContent = `${m.system_info.os} • Py ${m.system_info.python}`;

  // Tab count badges
  if (dom.tabPeersCount) dom.tabPeersCount.textContent = m.active_connections;
  if (dom.tabRoomsCount) dom.tabRoomsCount.textContent = m.active_rooms_count;
  if (dom.tabHistoryCount) {
    const historyCount = state.peers.filter(p => p.status === 'disconnected').length;
    dom.tabHistoryCount.textContent = historyCount;
  }
  if (dom.tabEventsCount) dom.tabEventsCount.textContent = state.events.length;

  // Sparkline
  updateSparkline(m.active_connections);

  // Distributions
  renderDistributions(m.os_distribution, m.browser_distribution);
}

// Sparkline Chart (pure SVG)
function updateSparkline(currentCount) {
  state.sparklineData.push(currentCount);
  if (state.sparklineData.length > 25) state.sparklineData.shift();

  const data = state.sparklineData;
  if (!dom.sparklineSvg || data.length < 2) return;

  const width = 600;
  const height = 160;
  const maxVal = Math.max(...data, 5);
  const minVal = 0;
  const stepX = width / (data.length - 1);

  const points = data.map((val, idx) => {
    const x = idx * stepX;
    const y = height - ((val - minVal) / (maxVal - minVal)) * (height - 30) - 15;
    return { x, y, val };
  });

  const pathD = points.reduce((acc, p, idx) => {
    return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, '');

  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  dom.sparklineSvg.innerHTML = `
    <defs>
      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    <path d="${areaD}" fill="url(#areaGrad)"/>
    <path d="${pathD}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#06b6d4" stroke="#ffffff" stroke-width="1.5"/>`).join('')}
  `;

  if (dom.sparklineRate) {
    dom.sparklineRate.textContent = `${currentCount} connected`;
  }
}

function renderDistributions(osDist, browserDist) {
  if (dom.osDistList) {
    const osEntries = Object.entries(osDist || {});
    const totalOs = osEntries.reduce((acc, [_, v]) => acc + v, 0) || 1;
    dom.osDistList.innerHTML = osEntries.length === 0
      ? '<div style="color:var(--admin-text-muted);font-size:0.8rem;">No OS telemetry yet</div>'
      : osEntries.map(([os, count]) => {
          const pct = Math.round((count / totalOs) * 100);
          return `
            <div class="dist-row">
              <div class="dist-meta">
                <span class="dist-name">${getOsIcon(os)} ${escapeHtml(os)}</span>
                <span style="color:var(--admin-text-secondary);">${count} (${pct}%)</span>
              </div>
              <div class="dist-bar-track">
                <div class="dist-bar-fill" style="width: ${pct}%;"></div>
              </div>
            </div>
          `;
        }).join('');
  }

  if (dom.browserDistList) {
    const brEntries = Object.entries(browserDist || {});
    const totalBr = brEntries.reduce((acc, [_, v]) => acc + v, 0) || 1;
    dom.browserDistList.innerHTML = brEntries.length === 0
      ? '<div style="color:var(--admin-text-muted);font-size:0.8rem;">No browser telemetry yet</div>'
      : brEntries.map(([browser, count]) => {
          const pct = Math.round((count / totalBr) * 100);
          return `
            <div class="dist-row">
              <div class="dist-meta">
                <span class="dist-name">🌐 ${escapeHtml(browser)}</span>
                <span style="color:var(--admin-text-secondary);">${count} (${pct}%)</span>
              </div>
              <div class="dist-bar-track">
                <div class="dist-bar-fill" style="width: ${pct}%; background: linear-gradient(135deg, #8b5cf6, #ec4899);"></div>
              </div>
            </div>
          `;
        }).join('');
  }
}

// ==========================================================================
// Rendering: Tables & Feeds
// ==========================================================================

function filterItems(items) {
  const query = state.searchQuery.toLowerCase().trim();
  return items.filter(item => {
    if (state.statusFilter !== 'all' && item.status !== state.statusFilter) return false;
    if (state.roleFilter !== 'all' && item.role !== state.roleFilter) return false;
    if (state.osFilter !== 'all' && !item.os.toLowerCase().includes(state.osFilter.toLowerCase())) return false;

    if (query) {
      const corpus = `${item.peer_id || ''} ${item.name || ''} ${item.ip || ''} ${item.room_id || ''} ${item.os || ''} ${item.browser || ''}`.toLowerCase();
      if (!corpus.includes(query)) return false;
    }
    return true;
  });
}

function renderTables() {
  renderPeersTable();
  renderRoomsTable();
  renderHistoryTable();
  renderEventsFeed();
}

function renderPeersTable() {
  if (!dom.peersTableBody) return;
  const activePeers = state.peers.filter(p => p.status !== 'disconnected');
  const filtered = filterItems(activePeers);

  if (filtered.length === 0) {
    dom.peersTableBody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding: 36px; color: var(--admin-text-muted);">
          No active connections matching current criteria.
        </td>
      </tr>
    `;
    return;
  }

  dom.peersTableBody.innerHTML = filtered.map(p => `
    <tr>
      <td>
        <span class="status-pill status-${p.status}">
          <span style="width:6px;height:6px;border-radius:50%;background:currentColor;"></span>
          ${p.status.toUpperCase()}
        </span>
      </td>
      <td>
        <span class="code-badge" onclick="window.adminCopy('${escapeHtml(p.peer_id)}', 'Peer ID')" title="Click to copy">
          ${escapeHtml(p.peer_id.slice(0, 8))}...
        </span>
      </td>
      <td>
        <strong style="color:var(--admin-text-primary);">${escapeHtml(p.name)}</strong>
      </td>
      <td>
        <span class="role-badge role-${p.role}">${p.role.toUpperCase()}</span>
      </td>
      <td>
        ${p.room_id ? `<span class="code-badge" onclick="window.adminCopy('${escapeHtml(p.room_id)}', 'Room ID')" title="Click to copy">${escapeHtml(p.room_id.slice(0, 8))}...</span>` : '<span style="color:var(--admin-text-muted);">-</span>'}
      </td>
      <td>
        <div style="display:flex;flex-direction:column;gap:2px;">
          <span>${escapeHtml(p.ip)}</span>
          <span style="font-size:0.7rem;color:var(--admin-text-muted);">${escapeHtml(p.ip_type)}</span>
        </div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          ${getOsIcon(p.os)}
          <span>${escapeHtml(p.os)}</span>
        </div>
      </td>
      <td>
        <span>🌐 ${escapeHtml(p.browser)}</span>
      </td>
      <td>
        <span>${formatDuration(p.duration_seconds)}</span>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="admin-btn admin-btn-sm" onclick="window.adminInspect('${escapeHtml(p.peer_id)}')">Inspect</button>
          <button class="admin-btn admin-btn-sm admin-btn-danger" onclick="window.adminPromptKick('${escapeHtml(p.peer_id)}', '${escapeHtml(p.name)}')">Kick</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderRoomsTable() {
  if (!dom.roomsTableBody) return;
  const rooms = state.rooms;

  if (rooms.length === 0) {
    dom.roomsTableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding: 36px; color: var(--admin-text-muted);">
          No active rooms currently open.
        </td>
      </tr>
    `;
    return;
  }

  dom.roomsTableBody.innerHTML = rooms.map(r => `
    <tr>
      <td>
        <span class="code-badge" onclick="window.adminCopy('${escapeHtml(r.room_id)}', 'Room ID')">
          ${escapeHtml(r.room_id.slice(0, 10))}...
        </span>
      </td>
      <td>
        <strong style="color:var(--admin-text-primary);">${escapeHtml(r.host_name)}</strong>
        <div style="font-size:0.72rem;color:var(--admin-text-muted);">${escapeHtml(r.host_ip || '')}</div>
      </td>
      <td>
        <span class="status-pill status-active">${r.total_members} Connected</span>
      </td>
      <td>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          ${r.participants.map(part => `
            <span class="code-badge" title="${escapeHtml(part.name)}">${escapeHtml(part.name.slice(0, 12))}</span>
          `).join('') || '<span style="color:var(--admin-text-muted);">Only host</span>'}
        </div>
      </td>
      <td>
        <span>${formatDuration(r.duration_seconds)}</span>
      </td>
      <td>
        <button class="admin-btn admin-btn-sm admin-btn-danger" onclick="window.adminCloseRoom('${escapeHtml(r.room_id)}')">Terminate Room</button>
      </td>
    </tr>
  `).join('');
}

function renderHistoryTable() {
  if (!dom.historyTableBody) return;
  const history = state.peers.filter(p => p.status === 'disconnected');
  const filtered = filterItems(history);

  if (filtered.length === 0) {
    dom.historyTableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 36px; color: var(--admin-text-muted);">
          No disconnected sessions recorded in current history.
        </td>
      </tr>
    `;
    return;
  }

  dom.historyTableBody.innerHTML = filtered.map(p => `
    <tr>
      <td>
        <span class="code-badge" onclick="window.adminCopy('${escapeHtml(p.peer_id)}', 'Peer ID')">
          ${escapeHtml(p.peer_id.slice(0, 8))}...
        </span>
      </td>
      <td>
        <strong style="color:var(--admin-text-primary);">${escapeHtml(p.name)}</strong>
      </td>
      <td>
        <span class="role-badge role-${p.role}">${p.role.toUpperCase()}</span>
      </td>
      <td>
        <span>${escapeHtml(p.ip)}</span>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          ${getOsIcon(p.os)}
          <span>${escapeHtml(p.os)} / ${escapeHtml(p.browser)}</span>
        </div>
      </td>
      <td>
        <span>${formatDuration(p.duration_seconds)}</span>
      </td>
      <td>
        <span style="color:var(--admin-status-danger);font-size:0.75rem;">${escapeHtml(p.disconnect_reason || 'Closed')}</span>
      </td>
      <td>
        <button class="admin-btn admin-btn-sm" onclick="window.adminInspect('${escapeHtml(p.peer_id)}')">Inspect</button>
      </td>
    </tr>
  `).join('');
}

function renderEventsFeed() {
  if (!dom.eventsFeedList) return;
  const events = state.events;

  if (events.length === 0) {
    dom.eventsFeedList.innerHTML = `
      <div style="text-align:center; padding: 24px; color: var(--admin-text-muted);">
        No audit events recorded yet.
      </div>
    `;
    return;
  }

  dom.eventsFeedList.innerHTML = events.map(ev => {
    let badgeClass = 'audit-badge-info';
    if (ev.severity === 'warning') badgeClass = 'audit-badge-warning';
    if (ev.severity === 'danger') badgeClass = 'audit-badge-danger';

    const dateStr = new Date(ev.timestamp).toLocaleTimeString();

    return `
      <div class="audit-item">
        <div class="audit-meta">
          <span class="audit-badge ${badgeClass}">${escapeHtml(ev.type)}</span>
          <span style="color:var(--admin-text-primary);">${escapeHtml(ev.message)}</span>
        </div>
        <span style="color:var(--admin-text-muted);font-size:0.75rem;white-space:nowrap;">${dateStr}</span>
      </div>
    `;
  }).join('');
}

// ==========================================================================
// Administrative Actions: Inspect, Kick, Broadcast, Export
// ==========================================================================

async function inspectPeer(peerId) {
  try {
    const peer = await apiRequest(`/peers/${peerId}`);
    if (!dom.peerDetailModal || !dom.peerDetailContent) return;

    dom.peerDetailContent.innerHTML = `
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-label">Peer ID</div>
          <div class="detail-value code-badge" onclick="window.adminCopy('${escapeHtml(peer.peer_id)}')">${escapeHtml(peer.peer_id)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Session ID</div>
          <div class="detail-value font-mono">${escapeHtml(peer.session_id)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Display Name</div>
          <div class="detail-value">${escapeHtml(peer.name)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Role</div>
          <div class="detail-value"><span class="role-badge role-${peer.role}">${peer.role.toUpperCase()}</span></div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Room ID</div>
          <div class="detail-value">${peer.room_id ? `<span class="code-badge" onclick="window.adminCopy('${escapeHtml(peer.room_id)}')">${escapeHtml(peer.room_id)}</span>` : 'None'}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Status</div>
          <div class="detail-value"><span class="status-pill status-${peer.status}">${peer.status.toUpperCase()}</span></div>
        </div>
        <div class="detail-item">
          <div class="detail-label">IP Address</div>
          <div class="detail-value">${escapeHtml(peer.ip)} (${escapeHtml(peer.ip_type)})</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Device & OS</div>
          <div class="detail-value">${getOsIcon(peer.os)} ${escapeHtml(peer.os)} (${escapeHtml(peer.device)})</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Browser</div>
          <div class="detail-value">🌐 ${escapeHtml(peer.browser)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Connected Duration</div>
          <div class="detail-value">${formatDuration(peer.duration_seconds)} (Idle: ${peer.idle_seconds}s)</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">WebRTC Traffic</div>
          <div class="detail-value">Sent: ${peer.signals_sent} • Recv: ${peer.signals_received} (${formatBytes(peer.bytes_relayed)})</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Signal Targets</div>
          <div class="detail-value">${peer.targets.length} remote peers (${escapeHtml(peer.targets.map(t => t.slice(0, 6)).join(', ') || 'None')})</div>
        </div>
      </div>

      <div class="form-group" style="margin-top: 14px;">
        <label>User Agent Header</label>
        <textarea class="form-control" readonly style="font-size:0.75rem;height:60px;">${escapeHtml(peer.user_agent)}</textarea>
      </div>

      ${peer.disconnected_at ? `
        <div class="detail-item" style="border-color: rgba(239, 68, 68, 0.4);">
          <div class="detail-label" style="color:var(--admin-status-danger);">Disconnect Reason</div>
          <div class="detail-value" style="color:var(--admin-status-danger);">${escapeHtml(peer.disconnect_reason || 'Unknown')} (Close Code: ${peer.close_code || 'None'})</div>
        </div>
      ` : `
        <div style="display:flex;justify-content:flex-end;margin-top:10px;">
          <button class="admin-btn admin-btn-danger" onclick="window.adminPromptKick('${escapeHtml(peer.peer_id)}', '${escapeHtml(peer.name)}')">Kick This Peer</button>
        </div>
      `}
    `;

    dom.peerDetailModal.classList.add('open');
  } catch (err) {
    showToast(`Failed to load peer details: ${err.message}`, 'danger');
  }
}

function promptKickPeer(peerId, name) {
  currentKickPeerId = peerId;
  if (dom.kickTargetName) dom.kickTargetName.textContent = name || peerId;
  if (dom.kickReasonInput) dom.kickReasonInput.value = 'Disconnected by administrator';
  if (dom.kickModal) dom.kickModal.classList.add('open');
}

async function confirmKickPeer() {
  if (!currentKickPeerId) return;
  const reason = dom.kickReasonInput ? dom.kickReasonInput.value.trim() : '';

  try {
    await apiRequest(`/peers/${currentKickPeerId}/kick`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });

    showToast(`Peer kicked successfully`, 'success');
    if (dom.kickModal) dom.kickModal.classList.remove('open');
    if (dom.peerDetailModal) dom.peerDetailModal.classList.remove('open');
    refreshAllData();
  } catch (err) {
    showToast(`Failed to kick peer: ${err.message}`, 'danger');
  } finally {
    currentKickPeerId = null;
  }
}

async function closeRoom(roomId) {
  if (!confirm(`Are you sure you want to terminate room '${roomId}' and disconnect all participants?`)) return;

  try {
    const res = await apiRequest(`/rooms/${roomId}/close`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Room terminated by administrator' }),
    });
    showToast(`Room terminated (${res.kicked_count} peers disconnected)`, 'success');
    refreshAllData();
  } catch (err) {
    showToast(`Failed to close room: ${err.message}`, 'danger');
  }
}

async function handleBroadcastSubmit(e) {
  e.preventDefault();
  const message = dom.broadcastMsgInput.value.trim();
  if (!message) return;

  const roomId = dom.broadcastRoomInput.value.trim() || null;
  const level = dom.broadcastLevelSelect.value;

  dom.broadcastSubmitBtn.disabled = true;
  dom.broadcastSubmitBtn.textContent = 'Sending...';

  try {
    const res = await apiRequest('/broadcast', {
      method: 'POST',
      body: JSON.stringify({ message, room_id: roomId, level }),
    });

    showToast(`Broadcast delivered to ${res.recipients_count} peer(s)`, 'success');
    dom.broadcastModal.classList.remove('open');
    dom.broadcastMsgInput.value = '';
    dom.broadcastRoomInput.value = '';
  } catch (err) {
    showToast(`Broadcast failed: ${err.message}`, 'danger');
  } finally {
    dom.broadcastSubmitBtn.disabled = false;
    dom.broadcastSubmitBtn.textContent = 'Send Announcement';
  }
}

function triggerExport(format = 'json') {
  if (!state.token) return;
  const url = `${API_BASE}/export?format=${format}&token=${encodeURIComponent(state.token)}`;
  window.open(url, '_blank');
}

// ==========================================================================
// Tab Switching
// ==========================================================================

function switchTab(tabName) {
  state.activeTab = tabName;

  const tabs = [
    { name: 'peers', btn: dom.tabPeersBtn, view: dom.viewPeers },
    { name: 'rooms', btn: dom.tabRoomsBtn, view: dom.viewRooms },
    { name: 'history', btn: dom.tabHistoryBtn, view: dom.viewHistory },
    { name: 'events', btn: dom.tabEventsBtn, view: dom.viewEvents },
  ];

  tabs.forEach(t => {
    if (t.name === tabName) {
      if (t.btn) t.btn.classList.add('active');
      if (t.view) t.view.style.display = 'block';
    } else {
      if (t.btn) t.btn.classList.remove('active');
      if (t.view) t.view.style.display = 'none';
    }
  });

  renderTables();
}

// Theme handling
function initTheme() {
  const saved = localStorage.getItem('airrelay_admin_theme');
  if (saved === 'light') {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    if (dom.themeText) dom.themeText.textContent = 'Light';
  } else {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
    if (dom.themeText) dom.themeText.textContent = 'Dark';
  }
}

function toggleTheme() {
  const isLight = document.documentElement.classList.contains('light');
  if (isLight) {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
    localStorage.setItem('airrelay_admin_theme', 'dark');
    if (dom.themeText) dom.themeText.textContent = 'Dark';
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    localStorage.setItem('airrelay_admin_theme', 'light');
    if (dom.themeText) dom.themeText.textContent = 'Light';
  }
}

// Global window helpers for inline onclick handlers
window.adminCopy = copyToClipboard;
window.adminInspect = inspectPeer;
window.adminPromptKick = promptKickPeer;
window.adminCloseRoom = closeRoom;

// ==========================================================================
// Initialization & Event Wiring
// ==========================================================================

function initEvents() {
  // Theme
  if (dom.themeToggleBtn) dom.themeToggleBtn.addEventListener('click', toggleTheme);

  // Auth
  if (dom.loginForm) dom.loginForm.addEventListener('submit', handleLogin);
  if (dom.logoutBtn) dom.logoutBtn.addEventListener('click', handleLogout);

  // Refresh
  if (dom.manualRefreshBtn) {
    dom.manualRefreshBtn.addEventListener('click', () => {
      dom.manualRefreshBtn.style.transform = 'rotate(180deg)';
      setTimeout(() => dom.manualRefreshBtn.style.transform = 'none', 300);
      refreshAllData();
      showToast('Data refreshed', 'info');
    });
  }

  if (dom.refreshIntervalSelect) {
    dom.refreshIntervalSelect.addEventListener('change', (e) => {
      state.refreshInterval = parseInt(e.target.value, 10);
      startPolling();
    });
  }

  // Tabs
  if (dom.tabPeersBtn) dom.tabPeersBtn.addEventListener('click', () => switchTab('peers'));
  if (dom.tabRoomsBtn) dom.tabRoomsBtn.addEventListener('click', () => switchTab('rooms'));
  if (dom.tabHistoryBtn) dom.tabHistoryBtn.addEventListener('click', () => switchTab('history'));
  if (dom.tabEventsBtn) dom.tabEventsBtn.addEventListener('click', () => switchTab('events'));

  // Filtering
  if (dom.searchInput) {
    dom.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderTables();
    });
  }
  if (dom.statusFilterSelect) {
    dom.statusFilterSelect.addEventListener('change', (e) => {
      state.statusFilter = e.target.value;
      renderTables();
    });
  }
  if (dom.roleFilterSelect) {
    dom.roleFilterSelect.addEventListener('change', (e) => {
      state.roleFilter = e.target.value;
      renderTables();
    });
  }
  if (dom.osFilterSelect) {
    dom.osFilterSelect.addEventListener('change', (e) => {
      state.osFilter = e.target.value;
      renderTables();
    });
  }

  // Modals
  if (dom.peerDetailCloseBtn && dom.peerDetailModal) {
    dom.peerDetailCloseBtn.addEventListener('click', () => dom.peerDetailModal.classList.remove('open'));
  }

  if (dom.broadcastOpenBtn && dom.broadcastModal) {
    dom.broadcastOpenBtn.addEventListener('click', () => dom.broadcastModal.classList.add('open'));
  }
  if (dom.broadcastCancelBtn && dom.broadcastModal) {
    dom.broadcastCancelBtn.addEventListener('click', () => dom.broadcastModal.classList.remove('open'));
  }
  if (dom.broadcastForm) dom.broadcastForm.addEventListener('submit', handleBroadcastSubmit);

  if (dom.kickCancelBtn && dom.kickModal) {
    dom.kickCancelBtn.addEventListener('click', () => dom.kickModal.classList.remove('open'));
  }
  if (dom.kickConfirmBtn) dom.kickConfirmBtn.addEventListener('click', confirmKickPeer);

  if (dom.exportBtn) {
    dom.exportBtn.addEventListener('click', () => {
      const choice = confirm('Download export in CSV format? (Click Cancel for JSON)');
      triggerExport(choice ? 'csv' : 'json');
    });
  }

  // Close modals on overlay backdrop click
  document.querySelectorAll('.admin-modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && overlay !== dom.loginModal) {
        overlay.classList.remove('open');
      }
    });
  });
}

// Initial Boot
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initEvents();

  if (!state.token) {
    openLoginModal();
  } else {
    try {
      await apiRequest('/verify');
      startPolling();
      refreshAllData();
    } catch {
      openLoginModal();
    }
  }
});
