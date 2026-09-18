import { dom, showToast } from './dom.js';
import { User, getOSIconSVG, getIdenticonSVG } from './webrtc/user.js';
import { registerServiceWorker, installSinkBadge, sinkState, activeMode } from './sink.js';
import { installIceModeBadge } from './webrtc/mode.js';
import { isSoundEnabled, toggleSound } from './sound.js';

// Room ID
const room_id = window.location.pathname.substring(1)

// Store current user
var user;

// QR Code instance for hidden canvas
var qr = new QRious({
  element: document.getElementById('transfer-qr-code'),
  background: 'transparent',
  size: 220,
  foreground: '#adb5db',
  level: 'H',
})

// QR Code instance for modal
var modalQr = null;
function getModalQr() {
  if (!modalQr && dom.qr_modal_canvas) {
    modalQr = new QRious({
      element: dom.qr_modal_canvas,
      background: '#ffffff',
      size: 240,
      foreground: '#080b11',
      level: 'H',
    });
  }
  return modalQr;
}

// QR Code instance for inline room connect hub
var inlineRoomQr = null;
function getInlineRoomQr() {
  if (!inlineRoomQr && dom.room_qr_canvas) {
    inlineRoomQr = new QRious({
      element: dom.room_qr_canvas,
      background: '#ffffff',
      size: 200,
      foreground: '#080b11',
      level: 'H',
    });
  }
  return inlineRoomQr;
}

function updateQRCodes(url) {
  qr.set({ value: url });
  const mq = getModalQr();
  if (mq) mq.set({ value: url });
  const irq = getInlineRoomQr();
  if (irq) irq.set({ value: url });
}

// Get theme mode
if (window.localStorage.getItem('mode') == 'light') {
  dom.theme_text.innerHTML = 'Light'
  dom.comic_img.src = "assets/comic.png"
  qr.set({foreground: '#212529'});
  const mq = getModalQr();
  if (mq) mq.set({foreground: '#0f172a'});
  const irq = getInlineRoomQr();
  if (irq) irq.set({foreground: '#0f172a'});
}

// Load app version from API. Cosmetic — never let it block or break app boot.
async function loadVersion() {
  try {
    const res = await fetch('/api/');
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.version) {
      document.getElementById('appVersion').textContent = `v${data.version}`;
    }
  } catch {}
}

// On Load
async function onLoad() {
  // Load version badge
  await loadVersion();

  // Check WebRTC browser compatibility
  if (typeof RTCPeerConnection === 'undefined') {
    dom.error_div.style.display = 'block'
    dom.error_message.innerHTML = 'Your browser does not support <a href="https://caniuse.com/?search=webrtc" target="_blank" style="color: inherit; text-decoration: underline;">WebRTC</a>.<br><span style="color: #6c757d; font-size: 14px; margin-top: 10px; display: inline-block;">Please use a modern browser such as Chrome, Firefox, or Safari.</span>'
    return
  }

  // Register the Service Worker (no-op in insecure contexts).
  await registerServiceWorker();

  // Show the dev sink badge if a ?sink= override is active.
  installSinkBadge();

  // Show the dev ICE badge if a ?ice= override is active. Stacks above the sink
  // badge when both are present.
  installIceModeBadge();

  // Surface a one-time warning if the only sink available is the in-memory Blob fallback
  // (insecure HTTP context, non-localhost). Large files will OOM in this configuration.
  maybeShowInsecureContextWarning();

  // Create current user
  user = new User(room_id)

  // Host
  if (room_id.length == 0) {
    // Generate Room ID
    const new_room_id = generateRoomID()

    // Init UI Components
    dom.transfer_div.style.display = 'block'
    dom.transfer_url_value.textContent = `${window.location.origin}/${new_room_id}`
    dom.transfer_users_list_host_name.innerHTML = user.name + ' (You)'
    const hostAvatar = document.getElementById('transfer-users-list-host-avatar');
    if (hostAvatar) hostAvatar.innerHTML = getIdenticonSVG(user.name, 18);
    if (dom.transfer_users_list_host_os) {
      dom.transfer_users_list_host_os.innerHTML = getOSIconSVG(user.os, 16);
    }
    dom.transfer_users_count.innerHTML = ' (1)'
    dom.transfer_add_password.style.display = 'block';
    updateQRCodes(dom.transfer_url_value.textContent);

    // Init peer connection. user.init throws on ICE-credential failure or any pre-
    // 'open' Peer error — surface that here so the host UI doesn't sit silently on
    // top of a half-initialized user._peer.
    try {
      await user.init(new_room_id);
      if (user.code) {
        const formattedCode = `${user.code.slice(0, 3)} ${user.code.slice(3, 6)}`;
        if (dom.room_code_val) dom.room_code_val.textContent = formattedCode;
        if (dom.qr_modal_code_val) dom.qr_modal_code_val.textContent = formattedCode;
      }
      checkSharedTargetFiles(user);
      // Auto-discover other active rooms on the local network (AirDrop style)
      checkAndDisplayNearbyRooms();
    } catch (err) {
      console.warn('Host init failed:', err);
      dom.transfer_div.style.display = 'none';
      dom.connect_div.style.display = 'none';
      dom.error_div.style.display = 'block';
      dom.error_message.innerHTML = 'Could not start AirRelay. Please check your connection and refresh the page.';
      return;
    }
  }
  // Peer
  else {
    if (dom.action_mode_nav) dom.action_mode_nav.style.display = 'none';
    if (dom.room_tab_security_btn) dom.room_tab_security_btn.style.display = 'none';

    // Init UI Components
    dom.connect_div.style.display = 'block';
    updateConnectStatus('Finding room...', 'Resolving peer and connection info');

    let targetPeerId = room_id;
    try {
      const res = await fetch(`/api/rooms/resolve/${encodeURIComponent(room_id)}`);
      if (res.ok) {
        const data = await res.json();
        const resolvedId = data?.peer_id || data?.host_id || data?.room_id;
        if (data && resolvedId) {
          targetPeerId = resolvedId;
          if (data.code) {
            const formattedCode = `${data.code.slice(0, 3)} ${data.code.slice(3, 6)}`;
            if (dom.room_code_val) dom.room_code_val.textContent = formattedCode;
            if (dom.qr_modal_code_val) dom.qr_modal_code_val.textContent = formattedCode;
          }
        }
      }
    } catch (err) {
      console.warn('Room resolution via API failed:', err);
    }

    dom.transfer_url_value.textContent = `${window.location.origin}/${targetPeerId}`;
    updateQRCodes(dom.transfer_url_value.textContent);

    updateConnectStatus('Preparing connection...', 'Pre-warming WebRTC ICE candidates');
    try {
      await user.init();
      checkSharedTargetFiles(user);
    } catch (err) {
      console.warn('Peer init failed:', err);
      dom.connect_div.style.display = 'none';
      dom.error_div.style.display = 'block';
      dom.error_message.innerHTML = 'Could not start AirRelay. Please check your connection and refresh the page.';
      return;
    }

    updateConnectStatus('Connecting to peer...', 'Exchanging ICE candidates & DTLS encryption keys');
    try {
      await user.connect(targetPeerId);
    } catch (err) {
      console.warn('Failed to join room:', err);
      dom.connect_div.style.display = 'none';
      dom.error_div.style.display = 'block';
      dom.error_message.innerHTML = 'Could not reach the host. The room may no longer be active.';
    }
  }
}

// Theme
function themeClick() {
  if (dom.theme_text.innerHTML == 'Dark') {
    dom.theme_text.innerHTML = 'Light'
    document.documentElement.classList.remove("dark")
    document.documentElement.classList.add("light")
    document.documentElement.setAttribute('data-bs-theme', 'light')
    window.localStorage.setItem('mode', 'light')
    dom.comic_img.src = "assets/comic.png"
    qr.set({foreground: '#212529'});
    const mq = getModalQr();
    if (mq) mq.set({foreground: '#0f172a'});
    const irq = getInlineRoomQr();
    if (irq) irq.set({foreground: '#0f172a'});
  }
  else if (dom.theme_text.innerHTML == 'Light') {
    dom.theme_text.innerHTML = 'Dark'
    document.documentElement.classList.remove("light")
    document.documentElement.classList.add("dark")
    document.documentElement.setAttribute('data-bs-theme', 'dark')
    window.localStorage.setItem('mode', 'dark')
    dom.comic_img.src = "assets/comic-dark.png"
    qr.set({foreground: '#adb5db'});
    const mq = getModalQr();
    if (mq) mq.set({foreground: '#080b11'});
    const irq = getInlineRoomQr();
    if (irq) irq.set({foreground: '#080b11'});
  }
}

// About
function aboutClick() {
  if (dom.about_text.innerHTML == 'About') {
    dom.transfer_div.style.display = 'none'
    dom.about_div.style.display = 'block'
    dom.about_text.innerHTML = 'Go back'
  }
  else {
    dom.about_div.style.display = 'none'
    dom.about_text.innerHTML = 'About'
    dom.transfer_div.style.display = 'block'
  }
}

function addPassword() {
  const modal = new bootstrap.Modal(dom.password_modal)
  modal.show()
}

// Show / Hide password
function togglePasswordVisibility(input_name, button_show_name, button_hide_name) {
  var password_input = document.getElementById(input_name)
  var password_button_show = document.getElementById(button_show_name)
  var password_button_hide = document.getElementById(button_hide_name)
  if (password_input.type === "password") {
    password_input.type = "text"
    password_button_show.style.display = 'block'
    password_button_hide.style.display = 'none'
  } else {
    password_input.type = "password"
    password_button_show.style.display = 'none'
    password_button_hide.style.display = 'block'
  }
  password_input.focus()
}

// Confirm change password
function addPasswordSubmit() {
  user.password = dom.password_modal_value.value.trim()
  const modal = bootstrap.Modal.getInstance(dom.password_modal);
  modal.hide()
  dom.transfer_status_protected.style.display = user.password.length == 0 ? 'none' : 'inline-block'
  showToast(user.password.length == 0 ? 'Password removed.' : 'Password set.')
}

function connectWithPassword() {
  if (dom.password_input.value.trim().length == 0) {
    dom.password_error.style.display = 'block'
  }
  else {
    user.password = dom.password_input.value
    dom.password_error.style.display = 'none'
    dom.password_submit.setAttribute("disabled", "")
    dom.password_loading.style.display = 'inline-block'
    user.connect(room_id).catch((err) => {
      // Connection couldn't even be opened (host gone, ICE failure). Re-enable the
      // submit button so the user can retry or change room.
      console.warn('Password retry failed to connect:', err);
      dom.password_submit.removeAttribute("disabled")
      dom.password_loading.style.display = 'none'
      dom.password_error.style.display = 'block'
    })
  }
}

// Change name
function changeName() {
  dom.name_modal_value.value = ''

  const modal = new bootstrap.Modal(dom.name_modal)
  modal.show()
}

function changeNameSubmit() {
  // Update name
  const newName = dom.name_modal_value.value.trim();
  user.changeName(newName);
  const hostAvatar = document.getElementById('transfer-users-list-host-avatar');
  if (hostAvatar) hostAvatar.innerHTML = getIdenticonSVG(user.name, 18);
}

// Copy Room url
function copyURL() {
  const url = dom.transfer_url_value.textContent;
  if (navigator.clipboard && window.isSecureContext) {
    // Secure context (HTTPS)
    navigator.clipboard.writeText(url)
  }
  else {
    // Fallback for HTTP
    const textarea = document.createElement("textarea");
    textarea.value = url;
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  showToast("URL copied.")
  dom.transfer_url_copy.style.display = 'none'
  dom.transfer_url_success.style.display = 'flex'

  setTimeout(() => {
    dom.transfer_url_success.style.display = 'none'
    dom.transfer_url_copy.style.display = 'flex'
  }, 1000)
}

// Dynamic status for connecting div
function updateConnectStatus(title, desc) {
  if (dom.connect_status_title) dom.connect_status_title.textContent = title;
  if (dom.connect_status_desc) dom.connect_status_desc.textContent = desc;
}

// Copy Quick 6-Digit Room Code
function copyRoomCode() {
  const code = user?.code || dom.room_code_val?.textContent.replace(/\s+/g, '');
  if (!code || code === '······' || code === '--- ---') return;
  const formatted = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3, 6)}` : code;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(formatted);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = formatted;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  showToast("Quick Code copied.");
  if (dom.room_code_copy_btn && dom.room_code_copied_btn) {
    dom.room_code_copy_btn.style.display = 'none';
    dom.room_code_copied_btn.style.display = 'inline-flex';
    setTimeout(() => {
      dom.room_code_copied_btn.style.display = 'none';
      dom.room_code_copy_btn.style.display = 'inline-flex';
    }, 1000);
  }
}

// Local Network Auto-Discovery (AirDrop style)
async function checkAndDisplayNearbyRooms() {
  try {
    const res = await fetch('/api/rooms/nearby');
    if (!res.ok) return;
    const rooms = await res.json();
    const roomsList = Array.isArray(rooms) ? rooms : (rooms?.nearby_rooms || []);
    if (roomsList.length === 0) return;

    // Filter out our own room
    const availableRooms = roomsList.filter(r => (r.peer_id || r.host_id) !== user?.id && r.code !== user?.code);
    if (availableRooms.length === 0) return;

    if (dom.join_nearby_badge) {
      dom.join_nearby_badge.textContent = availableRooms.length;
      dom.join_nearby_badge.style.display = 'inline-block';
    }
    if (dom.mode_nearby_badge) {
      dom.mode_nearby_badge.textContent = availableRooms.length;
      dom.mode_nearby_badge.style.display = 'inline-block';
    }
    if (dom.header_nearby_count) {
      dom.header_nearby_count.style.display = 'inline-block';
    }

    if (dom.nearby_banner) {
      const first = availableRooms[0];
      if (dom.nearby_banner_desc) {
        if (availableRooms.length === 1) {
          dom.nearby_banner_desc.textContent = `${first.name} is sharing files on your Wi-Fi (Code: ${first.formatted_code})`;
        } else {
          dom.nearby_banner_desc.textContent = `${availableRooms.length} devices are sharing files on your local Wi-Fi`;
        }
      }
      if (dom.nearby_banner_join) {
        dom.nearby_banner_join.onclick = () => {
          const targetId = first.peer_id || first.host_id || first.room_id;
          if (availableRooms.length === 1 && targetId) {
            window.location.href = `/${targetId}`;
          } else {
            openJoinModal('nearby');
          }
        };
      }
    }
  } catch (err) {
    console.warn('Nearby rooms check failed:', err);
  }
}

// Action mode switcher: Share Files vs Join Room
function switchMainMode(mode) {
  if (mode === 'join') {
    if (dom.transfer_div) dom.transfer_div.style.display = 'none';
    if (dom.join_view) dom.join_view.style.display = 'block';
    dom.mode_join_btn?.classList.add('active');
    dom.mode_share_btn?.classList.remove('active');
    switchJoinTab('code');
  } else {
    if (dom.join_view) dom.join_view.style.display = 'none';
    if (dom.transfer_div) dom.transfer_div.style.display = 'block';
    dom.mode_share_btn?.classList.add('active');
    dom.mode_join_btn?.classList.remove('active');
  }
}

// Room Connect Hub tabs
function switchRoomHubTab(tab) {
  const tabs = [
    { name: 'code', btn: dom.room_tab_code_btn, pane: dom.room_panel_code },
    { name: 'qr', btn: dom.room_tab_qr_btn, pane: dom.room_panel_qr },
    { name: 'security', btn: dom.room_tab_security_btn, pane: dom.room_panel_security },
  ];
  tabs.forEach(t => {
    if (t.name === tab) {
      t.btn?.classList.add('active');
      if (t.pane) t.pane.style.display = 'block';
    } else {
      t.btn?.classList.remove('active');
      if (t.pane) t.pane.style.display = 'none';
    }
  });
  if (tab === 'qr') {
    const url = dom.transfer_url_value?.textContent || window.location.href;
    updateQRCodes(url);
  }
}

// Room inline password save
function saveRoomPassword() {
  const pwd = dom.room_password_input?.value.trim() || '';
  user.password = pwd;
  if (dom.transfer_status_protected) {
    dom.transfer_status_protected.style.display = pwd.length > 0 ? 'inline-block' : 'none';
  }
  showToast(pwd.length > 0 ? 'Room password protected.' : 'Password removed.');
}

// Inline host name editing
function initInlineNameEditor() {
  const showEdit = () => {
    if (!dom.host_name_edit_wrap || !dom.host_name_display_wrap) return;
    if (dom.host_name_input) dom.host_name_input.value = user?.name || '';
    dom.host_name_display_wrap.classList.replace('d-inline-flex', 'd-none');
    dom.host_name_edit_wrap.classList.replace('d-none', 'd-inline-flex');
    dom.host_name_input?.focus();
    dom.host_name_input?.select();
  };

  const hideEdit = () => {
    if (!dom.host_name_edit_wrap || !dom.host_name_display_wrap) return;
    dom.host_name_edit_wrap.classList.replace('d-inline-flex', 'd-none');
    dom.host_name_display_wrap.classList.replace('d-none', 'd-inline-flex');
  };

  const saveEdit = () => {
    const newName = dom.host_name_input?.value.trim();
    if (newName && user) {
      user.changeName(newName);
      const hostAvatar = document.getElementById('transfer-users-list-host-avatar');
      if (hostAvatar) hostAvatar.innerHTML = getIdenticonSVG(user.name, 18);
    }
    hideEdit();
  };

  dom.host_name_edit_btn?.addEventListener('click', (e) => { e.stopPropagation(); showEdit(); });
  dom.transfer_users_list_host_name?.addEventListener('click', showEdit);
  dom.host_name_save_btn?.addEventListener('click', (e) => { e.stopPropagation(); saveEdit(); });
  dom.host_name_cancel_btn?.addEventListener('click', (e) => { e.stopPropagation(); hideEdit(); });
  dom.host_name_input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') hideEdit();
  });
}

// Settings menu dropdown
function initSettingsMenu() {
  if (!dom.settings_menu_btn || !dom.settings_menu) return;

  const toggleMenu = (e) => {
    e?.stopPropagation();
    const isHidden = dom.settings_menu.style.display === 'none' || !dom.settings_menu.style.display;
    dom.settings_menu.style.display = isHidden ? 'block' : 'none';
    dom.settings_menu_btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
  };

  const closeMenu = () => {
    dom.settings_menu.style.display = 'none';
    dom.settings_menu_btn.setAttribute('aria-expanded', 'false');
  };

  dom.settings_menu_btn.addEventListener('click', toggleMenu);

  document.addEventListener('click', (e) => {
    if (!dom.settings_menu.contains(e.target) && e.target !== dom.settings_menu_btn && !dom.settings_menu_btn.contains(e.target)) {
      closeMenu();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.settings_menu.style.display === 'block') {
      closeMenu();
    }
  });
}

// Join Room Modal logic
let scannerStream = null;
let scannerAnimationId = null;

function openJoinModal(tab = 'code') {
  if (dom.join_view) {
    switchMainMode('join');
    switchJoinTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (!dom.join_modal || typeof bootstrap === 'undefined') return;
  const modal = bootstrap.Modal.getOrCreateInstance(dom.join_modal);
  switchJoinTab(tab);
  modal.show();
}

function switchJoinTab(tab) {
  if (tab !== 'scanner') {
    stopScanner();
  }

  const tabs = [
    { name: 'code', btn: dom.join_tab_code, pane: dom.join_panel_code },
    { name: 'nearby', btn: dom.join_tab_nearby, pane: dom.join_panel_nearby },
    { name: 'scanner', btn: dom.join_tab_scanner, pane: dom.join_panel_scanner },
  ];

  tabs.forEach(t => {
    if (t.name === tab) {
      t.btn?.classList.add('active');
      if (t.pane) t.pane.style.display = 'block';
    } else {
      t.btn?.classList.remove('active');
      if (t.pane) t.pane.style.display = 'none';
    }
  });

  if (tab === 'nearby') {
    renderNearbyList();
  } else if (tab === 'scanner') {
    startScanner();
  } else if (tab === 'code') {
    setTimeout(() => {
      const firstDigit = document.querySelector('.digit-box');
      firstDigit?.focus?.();
    }, 50);
  }
}

async function renderNearbyList() {
  if (!dom.join_nearby_list) return;
  dom.join_nearby_list.innerHTML = `
    <div class="nearby-empty-state">
      <div class="spinner-border text-primary spinner-border-sm mb-2" role="status"></div>
      <p style="margin: 0; color: var(--text-secondary);">Scanning local network...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/rooms/nearby');
    if (!res.ok) throw new Error('API error');
    const raw = await res.json();
    const roomsList = Array.isArray(raw) ? raw : (raw?.nearby_rooms || []);
    const available = roomsList.filter(r => (r.peer_id || r.host_id) !== user?.id && r.code !== user?.code);

    if (dom.join_nearby_badge) {
      dom.join_nearby_badge.textContent = available.length;
      dom.join_nearby_badge.style.display = available.length > 0 ? 'inline-block' : 'none';
    }

    if (available.length === 0) {
      dom.join_nearby_list.innerHTML = `
        <div class="nearby-empty-state">
          <span class="nearby-pulse-radar" style="position: relative; display: inline-block; margin-bottom: 12px; width: 32px; height: 32px;"></span>
          <p style="margin: 0; font-weight: 500; color: var(--text-primary);">No nearby devices found</p>
          <p style="margin: 4px 0 0; font-size: 0.8rem; color: var(--text-secondary);">Make sure the other device is on the same Wi-Fi with AirRelay open.</p>
        </div>
      `;
      return;
    }

    dom.join_nearby_list.innerHTML = available.map(r => {
      const targetId = r.peer_id || r.host_id || r.room_id;
      return `
      <div class="nearby-device-card">
        <div class="nearby-device-info">
          <div class="nearby-device-avatar">
            ${getOSIconSVG(r.os, 18)}
          </div>
          <div class="nearby-device-details">
            <span class="nearby-device-name">${escapeHTML(r.name)}</span>
            <span class="nearby-device-meta">Code: ${escapeHTML(r.formatted_code)}</span>
          </div>
        </div>
        <button class="btn-primary-pill btn-sm nearby-connect-btn" data-peer="${escapeHTML(targetId)}" type="button">
          <span>Connect ⚡</span>
        </button>
      </div>
    `;
    }).join('');

    dom.join_nearby_list.querySelectorAll('.nearby-connect-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const peer = btn.getAttribute('data-peer');
        if (peer) {
          const modal = bootstrap.Modal.getInstance(dom.join_modal);
          modal?.hide?.();
          window.location.href = `/${peer}`;
        }
      });
    });
  } catch {
    dom.join_nearby_list.innerHTML = `
      <div class="nearby-empty-state">
        <p style="margin: 0; color: var(--status-danger);">Failed to scan local network.</p>
      </div>
    `;
  }
}

async function submitJoinCode(query) {
  if (!query || query.trim().length === 0) return;
  const clean = query.trim();

  if (dom.join_error_msg) dom.join_error_msg.style.display = 'none';
  if (dom.join_loading) dom.join_loading.style.display = 'block';

  try {
    const res = await fetch(`/api/rooms/resolve/${encodeURIComponent(clean)}`);
    if (!res.ok) throw new Error('Not found');
    const data = await res.json();
    if (!data || data.found === false) {
      throw new Error('Room not found');
    }
    const targetPeer = data.peer_id || data.host_id || data.room_id;
    if (targetPeer) {
      const modal = bootstrap.Modal.getInstance(dom.join_modal);
      modal?.hide?.();
      window.location.href = `/${targetPeer}`;
      return;
    }
    throw new Error('No target peer');
  } catch {
    if (dom.join_loading) dom.join_loading.style.display = 'none';
    if (dom.join_error_msg) {
      dom.join_error_msg.textContent = 'No active room found with this code or link. Please check and try again.';
      dom.join_error_msg.style.display = 'block';
    }
  }
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function startScanner() {
  if (!dom.join_scanner_video) return;
  if (dom.join_scanner_status) {
    dom.join_scanner_status.textContent = 'Starting camera...';
  }

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    dom.join_scanner_video.srcObject = scannerStream;
    await dom.join_scanner_video.play();
    if (dom.join_scanner_status) {
      dom.join_scanner_status.textContent = 'Point camera at AirRelay QR code';
    }

    if ('BarcodeDetector' in window) {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const scanLoop = async () => {
        if (!scannerStream) return;
        try {
          if (dom.join_scanner_video.readyState >= 2) {
            const codes = await detector.detect(dom.join_scanner_video);
            if (codes && codes.length > 0) {
              const rawVal = codes[0].rawValue;
              stopScanner();
              submitJoinCode(rawVal);
              return;
            }
          }
        } catch {}
        scannerAnimationId = requestAnimationFrame(scanLoop);
      };
      scannerAnimationId = requestAnimationFrame(scanLoop);
    } else {
      if (dom.join_scanner_status) {
        dom.join_scanner_status.textContent = 'Camera active. Point at QR code or enter Quick Code.';
      }
    }
  } catch (err) {
    console.warn('Camera access error:', err);
    if (dom.join_scanner_status) {
      dom.join_scanner_status.textContent = 'Camera access denied or unavailable.';
    }
  }
}

function stopScanner() {
  if (scannerAnimationId) {
    cancelAnimationFrame(scannerAnimationId);
    scannerAnimationId = null;
  }
  if (scannerStream) {
    scannerStream.getTracks().forEach(track => track.stop());
    scannerStream = null;
  }
  if (dom.join_scanner_video) {
    dom.join_scanner_video.srcObject = null;
  }
}

function initDigitInputs() {
  const boxes = document.querySelectorAll('.digit-box');
  if (!boxes || boxes.length === 0) return;

  boxes.forEach((box, index) => {
    box.addEventListener('input', () => {
      const val = box.value.replace(/\D/g, '');
      box.value = val ? val[val.length - 1] : '';

      if (box.value) {
        box.classList.add('filled');
        if (index < boxes.length - 1) {
          boxes[index + 1].focus();
        } else {
          const fullCode = Array.from(boxes).map(b => b.value).join('');
          if (fullCode.length === 6) {
            submitJoinCode(fullCode);
          }
        }
      } else {
        box.classList.remove('filled');
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!box.value && index > 0) {
          boxes[index - 1].focus();
          boxes[index - 1].value = '';
          boxes[index - 1].classList.remove('filled');
        } else {
          box.value = '';
          box.classList.remove('filled');
        }
      } else if (e.key === 'ArrowLeft' && index > 0) {
        boxes[index - 1].focus();
      } else if (e.key === 'ArrowRight' && index < boxes.length - 1) {
        boxes[index + 1].focus();
      } else if (e.key === 'Enter') {
        const fullCode = Array.from(boxes).map(b => b.value).join('');
        if (fullCode.length === 6) {
          submitJoinCode(fullCode);
        }
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const paste = (e.clipboardData || window.clipboardData).getData('text');
      if (!paste) return;

      const trimmed = paste.trim();
      const digitsOnly = trimmed.replace(/\D/g, '');
      if (digitsOnly.length === 6) {
        for (let i = 0; i < 6; i++) {
          boxes[i].value = digitsOnly[i];
          boxes[i].classList.add('filled');
        }
        boxes[5].focus();
        submitJoinCode(digitsOnly);
      } else {
        if (dom.join_manual_input) dom.join_manual_input.value = trimmed;
        submitJoinCode(trimmed);
      }
    });
  });
}

// Share Room via Web Share API or fallback to copyURL
async function shareRoom() {
  const url = dom.transfer_url_value?.textContent;
  if (!url) return;
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'AirRelay | Fast P2P File Transfer',
        text: 'Join my AirRelay room to transfer files directly and securely between our devices:',
        url: url,
      });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  copyURL();
}

// Open Quick QR Modal
function openQRModal() {
  const url = dom.transfer_url_value?.textContent || window.location.href;
  updateQRCodes(url);
  if (dom.qr_modal && typeof bootstrap !== 'undefined') {
    const modal = new bootstrap.Modal(dom.qr_modal);
    modal.show();
  }
}

// Check and consume files shared via Web Share Target API
async function checkSharedTargetFiles(userInstance) {
  if (typeof indexedDB === 'undefined') return;
  try {
    const req = indexedDB.open('airrelay_pwa_db', 1);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('shared_target_files')) return;
      const tx = db.transaction('shared_target_files', 'readwrite');
      const store = tx.objectStore('shared_target_files');
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const records = getAllReq.result || [];
        if (records.length > 0) {
          const files = records.map(r => r.file).filter(Boolean);
          store.clear();
          if (files.length > 0 && userInstance) {
            userInstance.addFiles(files);
            showToast(`${files.length} file${files.length > 1 ? 's' : ''} added from share target.`);
          }
        }
      };
    };
  } catch (err) {
    console.warn('Failed to check shared target files:', err);
  }
}

// PWA Install Prompt
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.getElementById('install-pwa-btn');
  if (installBtn) {
    installBtn.style.display = 'inline-flex';
    installBtn.onclick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          installBtn.style.display = 'none';
        }
        deferredPrompt = null;
      }
    };
  }
});

// Send File
function sendFiles(event) {
  user.addFiles(event.files)
}

// Download all
function downloadAll() {
  user.downloadAll()
}

// Cancel download all
function cancelDownloadAll() {
  user.downloadAllCancel()
}

// Sound Toggle
function updateSoundUI() {
  const enabled = isSoundEnabled();
  if (dom.sound_icon_on && dom.sound_icon_off) {
    dom.sound_icon_on.style.display = enabled ? 'inline-block' : 'none';
    dom.sound_icon_off.style.display = enabled ? 'none' : 'inline-block';
  }
}

function soundClick() {
  const enabled = toggleSound();
  updateSoundUI();
  showToast(enabled ? 'Audio cues enabled' : 'Audio cues muted');
}

// Checksum Copy
function copyChecksum() {
  const hash = dom.checksum_modal_hash?.textContent;
  if (!hash) return;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(hash);
  } else {
    const ta = document.createElement('textarea');
    ta.value = hash;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  showToast('Checksum copied to clipboard.');
}

// Shortcuts Modal
function openShortcutsModal() {
  if (dom.shortcuts_modal && typeof bootstrap !== 'undefined') {
    const modal = new bootstrap.Modal(dom.shortcuts_modal);
    modal.show();
  }
}

// Global Keyboard Shortcuts
function initKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

    // Cmd/Ctrl + O: Open file picker
    if ((e.metaKey || e.ctrlKey) && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      dom.transfer_select_file_input?.click();
      return;
    }

    // Cmd/Ctrl + C: Copy room link (when nothing is selected)
    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
      const sel = window.getSelection()?.toString();
      if (!sel) {
        e.preventDefault();
        copyURL();
        return;
      }
    }

    // '?' key: Open shortcuts cheatsheet modal
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      openShortcutsModal();
      return;
    }

    // 'q' or 'Q': Open QR code modal
    if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      openQRModal();
      return;
    }

    // 'j' or 'J': Open Join Room modal
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      openJoinModal('code');
      return;
    }
  });
}

// Bind all event handlers. The CSP forbids inline handlers (script-src 'self'),
// so every element that used onclick/onkeypress/onchange in index.html is wired
// up here instead.
function bindUI() {
  const on = (id, event, fn) => document.getElementById(id)?.addEventListener(event, fn);
  const onEnter = (id, fn) => on(id, 'keydown', (e) => { if (e.key === 'Enter') fn(); });

  // Settings dropdown menu
  initSettingsMenu();

  // Inline host name editing
  initInlineNameEditor();

  // Mode switcher (Share Files vs Join Room)
  on('mode-share-btn', 'click', () => switchMainMode('share'));
  on('mode-join-btn', 'click', () => switchMainMode('join'));
  on('join-view-close', 'click', () => switchMainMode('share'));

  // Room Connect Hub tabs
  on('room-tab-code-btn', 'click', () => switchRoomHubTab('code'));
  on('room-tab-qr-btn', 'click', () => switchRoomHubTab('qr'));
  on('room-tab-security-btn', 'click', () => switchRoomHubTab('security'));
  on('room-password-save-btn', 'click', saveRoomPassword);
  onEnter('room-password-input', saveRoomPassword);

  on('theme-text', 'click', themeClick);
  on('theme-toggle-btn', 'click', themeClick);
  on('about-text', 'click', aboutClick);
  on('about-btn', 'click', aboutClick);
  on('header-logo', 'click', () => { window.location.href = '/' });
  on('join-room-btn', 'click', () => openJoinModal('code'));
  onEnter('password-input', connectWithPassword);
  on('password-input-toggle', 'click', () => togglePasswordVisibility('password-input', 'password-show', 'password-hide'));
  on('password-submit', 'click', connectWithPassword);
  on('transfer-url-row', 'click', copyURL);
  on('room-code-badge', 'click', copyRoomCode);
  on('room-code-copy-btn', 'click', (e) => { e.stopPropagation(); copyRoomCode(); });
  on('nearby-banner-dismiss', 'click', () => { if (dom.nearby_banner) dom.nearby_banner.style.display = 'none'; });
  on('connect-cancel-btn', 'click', () => { window.location.href = '/'; });
  on('transfer-share-btn', 'click', shareRoom);
  on('transfer-qr-btn', 'click', openQRModal);
  on('transfer-qr-code', 'click', openQRModal);
  on('sound-toggle-btn', 'click', soundClick);
  on('shortcuts-btn', 'click', openShortcutsModal);
  on('checksum-modal-copy', 'click', copyChecksum);
  on('transfer-select-file', 'click', (e) => {
    e.stopPropagation();
    dom.transfer_select_file_input?.click();
  });
  on('dropzone', 'click', (e) => {
    if (e.target !== dom.transfer_select_file && !dom.transfer_select_file?.contains(e.target)) {
      dom.transfer_select_file_input?.click();
    }
  });
  on('transfer-select-file-input', 'change', (e) => sendFiles(e.target));
  on('transfer-add-password-btn', 'click', addPassword);
  on('transfer-users-change-name', 'click', changeName);
  on('transfer-files-download', 'click', downloadAll);
  onEnter('password-modal-value', addPasswordSubmit);
  on('password-modal-toggle', 'click', () => togglePasswordVisibility('password-modal-value', 'password-button-show', 'password-button-hide'));
  on('password-modal-confirm', 'click', addPasswordSubmit);
  onEnter('name-modal-value', changeNameSubmit);
  on('name-modal-confirm', 'click', changeNameSubmit);
  on('download-modal-cancel', 'click', cancelDownloadAll);

  // Join Room modal controls
  on('join-tab-code', 'click', () => switchJoinTab('code'));
  on('join-tab-nearby', 'click', () => switchJoinTab('nearby'));
  on('join-tab-scanner', 'click', () => switchJoinTab('scanner'));
  on('join-nearby-refresh', 'click', renderNearbyList);
  on('join-manual-btn', 'click', () => submitJoinCode(dom.join_manual_input?.value));
  onEnter('join-manual-input', () => submitJoinCode(dom.join_manual_input?.value));
  dom.join_modal?.addEventListener?.('hidden.bs.modal', stopScanner);

  initDigitInputs();
  updateSoundUI();
  initKeyboardShortcuts();
}

// Drag and Drop on dropzone, transfer-div, and full-window frosted overlay
function initDropZone() {
  const transferDiv = document.getElementById('transfer-div');
  const dropzoneEl = document.getElementById('dropzone');
  const dragOverlay = document.getElementById('drag-overlay');

  // Prevent browser default drag behavior globally
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragOverlay) dragOverlay.style.display = 'flex';
    dropzoneEl?.classList.add('drag-over');
    transferDiv?.classList.add('drag-over');
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (dragOverlay) dragOverlay.style.display = 'none';
      dropzoneEl?.classList.remove('drag-over');
      transferDiv?.classList.remove('drag-over');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (dragOverlay) dragOverlay.style.display = 'none';
    dropzoneEl?.classList.remove('drag-over');
    transferDiv?.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0 && user) {
      user.addFiles(files);
    }
  });
}

// Function to generate a random string in the format XXX-XXXX-XXX.
function generateRoomID() {
  const length = 10
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const random = crypto.getRandomValues(new Uint8Array(length));
  let room_id = "";
  for (let i = 0; i < length; i++) {
    room_id += alphabet[random[i] % alphabet.length];
  }
  return `${room_id.slice(0, 3)}-${room_id.slice(3, 7)}-${room_id.slice(7, 10)}`;
}

function maybeShowInsecureContextWarning() {
  // Only warn when the auto path will land on Blob — i.e., not secure, not localhost.
  // Forced overrides skip the warning (developer knows what they're doing).
  if (sinkState.forced) return;
  if (activeMode() !== 'blob') return;
  if (window.isSecureContext) return;

  const banner = document.createElement('div');
  banner.id = 'insecure-context-banner';
  banner.innerHTML = `
    <strong>Heads-up:</strong> AirRelay is running over plain HTTP, so large transfers may fail.
    For files over 500&nbsp;MB, please deploy AirRelay with HTTPS.
    <span id="insecure-context-banner-close" style="margin-left:10px; cursor:pointer; font-weight:bold;">×</span>
  `;
  Object.assign(banner.style, {
    position: 'fixed', top: '0', left: '0', right: '0',
    padding: '10px 16px',
    backgroundColor: 'rgba(255, 193, 7, 0.95)',
    color: '#212529',
    fontSize: '14px', textAlign: 'center',
    zIndex: '9999',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  });
  document.body.appendChild(banner);
  // The banner is position:fixed, so push the page content down to leave a gap
  // between the banner and the UI instead of covering it.
  document.body.style.paddingTop = `${banner.offsetHeight}px`;
  document.getElementById('insecure-context-banner-close').onclick = () => {
    banner.remove();
    document.body.style.paddingTop = '';
  };
}

// On document loaded, execute onLoad() method.
(() => {
  bindUI()
  onLoad()
  initDropZone()
})();