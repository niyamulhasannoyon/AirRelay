import test from 'node:test';
import assert from 'node:assert/strict';

// Browser mock setup before importing app modules
const _elements = new Map();
function makeEl(id) {
  const classes = new Set();
  let _innerHtml = '';
  const el = {
    id,
    style: {},
    textContent: '',
    get innerHTML() { return _innerHtml; },
    set innerHTML(v) {
      _innerHtml = v;
      if (v === '') el.children = [];
    },
    value: '',
    disabled: false,
    dataset: {},
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    click() {},
    remove() {},
    appendChild(child) { el.children.push(child); },
    children: [],
    setAttribute(k, v) { el[k] = v; },
    removeAttribute(k) { delete el[k]; },
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c); else classes.add(c);
        } else if (force) {
          classes.add(c);
        } else {
          classes.delete(c);
        }
      },
      contains(c) { return classes.has(c); },
    },
    querySelectorAll() { return []; },
  };
  return el;
}

globalThis.document = {
  elements: _elements,
  getElementById(id) {
    if (!_elements.has(id)) _elements.set(id, makeEl(id));
    return _elements.get(id);
  },
  createElement(tag) { return makeEl(`dyn-${tag}`); },
  body: makeEl('body'),
  addEventListener() {},
};
globalThis.window = globalThis;
globalThis.location = { search: '', href: 'http://localhost/', protocol: 'http:', origin: 'http://localhost', replace() {} };
globalThis.addEventListener = () => {};
globalThis.navigator = { serviceWorker: undefined, clipboard: undefined };

const _userUrl = new URL('../../web/js/modules/webrtc/user.js', import.meta.url);
const _sinkUrl = new URL('../../web/js/modules/sink.js', import.meta.url);
const { getFileTypeInfo, User } = await import(_userUrl.href);
const { openMemoryBlobSink } = await import(_sinkUrl.href);

test('getFileTypeInfo classifies media, documents, and code correctly', () => {
  // Photos
  const png = getFileTypeInfo('vacation_photo.png');
  assert.equal(png.category, 'image');
  assert.equal(png.type, 'image');
  assert.equal(png.label, 'IMG');

  const webp = getFileTypeInfo('banner.WEBP');
  assert.equal(webp.category, 'image');

  // Videos
  const mp4 = getFileTypeInfo('clip.mp4');
  assert.equal(mp4.category, 'video');
  assert.equal(mp4.label, 'VID');

  const mov = getFileTypeInfo('recording.MOV');
  assert.equal(mov.category, 'video');

  // Audio
  const mp3 = getFileTypeInfo('song.mp3');
  assert.equal(mp3.category, 'audio');
  assert.equal(mp3.label, 'AUD');

  // PDF
  const pdf = getFileTypeInfo('contract.pdf');
  assert.equal(pdf.category, 'pdf');
  assert.equal(pdf.label, 'PDF');

  // Code
  const js = getFileTypeInfo('app.js');
  assert.equal(js.category, 'code');
  assert.equal(js.label, 'CODE');

  // Docs
  const docx = getFileTypeInfo('report.docx');
  assert.equal(docx.category, 'doc');
  assert.equal(docx.label, 'DOC');

  // Fallback
  const unknown = getFileTypeInfo('dataset.dat');
  assert.equal(unknown.category, 'file');
  assert.equal(unknown.label, 'FILE');
});

test('openMemoryBlobSink accumulates chunks and yields a complete Blob without saving to disk', async () => {
  const sink = openMemoryBlobSink('photo.png');
  assert.equal(sink.mode, 'blob');

  const chunk1 = new Uint8Array([1, 2, 3]);
  const chunk2 = new Uint8Array([4, 5, 6, 7]);

  await sink.write(chunk1);
  await sink.write(chunk2);

  const resultBlob = await sink.close();
  assert.ok(resultBlob instanceof Blob, 'close() should resolve to a Blob');
  assert.equal(resultBlob.size, 7, 'Blob size should match total byte count');

  const buf = new Uint8Array(await resultBlob.arrayBuffer());
  assert.deepEqual(Array.from(buf), [1, 2, 3, 4, 5, 6, 7]);
});

test('User _updateConnectedUI toggles connected summary bar and room panel', () => {
  const user = new User('test-room');

  // When not connected
  user._updateConnectedUI(false);
  const connBar = document.getElementById('connected-summary-bar');
  assert.equal(connBar.style.display, 'none');

  // Simulate remote peer joined
  user._remotePeers['peer-1'] = { name: 'Alice', os: 'mac' };
  user._updateConnectedUI(true);

  assert.equal(connBar.style.display, 'flex');
  const detailsPanel = document.getElementById('connection-details-panel');
  assert.ok(detailsPanel.classList.contains('minimized'), 'Room details should auto-minimize when connected');

  // When remote peer disconnects
  delete user._remotePeers['peer-1'];
  user._updateConnectedUI(false);
  assert.equal(connBar.style.display, 'none');
  assert.equal(detailsPanel.classList.contains('minimized'), false);
});

test('User _applyFileFilters correctly filters cards by direction and category', () => {
  const user = new User('');
  user._peer = { id: 'host-123' };

  // Mock files
  user._files['f1'] = {
    id: 'f1',
    name: 'photo.jpg',
    owner_id: 'host-123',
    aborted: false,
    removed: false,
  };
  user._files['f2'] = {
    id: 'f2',
    name: 'video.mp4',
    owner_id: 'guest-456',
    aborted: false,
    removed: false,
  };
  user._files['f3'] = {
    id: 'f3',
    name: 'document.pdf',
    owner_id: 'host-123',
    aborted: false,
    removed: false,
  };

  const card1 = makeEl('file-f1');
  const card2 = makeEl('file-f2');
  const card3 = makeEl('file-f3');
  _elements.set('file-f1', card1);
  _elements.set('file-f2', card2);
  _elements.set('file-f3', card3);

  // 1. Filter: all
  user._currentFilter = 'all';
  user._currentTypeFilter = 'all';
  user._applyFileFilters();

  assert.equal(card1.style.display, 'flex');
  assert.equal(card2.style.display, 'flex');
  assert.equal(card3.style.display, 'flex');

  // 2. Filter: sent by me
  user._currentFilter = 'sent';
  user._applyFileFilters();
  assert.equal(card1.style.display, 'flex');
  assert.equal(card2.style.display, 'none');
  assert.equal(card3.style.display, 'flex');

  // 3. Filter: received
  user._currentFilter = 'received';
  user._applyFileFilters();
  assert.equal(card1.style.display, 'none');
  assert.equal(card2.style.display, 'flex');
  assert.equal(card3.style.display, 'none');

  // 4. Filter: video type
  user._currentFilter = 'all';
  user._currentTypeFilter = 'video';
  user._applyFileFilters();
  assert.equal(card1.style.display, 'none');
  assert.equal(card2.style.display, 'flex');
  assert.equal(card3.style.display, 'none');
});

test('User _renderFilePreview prioritizes thumbnail and attaches onerror fallback', () => {
  const user = new User('');
  const container = makeEl('file-img1-preview-container');
  _elements.set('file-img1-preview-container', container);

  const file = {
    id: 'img1',
    name: 'screenshot.png',
    thumbnail: 'data:image/webp;base64,AAAA',
    previewUrl: 'blob:http://localhost/test-blob',
  };

  user._renderFilePreview(file);

  assert.equal(container.children.length, 1);
  const img = container.children[0];
  assert.equal(img.src, 'data:image/webp;base64,AAAA', 'Should prioritize data URL thumbnail for grid card');
  assert.equal(typeof img.onerror, 'function', 'Should attach onerror fallback');

  // Trigger onerror when primary source fails: should switch to fallback blob previewUrl
  img.onerror();
  assert.equal(img.src, 'blob:http://localhost/test-blob', 'Should fall back to previewUrl if thumbnail fails');

  // Trigger onerror again when fallback also fails: should replace with fallback tile
  img.onerror();
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].className, 'file-grid-doc-tile');
  assert.ok(container.children[0].innerHTML.includes('file-grid-doc-icon'), 'Should render fallback tile if both sources fail');
  assert.ok(container.children[0].innerHTML.includes('.png'), 'Should render extension badge');
});

test('User _renderFilePreview directly renders fallback tile when no thumbnail or preview is present', () => {
  const user = new User('');
  const container = makeEl('file-doc1-preview-container');
  _elements.set('file-doc1-preview-container', container);

  const file = {
    id: 'doc1',
    name: 'presentation.pdf',
    thumbnail: null,
    previewUrl: null,
  };

  user._renderFilePreview(file);

  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].className, 'file-grid-doc-tile');
  assert.ok(container.children[0].innerHTML.includes('file-grid-doc-icon'));
  assert.ok(container.children[0].innerHTML.includes('.pdf'));
});

