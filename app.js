/**
 * image-shrinker — resize and re-encode images entirely in the browser.
 * Everything happens on the Canvas API; no file ever leaves the device.
 */

const $ = (id) => document.getElementById(id);

const els = {
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  browseBtn: $('browseBtn'),
  maxEdgeGroup: $('maxEdgeGroup'),
  formatGroup: $('formatGroup'),
  quality: $('quality'),
  qualityOut: $('qualityOut'),
  results: $('results'),
  summary: $('summary'),
  summaryStats: $('summaryStats'),
  clearBtn: $('clearBtn'),
  downloadAll: $('downloadAll'),
};

const state = {
  maxEdge: 1920,
  quality: 82,
  format: 'image/jpeg',
  files: [],
};

/** One rendered result per file in state.files. */
let items = [];
/** Guards against a stale run overwriting a newer one. */
let runId = 0;
/** Object URLs for the original thumbnails, one per File. */
const thumbs = new Map();

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function outputName(name) {
  const extension = state.format === 'image/webp' ? 'webp' : 'jpg';
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.${extension}`;
}

async function decode(file) {
  // createImageBitmap is faster and respects EXIF orientation.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to the <img> path */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('could not decode image'));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('could not encode image'))),
      type,
      quality
    );
  });
}

async function compress(file) {
  const bitmap = await decode(file);
  const sourceWidth = bitmap.width || bitmap.naturalWidth;
  const sourceHeight = bitmap.height || bitmap.naturalHeight;

  const scale =
    state.maxEdge > 0 ? Math.min(1, state.maxEdge / Math.max(sourceWidth, sourceHeight)) : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';

  // JPEG has no alpha channel: without a background, transparent PNGs go black.
  if (state.format === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === 'function') bitmap.close();

  const blob = await encode(canvas, state.format, state.quality / 100);
  return { blob, width, height, sourceWidth, sourceHeight };
}

function setBusy(busy) {
  els.downloadAll.disabled = busy;
  els.clearBtn.disabled = busy;

  if (busy && state.files.length) {
    const count = state.files.length;
    els.summary.hidden = false;
    els.summaryStats.textContent = `Compressing ${count} image${count === 1 ? '' : 's'}…`;
  }
}

async function run() {
  if (!state.files.length) {
    items = [];
    render();
    return;
  }

  const id = ++runId;
  setBusy(true);

  items.forEach((item) => item.url && URL.revokeObjectURL(item.url));
  items = [];

  const next = [];
  for (const file of state.files) {
    try {
      const result = await compress(file);
      next.push({
        file,
        ...result,
        thumb: thumbs.get(file) || null,
        url: URL.createObjectURL(result.blob),
        error: null,
      });
    } catch (error) {
      next.push({
        file,
        thumb: thumbs.get(file) || null,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // A newer run started while this one was working: discard these results.
    if (id !== runId) {
      next.forEach((item) => item.url && URL.revokeObjectURL(item.url));
      return;
    }
  }

  items = next;
  setBusy(false);
  render();
}

function buildCard(item) {
  const card = document.createElement('li');
  card.className = 'card';

  if (item.thumb) {
    const thumb = document.createElement('img');
    thumb.className = 'card__thumb';
    thumb.src = item.thumb;
    thumb.alt = '';
    thumb.loading = 'lazy';
    card.append(thumb);
  } else {
    const thumb = document.createElement('div');
    thumb.className = 'card__thumb';
    card.append(thumb);
  }

  const body = document.createElement('div');

  const name = document.createElement('div');
  name.className = 'card__name';
  name.textContent = item.error ? item.file.name : outputName(item.file.name);

  const meta = document.createElement('div');
  meta.className = 'card__meta';

  if (item.error) {
    const problem = document.createElement('span');
    problem.className = 'card__error';
    problem.textContent = `couldn't process — ${item.error}`;
    meta.append(problem);
  } else {
    const saved = item.file.size
      ? Math.round((1 - item.blob.size / item.file.size) * 100)
      : 0;

    const sizes = document.createElement('span');
    sizes.textContent = `${formatBytes(item.file.size)} → ${formatBytes(item.blob.size)}`;

    const badge = document.createElement('span');
    badge.className = saved > 0 ? 'badge' : 'badge badge--flat';
    badge.textContent = saved > 0 ? `−${saved}%` : 'no gain';

    const dims = document.createElement('span');
    dims.className = 'card__dims';
    dims.textContent = `${item.width}×${item.height}`;

    meta.append(sizes, badge, dims);
  }

  body.append(name, meta);
  card.append(body);

  if (!item.error) {
    const link = document.createElement('a');
    link.className = 'btn btn--ghost btn--sm';
    link.href = item.url;
    link.download = outputName(item.file.name);
    link.textContent = 'Download';
    card.append(link);
  }

  return card;
}

function render() {
  els.results.replaceChildren();

  if (!state.files.length) {
    els.summary.hidden = true;
    els.results.hidden = true;
    return;
  }

  els.results.hidden = false;

  let before = 0;
  let after = 0;
  let failures = 0;

  for (const item of items) {
    if (!item) continue;
    els.results.append(buildCard(item));
    if (item.error) {
      failures += 1;
    } else {
      before += item.file.size;
      after += item.blob.size;
    }
  }

  const done = items.length - failures;
  const totalSaved = before ? Math.round((1 - after / before) * 100) : 0;

  els.summary.hidden = false;
  els.summaryStats.replaceChildren();

  const strong = document.createElement('strong');
  strong.textContent = totalSaved > 0 ? `−${totalSaved}%` : 'no gain';

  els.summaryStats.append(
    document.createTextNode(
      `${done} of ${items.length} image${items.length === 1 ? '' : 's'} · ` +
        `${formatBytes(before)} → ${formatBytes(after)} · `
    ),
    strong,
    document.createTextNode(' saved')
  );
}

function addFiles(fileList) {
  const images = [...fileList].filter((file) => file.type.startsWith('image/'));
  if (!images.length) return;

  for (const file of images) {
    if (!thumbs.has(file)) thumbs.set(file, URL.createObjectURL(file));
  }

  state.files = state.files.concat(images);
  run();
}

function clearAll() {
  items.forEach((item) => item.url && URL.revokeObjectURL(item.url));
  thumbs.forEach((url) => URL.revokeObjectURL(url));
  thumbs.clear();
  items = [];
  state.files = [];
  els.fileInput.value = '';
  render();
}

/* ---------- controls ---------- */

function wireSegmented(group, key) {
  group.addEventListener('click', (event) => {
    const button = event.target.closest('.seg');
    if (!button || !group.contains(button)) return;

    for (const option of group.querySelectorAll('.seg')) {
      const on = option === button;
      option.classList.toggle('is-on', on);
      option.setAttribute('aria-checked', String(on));
    }

    const { value } = button.dataset;
    state[key] = key === 'format' ? value : Number(value);
    rerun();
  });
}

function paintQuality() {
  const min = Number(els.quality.min);
  const max = Number(els.quality.max);
  const value = Number(els.quality.value);
  const percent = ((value - min) / (max - min)) * 100;
  els.quality.style.setProperty('--fill', `${percent}%`);
  els.qualityOut.textContent = `${value}%`;
}

let pending;
function rerun() {
  clearTimeout(pending);
  setBusy(true);
  pending = setTimeout(run, 150);
}

/* ---------- events ---------- */

els.browseBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  els.fileInput.click();
});

els.dropzone.addEventListener('click', () => els.fileInput.click());

els.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    els.fileInput.click();
  }
});

els.fileInput.addEventListener('change', () => {
  addFiles(els.fileInput.files);
  els.fileInput.value = '';
});

for (const type of ['dragenter', 'dragover']) {
  els.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropzone.classList.add('is-drag');
  });
}

for (const type of ['dragleave', 'drop']) {
  els.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    if (type === 'dragleave' && els.dropzone.contains(event.relatedTarget)) return;
    els.dropzone.classList.remove('is-drag');
  });
}

els.dropzone.addEventListener('drop', (event) => {
  if (event.dataTransfer) addFiles(event.dataTransfer.files);
});

// Stop the browser from navigating away when a file is dropped elsewhere.
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());

wireSegmented(els.maxEdgeGroup, 'maxEdge');
wireSegmented(els.formatGroup, 'format');

els.quality.addEventListener('input', () => {
  state.quality = Number(els.quality.value);
  paintQuality();
  rerun();
});

els.clearBtn.addEventListener('click', clearAll);

els.downloadAll.addEventListener('click', () => {
  items
    .filter((item) => !item.error)
    .forEach((item, index) => {
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = item.url;
        link.download = outputName(item.file.name);
        link.click();
      }, index * 150);
    });
});

paintQuality();
