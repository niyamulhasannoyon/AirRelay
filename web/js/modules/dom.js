export const dom = {
  // TOP BAR
  theme_text: document.getElementById('theme-text'),
  about_text: document.getElementById('about-text'),
  join_room_btn: document.getElementById('join-room-btn'),
  settings_menu_btn: document.getElementById('settings-menu-btn'),
  settings_menu: document.getElementById('settings-menu'),
  header_nearby_count: document.getElementById('header-nearby-count'),

  // ACTION MODE SWITCHER
  action_mode_nav: document.getElementById('action-mode-nav'),
  mode_share_btn: document.getElementById('mode-share-btn'),
  mode_join_btn: document.getElementById('mode-join-btn'),
  mode_nearby_badge: document.getElementById('mode-nearby-badge'),

  // UNIFIED JOIN VIEW
  join_view: document.getElementById('join-view'),
  join_view_close: document.getElementById('join-view-close'),

  // ROOM CONNECT HUB TABS & PANELS
  room_tab_code_btn: document.getElementById('room-tab-code-btn'),
  room_tab_qr_btn: document.getElementById('room-tab-qr-btn'),
  room_tab_security_btn: document.getElementById('room-tab-security-btn'),
  room_panel_code: document.getElementById('room-panel-code'),
  room_panel_qr: document.getElementById('room-panel-qr'),
  room_panel_security: document.getElementById('room-panel-security'),
  room_qr_canvas: document.getElementById('room-qr-canvas'),
  room_password_input: document.getElementById('room-password-input'),
  room_password_save_btn: document.getElementById('room-password-save-btn'),

  // INLINE HOST NAME EDITING
  host_name_display_wrap: document.getElementById('host-name-display-wrap'),
  host_name_edit_wrap: document.getElementById('host-name-edit-wrap'),
  host_name_edit_btn: document.getElementById('host-name-edit-btn'),
  host_name_input: document.getElementById('host-name-input'),
  host_name_save_btn: document.getElementById('host-name-save-btn'),
  host_name_cancel_btn: document.getElementById('host-name-cancel-btn'),

  // NEARBY DISCOVERY BANNER
  nearby_banner: document.getElementById('nearby-banner'),
  nearby_banner_desc: document.getElementById('nearby-banner-desc'),
  nearby_banner_join: document.getElementById('nearby-banner-join'),
  nearby_banner_dismiss: document.getElementById('nearby-banner-dismiss'),

  // ABOUT
  about_div: document.getElementById('about-div'),
  comic_img: document.getElementById('comic-img'),

  // ERROR
  error_div: document.getElementById('error-div'),
  error_message: document.getElementById('error-message'),

  // PASSWORD
  password_div: document.getElementById('password-div'),
  password_alert: document.getElementById('password-alert'),
  password_input: document.getElementById('password-input'),
  password_hide: document.getElementById('password-hide'),
  password_show: document.getElementById('password-show'),
  password_error: document.getElementById('password-error'),
  password_submit: document.getElementById('password-submit'),
  password_loading: document.getElementById('password-loading'),

  // CONNECT
  connect_div: document.getElementById('connect-div'),
  connect_spinner: document.getElementById('connect-spinner'),
  connect_status_icon_declined: document.getElementById('connect-status-icon-declined'),
  connect_status_badge_wrap: document.getElementById('connect-status-badge-wrap'),
  connect_status_badge: document.getElementById('connect-status-badge'),
  connect_status_title: document.getElementById('connect-status-title'),
  connect_status_desc: document.getElementById('connect-status-desc'),
  connect_cancel_btn: document.getElementById('connect-cancel-btn'),
  connect_retry_btn: document.getElementById('connect-retry-btn'),

  // TRANSFER
  transfer_div: document.getElementById('transfer-div'),
  connected_summary_bar: document.getElementById('connected-summary-bar'),
  connected_peers_tags: document.getElementById('connected-peers-tags'),
  toggle_room_details_btn: document.getElementById('toggle-room-details-btn'),
  toggle_room_details_text: document.getElementById('toggle-room-details-text'),
  toggle_room_details_chevron: document.getElementById('toggle-room-details-chevron'),
  connection_details_panel: document.getElementById('connection-details-panel'),
  hero_section: document.getElementById('hero-section'),

  // FILES FILTER BAR
  filter_tab_all: document.getElementById('filter-tab-all'),
  filter_tab_sent: document.getElementById('filter-tab-sent'),
  filter_tab_received: document.getElementById('filter-tab-received'),
  filter_count_all: document.getElementById('filter-count-all'),
  filter_count_sent: document.getElementById('filter-count-sent'),
  filter_count_received: document.getElementById('filter-count-received'),

  transfer_qr_code: document.getElementById('transfer-qr-code'),
  transfer_status_protected: document.getElementById('transfer-status-protected'),
  transfer_status_wait: document.getElementById('transfer-status-wait'),
  transfer_status_success: document.getElementById('transfer-status-success'),

  room_code_badge: document.getElementById('room-code-badge'),
  room_code_val: document.getElementById('room-code-val'),
  room_code_copy_btn: document.getElementById('room-code-copy-btn'),
  room_code_copied_btn: document.getElementById('room-code-copied-btn'),

  transfer_url_value: document.getElementById('transfer-url-value'),
  transfer_url_copy: document.getElementById('transfer-url-copy'),
  transfer_url_success: document.getElementById('transfer-url-success'),

  transfer_select_file: document.getElementById('transfer-select-file'),
  transfer_select_file_input: document.getElementById('transfer-select-file-input'),
  transfer_add_password: document.getElementById('transfer-add-password'),
  transfer_share_btn: document.getElementById('transfer-share-btn'),
  transfer_qr_btn: document.getElementById('transfer-qr-btn'),
  dropzone: document.getElementById('dropzone'),

  transfer_users_div: document.getElementById('transfer-users-div'),
  transfer_users_count: document.getElementById('transfer-users-count'),
  transfer_users_list: document.getElementById('transfer-users-list'),
  transfer_users_list_host: document.getElementById('transfer-users-list-host'),
  transfer_users_list_host_os: document.getElementById('transfer-users-list-host-os'),
  transfer_users_list_host_name: document.getElementById('transfer-users-list-host-name'),

  transfer_files_div: document.getElementById('transfer-files-div'),
  transfer_files_count: document.getElementById('transfer-files-count'),
  transfer_files_download: document.getElementById('transfer-files-download'),
  transfer_files_list: document.getElementById('transfer-files-list'),
  transfer_files_list_empty: document.getElementById('transfer-files-list-empty'),

  // PASSWORD MODAL
  password_modal: document.getElementById('password-modal'),
  password_modal_value: document.getElementById('password-modal-value'),

  // QR MODAL
  qr_modal: document.getElementById('qr-modal'),
  qr_modal_canvas: document.getElementById('qr-modal-canvas'),
  qr_modal_code_wrap: document.getElementById('qr-modal-code-wrap'),
  qr_modal_code_val: document.getElementById('qr-modal-code-val'),

  // JOIN ROOM MODAL
  join_modal: document.getElementById('join-modal'),
  join_tab_code: document.getElementById('join-tab-code'),
  join_tab_nearby: document.getElementById('join-tab-nearby'),
  join_tab_scanner: document.getElementById('join-tab-scanner'),
  join_panel_code: document.getElementById('join-panel-code'),
  join_panel_nearby: document.getElementById('join-panel-nearby'),
  join_panel_scanner: document.getElementById('join-panel-scanner'),
  join_nearby_badge: document.getElementById('join-nearby-badge'),
  join_nearby_list: document.getElementById('join-nearby-list'),
  join_nearby_refresh: document.getElementById('join-nearby-refresh'),
  join_manual_input: document.getElementById('join-manual-input'),
  join_manual_btn: document.getElementById('join-manual-btn'),
  join_error_msg: document.getElementById('join-error-msg'),
  join_loading: document.getElementById('join-loading'),
  join_scanner_video: document.getElementById('join-scanner-video'),
  join_scanner_status: document.getElementById('join-scanner-status'),

  // NAME MODAL
  name_modal: document.getElementById('name-modal'),
  name_modal_value: document.getElementById('name-modal-value'),

  // FILE MODAL
  file_modal: document.getElementById('file-modal'),
  file_modal_table: document.getElementById('file-modal-table'),
  file_modal_table_empty: document.getElementById('file-modal-table-empty'),
  file_modal_refresh: document.getElementById('file-modal-refresh'),

  // DOWNLOAD MODAL
  download_modal: document.getElementById('download-modal'),
  download_modal_value: document.getElementById('download-modal-value'),
  download_modal_active: document.getElementById('download-modal-active'),
  download_modal_success: document.getElementById('download-modal-success'),
  download_modal_error: document.getElementById('download-modal-error'),
  download_modal_cancel: document.getElementById('download-modal-cancel'),
  download_modal_cancel_spinner: document.getElementById('download-modal-cancel-spinner'),
  download_modal_close: document.getElementById('download-modal-close'),

  // SOUND & SHORTCUTS
  sound_toggle_btn: document.getElementById('sound-toggle-btn'),
  sound_icon_on: document.getElementById('sound-icon-on'),
  sound_icon_off: document.getElementById('sound-icon-off'),
  shortcuts_btn: document.getElementById('shortcuts-btn'),
  shortcuts_modal: document.getElementById('shortcuts-modal'),

  // CHECKSUM & INTEGRITY MODAL
  checksum_modal: document.getElementById('checksum-modal'),
  checksum_modal_hash: document.getElementById('checksum-modal-hash'),
  checksum_modal_copy: document.getElementById('checksum-modal-copy'),
  checksum_modal_filename: document.getElementById('checksum-modal-filename'),

  // NETWORK DIAGNOSTICS MODAL
  diagnostics_modal: document.getElementById('diagnostics-modal'),
  diagnostics_modal_content: document.getElementById('diagnostics-modal-content'),

  // DRAG OVERLAY
  drag_overlay: document.getElementById('drag-overlay'),

  // CONNECTION APPROVAL MODAL
  approval_modal: document.getElementById('approval-modal'),
  approval_peer_name: document.getElementById('approval-peer-name'),
  approval_peer_details: document.getElementById('approval-peer-details'),
  approval_peer_os: document.getElementById('approval-peer-os'),
  approval_peer_avatar: document.getElementById('approval-peer-avatar'),
  approval_accept_btn: document.getElementById('approval-accept-btn'),
  approval_reject_btn: document.getElementById('approval-reject-btn'),

  // LIGHTBOX / UNIVERSAL MEDIA VIEWER MODAL
  lightbox_modal: document.getElementById('lightbox-modal'),
  lightbox_badge: document.getElementById('lightbox-badge'),
  lightbox_image: document.getElementById('lightbox-image'),
  lightbox_caption: document.getElementById('lightbox-caption'),
  lightbox_size_pill: document.getElementById('lightbox-size-pill'),
  lightbox_download: document.getElementById('lightbox-download'),
  lightbox_loading: document.getElementById('lightbox-loading'),
  lightbox_image_wrap: document.getElementById('lightbox-image-wrap'),
  lightbox_video_wrap: document.getElementById('lightbox-video-wrap'),
  lightbox_video: document.getElementById('lightbox-video'),
  lightbox_audio_wrap: document.getElementById('lightbox-audio-wrap'),
  lightbox_audio: document.getElementById('lightbox-audio'),
  lightbox_doc_wrap: document.getElementById('lightbox-doc-wrap'),
  lightbox_doc_frame: document.getElementById('lightbox-doc-frame'),
  lightbox_text_wrap: document.getElementById('lightbox-text-wrap'),
  lightbox_text_content: document.getElementById('lightbox-text-content'),
  lightbox_generic_wrap: document.getElementById('lightbox-generic-wrap'),
  lightbox_generic_name: document.getElementById('lightbox-generic-name'),
  lightbox_generic_info: document.getElementById('lightbox-generic-info'),

  // NOTIFICATION
  notification_modal: document.getElementById('notification-modal'),
  notification_modal_value: document.getElementById('notification-modal-value'),
}

// Display a confirmation dialog when the user attempts to refresh or navigate away from the page.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener("beforeunload", (event) => {
    event.preventDefault();
    event.returnValue = '';
  });
}

// Toast notification
let _toastTimeout = null;
export function showToast(message, type = 'success') {
  const toast = document.getElementById('notification-toast')
  const toastValue = document.getElementById('notification-toast-value')
  const iconSuccess = document.getElementById('notification-toast-icon-success')
  const iconWarning = document.getElementById('notification-toast-icon-warning')
  if (!toast || !toastValue) return
  toastValue.textContent = message
  // Toggle icon based on type
  if (iconSuccess && iconWarning) {
    iconSuccess.style.display = type === 'warning' ? 'none' : 'inline'
    iconWarning.style.display = type === 'warning' ? 'inline' : 'none'
  }
  // Clear any existing timeout
  if (_toastTimeout) clearTimeout(_toastTimeout)
  // Show
  toast.style.opacity = '1'
  toast.style.transform = 'translateX(-50%) translateY(0)'
  // Auto-hide after 2s
  _toastTimeout = setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateX(-50%) translateY(-100px)'
  }, 2000)
}

// Focus the password input after the fade animation
dom.password_modal?.addEventListener?.('shown.bs.modal', () => {
  dom.password_modal_value?.focus?.()
});

// Focus the name input after the fade animation
dom.name_modal?.addEventListener?.('shown.bs.modal', () => {
  dom.name_modal_value?.focus?.()
});

// Focus first digit box when join modal is shown
dom.join_modal?.addEventListener?.('shown.bs.modal', () => {
  const firstBox = document.querySelector('.digit-box');
  firstBox?.focus?.();
});