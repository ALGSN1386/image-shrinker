/**
 * image-shrinker — resize and re-encode images entirely in the browser.
 * Everything happens on the Canvas API; no file ever leaves the device.
 */

const $ = (id) => document.getElementById(id);

const els = {
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  browseBtn: $('browseBtn'),
  maxEdge: $('maxEdge'),
  quality: $('quality'),
  qualityOut: $('qualityOut'),
  format: $('format'),
  results: $('results'),
  summary: $('summary'),
  downloadAll: $('downloadAll'),
};

/** Picked files, kept so changing a setting can re-run without re-picking. */
let sourceFiles = [];
/** One rendered result per source file. */
let items = [];
/** Guards against a stale run overwriting a newer one. */
let runId = 0;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function outputName(name) {
  const extension = els.format.value === 'image/webp' ? 'webp' : 'jpg';
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

  const maxEdge = Number(els.maxEdge.value);
  const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight)) : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';

  // JPEG has no alpha channel: without a background, transparent PNGs go black.
  if (els.format.value === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === 'function') bitmap.close();

  const blob = await encode(canvas, els.format.value, Number(els.quality.value) / 100);
  return { blob, width, height, sourceWidth, sourceHeight };
}

async function run() {
  if (!sourceFiles.length) return;

  const id = ++runId;
  els.downloadAll.disabled = true;

  items.forEach((item) => item.url && URL.revokeObjectURL(item.url));
  items = [];

  const next = [];
  for (const file of sourceFiles) {
    try {
      const result = await compress(file);
      next.push({ file, ...result, url: URL.createObjectURL(result.blob), error: null });
    } catch (error) {
      next.push({ file, error: error instanceof Error ? error.message : String(error) });
    }

    // A newer run started while this one was working: discard these results.
    if (id !== runId) {
      next.forEach((item) => item.url && URL.revokeObjectURL(item.url));
      return;
    }
  }

  items = next;
  render();
  els.downloadAll.disabled = false;
}

function render() {
  els.results.textContent = '';

  if (!items.length) {
    els.summary.hidden = true;
    els.downloadAll.hidden = true;
    return;
  }

  let originalBytes = 0;
  let compressedBytes = 0;

  for (const item of items) {
    const row = document.createElement('li');
    row.className = 'row';

    const left = document.createElement('div');

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.error ? item.file.name : outputName(item.file.name);

    const meta = document.createElement('div');
    meta.className = 'meta';

    if (item.error) {
      meta.textContent = `failed: ${item.error}`;
    } else {
      originalBytes += item.file.size;
      compressedBytes += item.blob.size;
      const saved = item.file.size ? Math.round((1 - item.blob.size / item.file.size) * 100) : 0;

      meta.append(
        document.createTextNode(
          `${formatBytes(item.file.size)} → ${formatBytes(item.blob.size)} · `
        )
      );
      const saving = document.createElement('span');
      saving.className = 'save';
      saving.textContent = saved > 0 ? `−${saved}%` : 'no gain';
      meta.append(saving, document.createTextNode(` · ${item.width}×${item.height}`));
    }

    left.append(name, meta);

    const link = document.createElement('a');
    if (item.error) {
      link.hidden = true;
    } else {
      link.className = 'dl';
      link.href = item.url;
      link.download = outputName(item.file.name);
      link.textContent = 'Download';
    }

    row.append(left, link);
    els.results.append(row);
  }

  const totalSaved = originalBytes ? Math.round((1 - compressedBytes / originalBytes) * 100) : 0;
  els.summary.hidden = false;
  els.summary.textContent = '';
  els.summary.append(
    document.createTextNode(
      `${items.length} image${items.length === 1 ? '' : 's'} · ` +
        `${formatBytes(originalBytes)} → ${formatBytes(compressedBytes)} · `
    )
  );
  const strong = document.createElement('b');
  strong.textContent = totalSaved > 0 ? `−${totalSaved}%` : 'no gain';
  els.summary.append(strong, document.createTextNode(' saved'));

  els.downloadAll.hidden = items.every((item) => item.error);
}

function addFiles(fileList) {
  const images = [...fileList].filter((file) => file.type.startsWith('image/'));
  if (!images.length) return;
  sourceFiles = sourceFiles.concat(images);
  run();
}

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
    els.dropzone.classList.add('drag');
  });
}

for (const type of ['dragleave', 'drop']) {
  els.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    if (type === 'dragleave' && els.dropzone.contains(event.relatedTarget)) return;
    els.dropzone.classList.remove('drag');
  });
}

els.dropzone.addEventListener('drop', (event) => {
  if (event.dataTransfer) addFiles(event.dataTransfer.files);
});

// Stop the browser from navigating away when a file is dropped outside the zone.
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());

let pending;
const rerun = () => {
  clearTimeout(pending);
  els.downloadAll.disabled = true;
  pending = setTimeout(run, 150);
};

els.maxEdge.addEventListener('change', rerun);
els.format.addEventListener('change', rerun);
els.quality.addEventListener('input', () => {
  els.qualityOut.textContent = `${els.quality.value}%`;
  rerun();
});

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
