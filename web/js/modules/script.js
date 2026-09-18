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

function updateQRCodes(url) {
  qr.set({ value: url });
  const mq = getModalQr();
  if (mq) mq.set({ value: url });
}

// Get theme mode
if (window.localStorage.getItem('mode') == 'light') {
  dom.theme_text.innerHTML = 'Light'
  dom.comic_img.src = "assets/comic.png"
  qr.set({foreground: '#212529'});
  const mq = getModalQr();
  if (mq) mq.set({foreground: '#0f172a'});
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
      await user.init(new_room_id)
      checkSharedTargetFiles(user)
    } catch (err) {
      console.warn('Host init failed:', err);
      dom.transfer_div.style.display = 'none'
      dom.connect_div.style.display = 'none'
      dom.error_div.style.display = 'block'
      dom.error_message.innerHTML = 'Could not start AirRelay. Please check your connection and refresh the page.'
      return
    }
  }
  // Peer
  else {
    // Init UI Components
    dom.connect_div.style.display = 'block'
    dom.transfer_url_value.textContent = `${window.location.origin}/${room_id}`
    updateQRCodes(dom.transfer_url_value.textContent);

    // Init peer connection. See host-path comment above — same contract.
    try {
      await user.init()
      checkSharedTargetFiles(user)
    } catch (err) {
      console.warn('Peer init failed:', err);
      dom.connect_div.style.display = 'none'
      dom.error_div.style.display = 'block'
      dom.error_message.innerHTML = 'Could not start AirRelay. Please check your connection and refresh the page.'
      return
    }

    // Connect to the room. user.connect rejects if the host is unreachable
    // (peer-unavailable, ICE failure, closed before open) — surface that as a
    // user-facing error instead of leaving the spinner up indefinitely.
    try {
      await user.connect(room_id)
    } catch (err) {
      console.warn('Failed to join room:', err);
      dom.connect_div.style.display = 'none'
      dom.error_div.style.display = 'block'
      dom.error_message.innerHTML = 'Could not reach the host. The room may no longer be active.'
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
  });
}

// Bind all event handlers. The CSP forbids inline handlers (script-src 'self'),
// so every element that used onclick/onkeypress/onchange in index.html is wired
// up here instead.
function bindUI() {
  const on = (id, event, fn) => document.getElementById(id)?.addEventListener(event, fn);
  const onEnter = (id, fn) => on(id, 'keydown', (e) => { if (e.key === 'Enter') fn(); });

  on('theme-text', 'click', themeClick);
  on('about-text', 'click', aboutClick);
  on('header-logo', 'click', () => { window.location.href = '/' });
  onEnter('password-input', connectWithPassword);
  on('password-input-toggle', 'click', () => togglePasswordVisibility('password-input', 'password-show', 'password-hide'));
  on('password-submit', 'click', connectWithPassword);
  on('transfer-url-row', 'click', copyURL);
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