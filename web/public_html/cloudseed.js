'use strict';

/* ============================================================
   CloudSeed — Premium Seedr.cc-style frontend
   ============================================================ */

const CFG = window.APP_CONFIG || {};
const RPC_PATH    = CFG.rpcPath          || '../rpc';
const FILE_BASE   = CFG.fileServerBase   || '/downloads';
const ZIP_BASE    = CFG.zipServerBase    || '/zip';
const POLL_MS     = CFG.pollInterval     || 3000;
const APP_NAME    = CFG.appName          || 'CloudSeed';
const AUTO_PASTE  = CFG.autoPasteMagnet  !== false;
const ZIP_WARN_GB = CFG.zipWarnThresholdGB || 4;
const GRAPH_MIN   = (CFG.speedGraphMinutes || 5) * 60 * 1000;
const GRAPH_HEIGHT_KEY    = 'cloudseed-graph-height';
const GRAPH_COLLAPSED_KEY = 'cloudseed-graph-collapsed';
const GRAPH_DEFAULT_H = 120;
const GRAPH_MIN_H     = 64;
const GRAPH_MAX_H     = 420;
const WISHLIST_KEY = 'cloudseed-wishlist';
const THEME_KEY    = 'cloudseed-theme';

let pollTimer     = null;
let sessionId     = sessionStorage.getItem('tr-session-id') || '';
let torrents      = {};
let currentFilter = 'all';
let currentSort   = 'date';
let sortDesc      = true;
let searchQuery   = '';
let isConnected   = false;
let prevCompleted = new Set();
let pendingDeleteId = null;
let wishlist      = [];
let expandedTorrents = new Set();
let pendingPicker = null;
let speedHistory  = [];
let graphSize     = { w: 0, h: 0, dpr: 1 };

const PICKER_FIELDS = [
  'id','name','files','fileStats','metadataPercentComplete','status','percentDone'
];

const STATUS = {
  0: { label: 'Stopped',     cls: 'paused'      },
  1: { label: 'Queued',      cls: 'queued'       },
  2: { label: 'Checking',    cls: 'checking'     },
  3: { label: 'Queued',      cls: 'queued'       },
  4: { label: 'Downloading', cls: 'downloading'  },
  5: { label: 'Queued',      cls: 'queued'       },
  6: { label: 'Seeding',     cls: 'complete'     },
};

const FIELDS = [
  'id','name','status','percentDone','sizeWhenDone','totalSize',
  'rateDownload','rateUpload','eta','addedDate','downloadDir',
  'files','fileStats','error','errorString','uploadRatio',
  'uploadedEver','downloadedEver'
];

const EXT_MAP = {
  video:   ['mkv','mp4','avi','mov','wmv','flv','webm','m4v','ts','m2ts','vob','mts'],
  audio:   ['mp3','flac','aac','wav','ogg','m4a','opus','wma','aiff'],
  image:   ['jpg','jpeg','png','gif','webp','bmp','tiff','svg','heic','avif'],
  archive: ['zip','rar','7z','tar','gz','bz2','xz','iso','cab'],
  doc:     ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','srt','nfo','epub','sub'],
  code:    ['js','ts','py','java','c','cpp','json','xml','html','css','sh','rb','go'],
};

const ICON = {
  video:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  audio:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  image:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>`,
  doc:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  code:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  folder:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  generic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
  pause:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
  play:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  trash:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>`,
  download:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  copy:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
};

// ── Formatters ────────────────────────────────────────────────
function fmtBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
}

function fmtSpeed(bps) {
  if (!bps || bps <= 0) return '0 KB/s';
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1048576).toFixed(1)} MB/s`;
}

function fmtSpeedAxis(bps) {
  if (!bps || bps <= 0) return '0';
  if (bps < 1024 * 1024) return `${Math.round(bps / 1024)}K`;
  if (bps < 1024 * 1024 * 1024) return `${(bps / 1048576).toFixed(1)}M`;
  return `${(bps / 1073741824).toFixed(1)}G`;
}

function aggregateSpeeds(list) {
  return list.reduce((acc, t) => ({
    dl: acc.dl + (t.rateDownload || 0),
    ul: acc.ul + (t.rateUpload || 0),
  }), { dl: 0, ul: 0 });
}

function niceSpeedMax(value) {
  const floor = 100 * 1024;
  if (!value || value <= 0) return floor;
  const padded = value * 1.15;
  const mag = 10 ** Math.floor(Math.log10(padded));
  return Math.max(floor, Math.ceil(padded / mag) * mag);
}

function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function recordSpeedSample(dl, ul) {
  const now = Date.now();
  speedHistory.push({ t: now, dl, ul });
  const cutoff = now - GRAPH_MIN;
  while (speedHistory.length && speedHistory[0].t < cutoff) speedHistory.shift();
}

function resizeSpeedGraph() {
  const wrap = document.getElementById('speed-graph-wrap');
  const canvas = document.getElementById('speed-graph');
  if (!wrap || !canvas) return;
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  graphSize = { w: Math.max(rect.width, 1), h: Math.max(rect.height, 1), dpr };
  canvas.width = Math.floor(graphSize.w * dpr);
  canvas.height = Math.floor(graphSize.h * dpr);
}

function drawSpeedSeries(ctx, samples, key, color, maxY, pad, plotW, plotH, tMin, tMax) {
  if (samples.length < 2) return;

  const xAt = (t) => pad.l + ((t - tMin) / (tMax - tMin)) * plotW;
  const yAt = (v) => pad.t + plotH - (v / maxY) * plotH;

  ctx.beginPath();
  ctx.moveTo(xAt(samples[0].t), yAt(samples[0][key]));
  for (let i = 1; i < samples.length; i++) {
    ctx.lineTo(xAt(samples[i].t), yAt(samples[i][key]));
  }
  ctx.lineTo(xAt(samples[samples.length - 1].t), pad.t + plotH);
  ctx.lineTo(xAt(samples[0].t), pad.t + plotH);
  ctx.closePath();
  ctx.fillStyle = color.fill;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(xAt(samples[0].t), yAt(samples[0][key]));
  for (let i = 1; i < samples.length; i++) {
    ctx.lineTo(xAt(samples[i].t), yAt(samples[i][key]));
  }
  ctx.strokeStyle = color.line;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function renderSpeedGraph(dl = 0, ul = 0) {
  const canvas = document.getElementById('speed-graph');
  const dlEl = document.getElementById('graph-dl-current');
  const ulEl = document.getElementById('graph-ul-current');
  const rangeEl = document.getElementById('graph-range-label');
  if (!canvas) return;

  if (dlEl) dlEl.textContent = fmtSpeed(dl);
  if (ulEl) ulEl.textContent = fmtSpeed(ul);
  if (rangeEl) {
    const mins = Math.round(GRAPH_MIN / 60000);
    rangeEl.textContent = `Last ${mins} minute${mins === 1 ? '' : 's'}`;
  }

  const panel = document.getElementById('speed-graph-panel');
  if (panel?.classList.contains('collapsed')) return;

  resizeSpeedGraph();
  const ctx = canvas.getContext('2d');
  const { w, h, dpr } = graphSize;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pad = { t: 10, r: 12, b: 22, l: 42 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const now = Date.now();
  const tMax = now;
  const tMin = now - GRAPH_MIN;

  const samples = speedHistory.length
    ? speedHistory
    : [{ t: tMin, dl: 0, ul: 0 }, { t: tMax, dl: 0, ul: 0 }];

  const peak = samples.reduce((m, s) => Math.max(m, s.dl, s.ul), 0);
  const maxY = niceSpeedMax(peak);

  const gridColor = cssColor('--border-subtle', 'rgba(0,0,0,.08)');
  const textColor = cssColor('--text-muted', '#888');
  const dlColors = {
    line: cssColor('--accent', '#2563eb'),
    fill: cssColor('--graph-dl-fill', 'rgba(37,99,235,.18)'),
  };
  const ulColors = {
    line: cssColor('--teal', '#0d9488'),
    fill: cssColor('--graph-ul-fill', 'rgba(13,148,136,.16)'),
  };

  ctx.strokeStyle = gridColor;
  ctx.fillStyle = textColor;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.t + (plotH / gridLines) * i;
    const val = maxY * (1 - i / gridLines);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.fillText(fmtSpeedAxis(val), pad.l - 6, y);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('now', pad.l + plotW, pad.t + plotH + 6);
  const mins = Math.round(GRAPH_MIN / 60000);
  ctx.textAlign = 'left';
  ctx.fillText(`${mins}m ago`, pad.l, pad.t + plotH + 6);

  drawSpeedSeries(ctx, samples, 'ul', ulColors, maxY, pad, plotW, plotH, tMin, tMax);
  drawSpeedSeries(ctx, samples, 'dl', dlColors, maxY, pad, plotW, plotH, tMin, tMax);
}

function updateSpeedGraph(list) {
  const { dl, ul } = aggregateSpeeds(list);
  recordSpeedSample(dl, ul);
  renderSpeedGraph(dl, ul);
}

function getSavedGraphHeight() {
  const saved = parseInt(localStorage.getItem(GRAPH_HEIGHT_KEY), 10);
  if (!saved || Number.isNaN(saved)) return GRAPH_DEFAULT_H;
  return Math.min(GRAPH_MAX_H, Math.max(GRAPH_MIN_H, saved));
}

function applyGraphHeight(height) {
  const wrap = document.getElementById('speed-graph-wrap');
  if (!wrap) return;
  const h = Math.min(GRAPH_MAX_H, Math.max(GRAPH_MIN_H, height));
  wrap.style.height = `${h}px`;
  localStorage.setItem(GRAPH_HEIGHT_KEY, String(h));
}

function setGraphCollapsed(collapsed) {
  const panel = document.getElementById('speed-graph-panel');
  const toggle = document.getElementById('speed-graph-toggle');
  if (!panel) return;
  panel.classList.toggle('collapsed', collapsed);
  localStorage.setItem(GRAPH_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  if (toggle) {
    toggle.title = collapsed ? 'Expand graph' : 'Collapse graph';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  if (!collapsed) {
    applyGraphHeight(getSavedGraphHeight());
    const last = speedHistory[speedHistory.length - 1];
    requestAnimationFrame(() => renderSpeedGraph(last?.dl || 0, last?.ul || 0));
  }
}

function toggleGraphCollapsed() {
  const panel = document.getElementById('speed-graph-panel');
  setGraphCollapsed(!panel?.classList.contains('collapsed'));
}

function startGraphResize(clientY) {
  const panel = document.getElementById('speed-graph-panel');
  const wrap = document.getElementById('speed-graph-wrap');
  if (!panel || !wrap || panel.classList.contains('collapsed')) return;

  const startY = clientY;
  const startH = wrap.offsetHeight;
  panel.classList.add('is-resizing');
  document.body.classList.add('graph-resizing');

  const onMove = (y) => {
    const delta = startY - y;
    applyGraphHeight(startH + delta);
    const last = speedHistory[speedHistory.length - 1];
    renderSpeedGraph(last?.dl || 0, last?.ul || 0);
  };

  const onMouseMove = (e) => onMove(e.clientY);
  const onTouchMove = (e) => {
    if (e.touches[0]) {
      e.preventDefault();
      onMove(e.touches[0].clientY);
    }
  };
  const onEnd = () => {
    panel.classList.remove('is-resizing');
    document.body.classList.remove('graph-resizing');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onEnd);
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}

function setupSpeedGraph() {
  const panel = document.getElementById('speed-graph-panel');
  const wrap = document.getElementById('speed-graph-wrap');
  const resize = document.getElementById('speed-graph-resize');
  const toggle = document.getElementById('speed-graph-toggle');
  const header = panel?.querySelector('.speed-graph-header');
  if (!wrap) return;

  const collapsed = localStorage.getItem(GRAPH_COLLAPSED_KEY) === 'true';
  if (collapsed) {
    setGraphCollapsed(true);
  } else {
    applyGraphHeight(getSavedGraphHeight());
  }

  toggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleGraphCollapsed();
  });

  header?.addEventListener('click', () => {
    if (panel?.classList.contains('collapsed')) toggleGraphCollapsed();
  });

  resize?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startGraphResize(e.clientY);
  });

  resize?.addEventListener('touchstart', (e) => {
    if (e.touches[0]) {
      e.preventDefault();
      startGraphResize(e.touches[0].clientY);
    }
  }, { passive: false });

  resize?.addEventListener('dblclick', () => {
    applyGraphHeight(GRAPH_DEFAULT_H);
    const last = speedHistory[speedHistory.length - 1];
    renderSpeedGraph(last?.dl || 0, last?.ul || 0);
  });

  const ro = new ResizeObserver(() => {
    if (panel?.classList.contains('collapsed')) return;
    const last = speedHistory[speedHistory.length - 1];
    renderSpeedGraph(last?.dl || 0, last?.ul || 0);
  });
  ro.observe(wrap);
  renderSpeedGraph(0, 0);
}

function fmtETA(secs) {
  if (secs < 0) return '–';
  if (secs < 60) return '< 1m';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d`;
}

function fmtDate(unix) {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    month: '2-digit', day: '2-digit', year: 'numeric'
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function truncate(s, n = 70) {
  return s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '');
}

function fileCategory(ext) {
  const e = (ext || '').toLowerCase();
  for (const [cat, exts] of Object.entries(EXT_MAP)) {
    if (exts.includes(e)) return cat;
  }
  return 'generic';
}

function getStatus(t) {
  if (t.error && t.error !== 0) return { label: 'Error', cls: 'error' };
  return STATUS[t.status] || { label: 'Unknown', cls: 'unknown' };
}

function torrentIsMultiFile(t) {
  return (t.files?.length || 0) > 1;
}

function torrentHasFileList(t) {
  return (t.files?.length || 0) > 0;
}

function fileIsComplete(t, idx) {
  const file = t.files?.[idx];
  const stat = t.fileStats?.[idx];
  if (!file?.length) return false;
  return (stat?.bytesCompleted ?? 0) >= file.length;
}

function fileIconHtml(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const cat = fileCategory(ext);
  return `<span class="torrent-file-icon cat-${cat}">${ICON[cat] || ICON.generic}</span>`;
}

function pickerMetaText(t) {
  const files = t.files || [];
  const total = files.reduce((s, f) => s + (f.length || 0), 0);
  return `${files.length} file${files.length === 1 ? '' : 's'} · ${fmtBytes(total)} total`;
}

function countSelectedCompleteFiles(t) {
  return (t.files || []).reduce((n, _, idx) => {
    if (!fileIsWanted(t.fileStats, idx)) return n;
    return fileIsComplete(t, idx) ? n + 1 : n;
  }, 0);
}

function fileIsWanted(fileStats, idx) {
  const w = fileStats?.[idx]?.wanted;
  return w === true || w === 1;
}

function fileDisplayName(t, file, idx) {
  const name = file.name || '';
  if (torrentIsMultiFile(t) && name.includes('/')) {
    const parts = name.split('/');
    return parts.slice(1).join('/') || parts[parts.length - 1];
  }
  return name.split('/').pop() || name;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isMagnetSource(args) {
  return (args.filename || '').trim().toLowerCase().startsWith('magnet:');
}

function updatePickerLoadingProgress(t, metaPct) {
  const textEl = document.getElementById('picker-loading-text');
  const barEl  = document.getElementById('picker-loading-bar');
  const fillEl = document.getElementById('picker-loading-fill');
  const nameEl = document.getElementById('picker-torrent-name');

  if (nameEl && t?.name) nameEl.textContent = t.name;

  const pct = Math.round(Math.max(0, Math.min(1, metaPct ?? 0)) * 100);
  if (textEl) {
    textEl.textContent = pct > 0 && pct < 100
      ? `Reading torrent metadata… ${pct}%`
      : pct >= 100
        ? 'Preparing file list…'
        : 'Connecting to peers…';
  }
  if (barEl && fillEl) {
    if (pct > 0 && pct < 100) {
      barEl.hidden = false;
      fillEl.style.width = `${pct}%`;
    } else if (pct >= 100) {
      barEl.hidden = false;
      fillEl.style.width = '100%';
    } else {
      barEl.hidden = true;
      fillEl.style.width = '0%';
    }
  }
}

async function waitForTorrentFiles(id, { signal, needsMetadata = false } = {}) {
  const delays = [0, 80, 120, 150, 200, 250, 300, 400, 500];
  const maxAttempts = needsMetadata ? 180 : 15;

  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) throw new Error('cancelled');

    const data = await rpc('torrent-get', { ids: [+id], fields: PICKER_FIELDS });
    const t = data?.arguments?.torrents?.[0];
    if (t?.files?.length) return t;

    const meta = t?.metadataPercentComplete ?? 0;
    updatePickerLoadingProgress(t, needsMetadata ? meta : 1);

    await sleep(delays[Math.min(i, delays.length - 1)]);
  }

  throw new Error('Timed out waiting for torrent metadata');
}

function getTorrentIdFromAddResponse(r) {
  return r?.arguments?.['torrent-added']?.id
    ?? r?.arguments?.['torrent-duplicate']?.id
    ?? null;
}

async function applyFileSelection(torrentId, wantedIndices) {
  const t = torrents[torrentId] || (await rpc('torrent-get', {
    ids: [+torrentId],
    fields: ['id','files','fileStats'],
  }))?.arguments?.torrents?.[0];

  const fileCount = t?.files?.length || 0;
  if (!fileCount) return;

  const wantedSet = new Set(wantedIndices);
  const filesWanted = [];
  const filesUnwanted = [];
  for (let i = 0; i < fileCount; i++) {
    if (wantedSet.has(i)) filesWanted.push(i);
    else filesUnwanted.push(i);
  }

  const args = { ids: [+torrentId] };
  if (filesWanted.length) args['files-wanted'] = filesWanted;
  if (filesUnwanted.length) args['files-unwanted'] = filesUnwanted;
  await rpc('torrent-set', args);
}

async function startTorrent(id) {
  await rpc('torrent-start', { ids: [+id] });
}

function renderPickerItems(t, selected) {
  const list = document.getElementById('picker-file-list');
  const summary = document.getElementById('picker-summary');
  const selectAll = document.getElementById('picker-select-all');
  const meta = document.getElementById('picker-meta');
  if (!list) return;

  const files = t.files || [];
  if (meta) meta.textContent = pickerMetaText(t);

  list.innerHTML = files.map((file, idx) => {
    const checked = selected.has(idx);
    const display = escHtml(fileDisplayName(t, file, idx));
    const ext = (file.name || '').split('.').pop().toLowerCase();
    const cat = fileCategory(ext);
    return `<li class="picker-file-item" data-idx="${idx}">
      <label class="picker-file-check">
        <input type="checkbox" class="row-checkbox picker-file-cb" data-idx="${idx}" ${checked ? 'checked' : ''} />
        <span class="checkmark"></span>
        <span class="picker-file-icon cat-${cat}">${ICON[cat] || ICON.generic}</span>
        <span class="picker-file-info">
          <span class="name" title="${escHtml(file.name)}">${display}</span>
        </span>
      </label>
      <span class="picker-file-size">${fmtBytes(file.length)}</span>
    </li>`;
  }).join('');

  const totalWanted = files.reduce((s, f, i) => selected.has(i) ? s + (f.length || 0) : s, 0);
  if (summary) {
    summary.textContent = `${selected.size} selected · ${fmtBytes(totalWanted)}`;
  }
  if (selectAll) {
    selectAll.checked = selected.size === files.length;
    selectAll.indeterminate = selected.size > 0 && selected.size < files.length;
  }
}

async function openTorrentFilePicker(torrentId, { isNew = true, needsMetadata = false } = {}) {
  const dlg = document.getElementById('torrent-files-dialog');
  const loading = document.getElementById('picker-loading');
  const body = document.getElementById('picker-body');
  const startBtn = document.getElementById('picker-start');
  const nameEl = document.getElementById('picker-torrent-name');
  if (!dlg) return;

  const abort = new AbortController();
  pendingPicker = { torrentId: +torrentId, isNew, selected: new Set(), abort, needsMetadata };
  if (nameEl) nameEl.textContent = needsMetadata ? 'Fetching metadata…' : 'Loading…';
  updatePickerLoadingProgress(null, 0);
  if (loading) loading.hidden = false;
  if (body) body.hidden = true;
  if (startBtn) startBtn.disabled = true;
  dlg.showModal();

  try {
    const t = await waitForTorrentFiles(torrentId, { signal: abort.signal, needsMetadata });
    if (!t?.files?.length) throw new Error('no files');

    if (needsMetadata) {
      try { await rpc('torrent-stop', { ids: [+torrentId] }); } catch {}
    }

    torrents[t.id] = { ...torrents[t.id], ...t };
    pendingPicker.torrent = t;
    pendingPicker.selected = new Set(
      (t.files || []).map((_, i) => i).filter(i => fileIsWanted(t.fileStats, i))
    );
    if (pendingPicker.selected.size === 0 && t.files?.length) {
      t.files.forEach((_, i) => pendingPicker.selected.add(i));
    }

    if (nameEl) nameEl.textContent = t.name;
    renderPickerItems(t, pendingPicker.selected);
    if (loading) loading.hidden = true;
    if (body) body.hidden = false;
    if (startBtn) startBtn.disabled = pendingPicker.selected.size === 0;
  } catch (e) {
    if (e?.message === 'cancelled') return;
    if (loading) loading.hidden = true;
    toast('Could not load torrent files', 'error');
    if (pendingPicker?.isNew) {
      try { await removeTorrent(pendingPicker.torrentId, false); } catch {}
    }
    pendingPicker = null;
    dlg.close();
  }
}

async function confirmTorrentFilePicker() {
  if (!pendingPicker) return;
  const { torrentId, selected, isNew } = pendingPicker;
  const dlg = document.getElementById('torrent-files-dialog');
  const startBtn = document.getElementById('picker-start');
  if (startBtn) startBtn.disabled = true;

  try {
    if (selected.size === 0) {
      toast('Select at least one file', 'info');
      if (startBtn) startBtn.disabled = false;
      return;
    }
    await applyFileSelection(torrentId, [...selected]);
    await startTorrent(torrentId);
    expandedTorrents.add(+torrentId);
    toast(isNew ? 'Download started' : 'File selection updated', 'success');
    pendingPicker = null;
    dlg?.close();
    document.getElementById('magnet-input').value = '';
    await poll();
  } catch {
    toast('Failed to start download', 'error');
    if (startBtn) startBtn.disabled = false;
  }
}

async function cancelTorrentFilePicker() {
  const dlg = document.getElementById('torrent-files-dialog');
  const picker = pendingPicker;
  pendingPicker = null;
  picker?.abort?.abort();
  if (picker?.isNew && picker.torrentId) {
    try { await removeTorrent(picker.torrentId, false); } catch {}
    await poll();
  }
  dlg?.close();
}

async function addTorrentWithPicker(args, label) {
  const btn = document.getElementById('btn-add-torrent');
  btn?.classList.add('loading');
  const magnet = isMagnetSource(args);
  try {
    const r = await rpc('torrent-add', {
      ...args,
      paused: !magnet,
    });
    if (r.result !== 'success') {
      toast(r.result || 'Failed to add torrent', 'error');
      return;
    }
    const id = getTorrentIdFromAddResponse(r);
    if (!id) {
      toast('Added but could not open file picker', 'error');
      await poll();
      return;
    }
    if (magnet) {
      await rpc('torrent-start', { ids: [+id] });
    }
    if (r.arguments['torrent-duplicate']) {
      toast('Torrent already exists — adjust file selection', 'info');
    }
    await openTorrentFilePicker(id, {
      isNew: !r.arguments['torrent-duplicate'],
      needsMetadata: magnet,
    });
  } catch {
    toast(`Cannot add ${label || 'torrent'}`, 'error');
  } finally {
    btn?.classList.remove('loading');
  }
}

function downloadTorrentFileHttp(t, idx) {
  const file = t.files?.[idx];
  if (!file || !fileIsComplete(t, idx)) {
    toast('File is not ready to download', 'info');
    return;
  }
  const { url, filename } = buildDownloadTarget(t, file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadSelectedTorrentFiles(torrentId) {
  const t = torrents[torrentId];
  if (!t?.files) return;
  const indices = t.files
    .map((_, idx) => idx)
    .filter(idx => fileIsWanted(t.fileStats, idx) && fileIsComplete(t, idx));
  if (!indices.length) {
    toast('No completed selected files to download', 'info');
    return;
  }
  indices.forEach((idx, i) => {
    setTimeout(() => downloadTorrentFileHttp(t, idx), i * 300);
  });
  toast(`Downloading ${indices.length} file${indices.length > 1 ? 's' : ''}`, 'success');
}

function buildTorrentFilesPanel(t) {
  const files = t.files || [];
  const stats = t.fileStats || [];
  const completeSelected = countSelectedCompleteFiles(t);

  const items = files.map((file, idx) => {
    const wanted = fileIsWanted(stats, idx);
    const complete = fileIsComplete(t, idx);
    const pct = stats[idx]?.bytesCompleted != null && file.length
      ? Math.round((stats[idx].bytesCompleted / file.length) * 100)
      : 0;
    const display = escHtml(fileDisplayName(t, file, idx));
    const ext = (file.name || '').split('.').pop();
    const cat = fileCategory(ext);

    let statusText = '';
    if (!wanted) statusText = '<span class="torrent-file-status skipped">Skipped</span>';
    else if (complete) statusText = '<span class="torrent-file-status done">Ready</span>';
    else if (pct > 0) statusText = `<span class="torrent-file-status">${pct}%</span>`;
    else statusText = '<span class="torrent-file-status waiting">Queued</span>';

    const dlBtn = complete
      ? `<button class="torrent-file-dl-btn" data-tid="${t.id}" data-idx="${idx}" type="button" title="Download file">${ICON.download}</button>`
      : `<button class="torrent-file-dl-btn" type="button" disabled title="Not ready">${ICON.download}</button>`;

    return `<li class="torrent-file-item${wanted ? '' : ' unwanted'}" data-tid="${t.id}" data-idx="${idx}">
      <label class="torrent-file-check">
        <input type="checkbox" class="row-checkbox torrent-file-cb" data-tid="${t.id}" data-idx="${idx}" ${wanted ? 'checked' : ''} />
        <span class="checkmark"></span>
        ${fileIconHtml(file.name)}
        <span class="torrent-file-name" title="${escHtml(file.name)}">${display}</span>
      </label>
      <span class="torrent-file-size">${fmtBytes(file.length)}</span>
      ${statusText}
      ${dlBtn}
    </li>`;
  }).join('');

  const bulkBtn = completeSelected > 0
    ? `<button class="torrent-files-dl-selected btn-secondary btn-sm" data-tid="${t.id}" type="button">${ICON.download} Download selected (${completeSelected})</button>`
    : '';

  return `<div class="torrent-files-panel" data-tid="${t.id}">
    <div class="torrent-files-toolbar">
      <span class="torrent-files-toolbar-label">${files.length} file${files.length === 1 ? '' : 's'} · check to download, uncheck to skip</span>
      <div class="torrent-files-toolbar-actions">
        <button class="torrent-files-edit btn-secondary btn-sm" data-tid="${t.id}" type="button">Edit files</button>
        ${bulkBtn}
      </div>
    </div>
    <div class="torrent-files-head" aria-hidden="true">
      <span></span>
      <span>Name</span>
      <span>Size</span>
      <span>Status</span>
      <span></span>
    </div>
    <ul class="torrent-files-list">${items}</ul>
  </div>`;
}

function toggleTorrentExpand(id) {
  const key = +id;
  const t = torrents[key];
  if (!t || !torrentHasFileList(t)) return;

  if (expandedTorrents.has(key)) expandedTorrents.delete(key);
  else expandedTorrents.add(key);

  const groupEl = document.querySelector(`[data-group-id="${key}"]`);
  if (groupEl) {
    syncTorrentRowExpand(groupEl, t);
    return;
  }
  renderList(Object.values(torrents));
}

function syncTorrentRowExpand(groupEl, t) {
  const expanded = expandedTorrents.has(t.id);
  groupEl.classList.toggle('expanded', expanded);

  const btn = groupEl.querySelector('.row-expand-btn');
  if (btn) {
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.title = expanded ? 'Hide files' : 'Show files';
  }

  const panel = groupEl.querySelector('.torrent-files-panel');
  if (expanded && !panel) {
    const tmp = document.createElement('div');
    tmp.innerHTML = buildTorrentFilesPanel(t);
    groupEl.appendChild(tmp.firstElementChild);
  } else if (!expanded && panel) {
    panel.remove();
  }
}

async function setSingleFileWanted(torrentId, fileIndex, wanted) {
  const args = { ids: [+torrentId] };
  if (wanted) args['files-wanted'] = [fileIndex];
  else args['files-unwanted'] = [fileIndex];
  await rpc('torrent-set', args);
  await poll();
}

function torrentIsFolder(t) {
  if (!t.files || t.files.length === 0) return false;
  return t.files.length > 1 || t.files[0].name.includes('/');
}

function torrentCategory(t) {
  if (!t.files || t.files.length === 0) return 'generic';
  if (torrentIsFolder(t)) return 'folder';
  return fileCategory(t.files[0].name.split('.').pop());
}

function buildDownloadTarget(t, file = null) {
  const isFolder = torrentIsFolder(t);
  if (file === null) {
    if (isFolder) {
      const p = encodeURIComponent(t.name);
      return { url: `${ZIP_BASE}?path=${p}`, isZip: true, filename: `${t.name}.zip` };
    }
    const name = t.files[0].name;
    const url = `${FILE_BASE}/${name.split('/').map(encodeURIComponent).join('/')}`;
    return { url, isZip: false, filename: name.split('/').pop() };
  }
  const url = `${FILE_BASE}/${file.name.split('/').map(encodeURIComponent).join('/')}`;
  return { url, isZip: false, filename: file.name.split('/').pop() };
}

function extractMagnetName(url) {
  const dn = url.match(/dn=([^&]+)/);
  if (dn) return decodeURIComponent(dn[1].replace(/\+/g, ' '));
  const hash = url.match(/btih:([a-fA-F0-9]+)/);
  if (hash) return `Magnet ${hash[1].slice(0, 8)}…`;
  return truncate(url, 50);
}

// ── Theme ─────────────────────────────────────────────────────
function getTheme() {
  return localStorage.getItem(THEME_KEY) || CFG.defaultTheme || 'dark';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  let el = document.getElementById('theme-color-meta');
  if (!el) {
    el = document.createElement('meta');
    el.id = 'theme-color-meta';
    el.name = 'theme-color';
    document.head.appendChild(el);
  }
  el.content = theme === 'dark' ? '#060608' : '#eef0f4';
  requestAnimationFrame(() => {
    const last = speedHistory[speedHistory.length - 1];
    if (document.getElementById('speed-graph')) {
      renderSpeedGraph(last?.dl || 0, last?.ul || 0);
    }
  });
}

function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

// ── Wishlist ──────────────────────────────────────────────────
function loadWishlist() {
  try {
    wishlist = JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]');
  } catch {
    wishlist = [];
  }
  updateWishlistBadge();
}

function saveWishlist() {
  localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist));
  updateWishlistBadge();
}

function updateWishlistBadge() {
  const badge = document.getElementById('wishlist-badge');
  const count = document.getElementById('wishlist-count');
  const n = wishlist.length;
  if (badge) {
    badge.textContent = n;
    badge.hidden = n === 0;
  }
  if (count) count.textContent = n > 0 ? `(${n})` : '';
}

function addToWishlist(url, name) {
  const link = (url || '').trim();
  if (!link) {
    toast('Paste a magnet link or URL first', 'info');
    return false;
  }
  if (wishlist.some(w => w.url === link)) {
    toast('Already in wishlist', 'info');
    return false;
  }
  wishlist.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url: link,
    name: name || extractMagnetName(link),
    addedAt: Date.now(),
  });
  saveWishlist();
  toast('Added to wishlist', 'success');
  openWishlistDropdown();
  return true;
}

function removeFromWishlist(id) {
  wishlist = wishlist.filter(w => w.id !== id);
  saveWishlist();
  renderWishlist();
}

function renderWishlist() {
  const list  = document.getElementById('wishlist-items');
  const empty = document.getElementById('wishlist-empty');
  if (!list) return;

  if (wishlist.length === 0) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  list.innerHTML = wishlist.map(w => `
    <li class="wishlist-item" data-wid="${w.id}">
      <div class="wishlist-item-top">
        <div class="wishlist-item-info">
          <div class="wishlist-item-name">${escHtml(w.name)}</div>
          <div class="wishlist-item-meta">
            <span>${w.url.startsWith('magnet:') ? 'Magnet' : 'URL'}</span>
            <span>${fmtDate(Math.floor(w.addedAt / 1000))}</span>
          </div>
        </div>
        <button class="wishlist-remove" data-wid="${w.id}" type="button" aria-label="Remove from wishlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="wishlist-item-actions">
        <button class="wishlist-add-one" data-wid="${w.id}" type="button">
          ${ICON.download} Add to Download
        </button>
      </div>
    </li>`).join('');

  const footer = document.getElementById('wishlist-footer');
  if (footer) footer.hidden = wishlist.length < 2;
}

async function addWishlistToSystem(singleId = null) {
  const items = singleId
    ? wishlist.filter(w => w.id === singleId)
    : [...wishlist];

  if (!items.length) {
    toast('Wishlist is empty', 'info');
    return;
  }

  const btn = document.getElementById('btn-wishlist-add-all');
  if (btn) btn.disabled = true;

  let added = 0;
  for (const item of items) {
    try {
      const magnet = isMagnetSource({ filename: item.url });
      const r = await rpc('torrent-add', { filename: item.url, paused: !magnet });
      if (r.result === 'success') {
        const id = getTorrentIdFromAddResponse(r);
        if (id) {
          if (magnet) await rpc('torrent-start', { ids: [+id] });
          removeFromWishlist(item.id);
          added++;
          await openTorrentFilePicker(id, {
            isNew: !r.arguments['torrent-duplicate'],
            needsMetadata: magnet,
          });
          break;
        }
      }
    } catch {
      toast('Failed to add some items', 'error');
      break;
    }
  }

  if (btn) btn.disabled = false;
  if (added > 0) {
    toast(`Added ${added} torrent${added > 1 ? 's' : ''} to CloudSeed`, 'success');
    await poll();
    if (wishlist.length === 0) closeWishlistDropdown();
  }
  renderWishlist();
}

function isWishlistOpen() {
  const el = document.getElementById('wishlist-dropdown');
  return el && !el.hidden;
}

function openWishlistDropdown() {
  renderWishlist();
  const dropdown = document.getElementById('wishlist-dropdown');
  const trigger  = document.getElementById('btn-wishlist');
  if (!dropdown) return;
  dropdown.hidden = false;
  trigger?.setAttribute('aria-expanded', 'true');
}

function closeWishlistDropdown() {
  const dropdown = document.getElementById('wishlist-dropdown');
  const trigger  = document.getElementById('btn-wishlist');
  if (!dropdown) return;
  dropdown.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
}

function toggleWishlistDropdown() {
  if (isWishlistOpen()) closeWishlistDropdown();
  else openWishlistDropdown();
}

// ── RPC ───────────────────────────────────────────────────────
const SESSION_HEADER = 'X-Transmission-Session-Id';

async function rpc(method, args = {}, retried = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionId) headers[SESSION_HEADER] = sessionId;

  const res = await fetch(RPC_PATH, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, arguments: args }),
  });

  if (res.status === 409) {
    const sid = res.headers.get(SESSION_HEADER) || '';
    if (!sid || retried) throw new Error('RPC session handshake failed');
    sessionId = sid;
    sessionStorage.setItem('tr-session-id', sessionId);
    return rpc(method, args, true);
  }
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('json')) throw new Error('Transmission unavailable');
  const data = await res.json();
  if (data.result && data.result !== 'success') throw new Error(data.result);
  return data;
}

async function initSession() {
  await rpc('session-get', { fields: ['version'] });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
}

async function connectToDaemon() {
  showStatusBanner('Connecting…');
  showView('empty');
  setConnected(false);
  try {
    await initSession();
    const ok = await poll();
    if (!ok) throw new Error('offline');
    startPolling();
  } catch {
    hideStatusBanner();
    setConnected(false);
    showView('offline');
    startPolling();
  }
}

function isAddableTorrentUrl(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return t.startsWith('magnet:') || /^https?:\/\//i.test(t);
}

async function tryPasteFromClipboard(input) {
  if (!input || input.value.trim()) return false;
  if (!navigator.clipboard?.readText) return false;
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!isAddableTorrentUrl(text)) return false;
    input.value = text;
    await addMagnet(text);
    return true;
  } catch {
    return false;
  }
}

async function addMagnet(link) {
  if (!link || !link.trim()) return;
  await addTorrentWithPicker({ filename: link.trim() }, 'magnet link');
}

async function addTorrentFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        await addTorrentWithPicker({ metainfo: base64 }, file.name);
        resolve();
      } catch (e) {
        toast(`Error adding ${file.name}`, 'error');
        reject(e);
      }
    };
    reader.readAsDataURL(file);
  });
}

async function pauseTorrent(id)  { await rpc('torrent-stop',   { ids: [+id] }); }
async function resumeTorrent(id) { await rpc('torrent-start',  { ids: [+id] }); }
async function removeTorrent(id, del) {
  await rpc('torrent-remove', { ids: [+id], 'delete-local-data': del });
  delete torrents[id];
}

function isMenuOpen() {
  const dlg = document.getElementById('menu-dialog');
  return dlg?.open === true;
}

function getTorrentList() {
  return Object.values(torrents);
}

function getActiveTorrentIds() {
  return getTorrentList()
    .filter(t => t.status !== 0)
    .map(t => t.id);
}

function getPausedTorrentIds() {
  return getTorrentList()
    .filter(t => t.status === 0)
    .map(t => t.id);
}

function getCompletedTorrentIds() {
  return getTorrentList()
    .filter(t => (t.percentDone >= 1 || t.status === 6) && (!t.error || t.error === 0))
    .map(t => t.id);
}

async function pauseAllTorrents() {
  const ids = getActiveTorrentIds();
  if (!ids.length) {
    toast('No active torrents to pause', 'info');
    return;
  }
  await rpc('torrent-stop', { ids });
  toast(`Paused ${ids.length} torrent${ids.length > 1 ? 's' : ''}`, 'success');
  await poll();
}

async function resumeAllTorrents() {
  const ids = getPausedTorrentIds();
  if (!ids.length) {
    toast('No paused torrents to resume', 'info');
    return;
  }
  await rpc('torrent-start', { ids });
  toast(`Resumed ${ids.length} torrent${ids.length > 1 ? 's' : ''}`, 'success');
  await poll();
}

function showClearCompletedConfirm() {
  const ids = getCompletedTorrentIds();
  if (!ids.length) {
    toast('No completed torrents to clear', 'info');
    return;
  }
  document.getElementById('clear-completed-message').textContent =
    `${ids.length} completed torrent${ids.length > 1 ? 's' : ''} will be removed from the list.`;
  document.getElementById('clear-completed-dialog')?.showModal();
}

async function confirmClearCompleted() {
  const ids = getCompletedTorrentIds();
  document.getElementById('clear-completed-dialog')?.close();
  if (!ids.length) return;
  try {
    await rpc('torrent-remove', { ids, 'delete-local-data': false });
    ids.forEach(id => delete torrents[id]);
    toast(`Cleared ${ids.length} completed torrent${ids.length > 1 ? 's' : ''}`, 'success');
    await poll();
  } catch {
    toast('Failed to clear completed torrents', 'error');
  }
}

async function verifyAllTorrents() {
  const ids = getTorrentList().map(t => t.id);
  if (!ids.length) {
    toast('No torrents to verify', 'info');
    return;
  }
  try {
    await rpc('torrent-verify', { ids });
    toast(`Verifying ${ids.length} torrent${ids.length > 1 ? 's' : ''}…`, 'info');
    await poll();
  } catch {
    toast('Failed to start verification', 'error');
  }
}

async function setAltSpeed(enabled) {
  await rpc('session-set', { 'alt-speed-enabled': enabled });
  updateMenuAltSpeed(enabled);
  toast(enabled ? 'Alternative speed limits on' : 'Alternative speed limits off', 'success');
}

function updateMenuAltSpeed(enabled) {
  const toggle = document.getElementById('menu-alt-speed');
  const hint = document.getElementById('menu-alt-speed-hint');
  if (toggle) toggle.checked = !!enabled;
  if (hint) hint.textContent = enabled ? 'On' : 'Off';
}

function setCurrentFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.menu-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderList(getTorrentList());
}

function updateMenuStats(list = getTorrentList()) {
  if (!isMenuOpen()) return;

  const dlSpeed = list.reduce((sum, t) => sum + (t.rateDownload || 0), 0);
  const ulSpeed = list.reduce((sum, t) => sum + (t.rateUpload || 0), 0);
  const active = list.filter(t => ['downloading', 'queued', 'checking'].includes(getStatus(t).cls)).length;
  const seeding = list.filter(t => getStatus(t).cls === 'complete').length;
  const paused = list.filter(t => getStatus(t).cls === 'paused').length;
  const errors = list.filter(t => getStatus(t).cls === 'error').length;

  const dlEl = document.getElementById('menu-dl-speed');
  const ulEl = document.getElementById('menu-ul-speed');
  const countEl = document.getElementById('menu-torrent-count');
  const statusEl = document.getElementById('menu-connection-status');
  const pauseBtn = document.getElementById('menu-pause-all');
  const resumeBtn = document.getElementById('menu-resume-all');
  const clearBtn = document.getElementById('menu-clear-completed');
  const verifyBtn = document.getElementById('menu-verify-all');

  if (dlEl) dlEl.textContent = fmtSpeed(dlSpeed);
  if (ulEl) ulEl.textContent = fmtSpeed(ulSpeed);
  if (countEl) {
    const parts = [`${list.length} total`];
    if (active) parts.push(`${active} active`);
    if (seeding) parts.push(`${seeding} seeding`);
    if (paused) parts.push(`${paused} paused`);
    if (errors) parts.push(`${errors} errors`);
    countEl.textContent = parts.join(' · ');
  }
  if (statusEl) {
    statusEl.textContent = isConnected ? 'Connected to Transmission' : 'Disconnected';
    statusEl.className = `menu-subtitle ${isConnected ? 'connected' : 'disconnected'}`;
  }
  if (pauseBtn) pauseBtn.disabled = getActiveTorrentIds().length === 0;
  if (resumeBtn) resumeBtn.disabled = getPausedTorrentIds().length === 0;
  if (clearBtn) clearBtn.disabled = getCompletedTorrentIds().length === 0;
  if (verifyBtn) verifyBtn.disabled = list.length === 0;
}

async function refreshMenuSession() {
  try {
    const r = await rpc('session-get', {
      fields: ['version', 'alt-speed-enabled'],
    });
    const args = r?.arguments || {};
    const versionEl = document.getElementById('menu-version');
    if (versionEl && args.version) versionEl.textContent = `Transmission ${args.version}`;
    updateMenuAltSpeed(args['alt-speed-enabled']);
  } catch {
    const versionEl = document.getElementById('menu-version');
    if (versionEl) versionEl.textContent = '';
  }
}

const SESSION_SETTINGS_FIELDS = [
  'speed-limit-down', 'speed-limit-up', 'speed-limit-down-enabled', 'speed-limit-up-enabled',
  'alt-speed-down', 'alt-speed-up',
  'download-queue-size', 'seed-queue-size',
  'seedRatioLimit', 'seedRatioLimited',
  'peer-limit-per-torrent', 'peer-limit-global',
  'download-dir', 'start-added-torrents-paused',
  'dht-enabled', 'pex-enabled',
];

function setSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.settings-pane').forEach(pane => {
    const active = pane.dataset.pane === tab;
    pane.classList.toggle('active', active);
    pane.hidden = !active;
  });
}

function syncSettingsFieldStates() {
  const dlEnabled = document.getElementById('setting-dl-enabled');
  const ulEnabled = document.getElementById('setting-ul-enabled');
  const ratioEnabled = document.getElementById('setting-ratio-enabled');
  const dlLimit = document.getElementById('setting-dl-limit');
  const ulLimit = document.getElementById('setting-ul-limit');
  const ratioLimit = document.getElementById('setting-ratio-limit');

  if (dlLimit) dlLimit.disabled = !dlEnabled?.checked;
  if (ulLimit) ulLimit.disabled = !ulEnabled?.checked;
  if (ratioLimit) ratioLimit.disabled = !ratioEnabled?.checked;
}

function populateSettingsForm(args = {}) {
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  };
  const setCheck = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
  };

  setCheck('setting-dl-enabled', args['speed-limit-down-enabled']);
  setCheck('setting-ul-enabled', args['speed-limit-up-enabled']);
  setVal('setting-dl-limit', args['speed-limit-down'] || 0);
  setVal('setting-ul-limit', args['speed-limit-up'] || 0);
  setVal('setting-alt-dl-limit', args['alt-speed-down'] || 0);
  setVal('setting-alt-ul-limit', args['alt-speed-up'] || 0);
  setVal('setting-dl-queue', args['download-queue-size'] ?? 0);
  setVal('setting-seed-queue', args['seed-queue-size'] ?? 0);
  setCheck('setting-ratio-enabled', args.seedRatioLimited);
  setVal('setting-ratio-limit', args.seedRatioLimit ?? 2);
  setVal('setting-peer-torrent', args['peer-limit-per-torrent'] ?? 50);
  setVal('setting-peer-global', args['peer-limit-global'] ?? 200);
  setCheck('setting-start-paused', args['start-added-torrents-paused']);
  setCheck('setting-dht', args['dht-enabled']);
  setCheck('setting-pex', args['pex-enabled']);

  const dirEl = document.getElementById('setting-download-dir');
  if (dirEl) dirEl.textContent = args['download-dir'] || '—';

  syncSettingsFieldStates();
}

async function openSettings() {
  setSettingsTab('speed');
  try {
    const r = await rpc('session-get', { fields: SESSION_SETTINGS_FIELDS });
    populateSettingsForm(r?.arguments || {});
  } catch {
    populateSettingsForm({});
    toast('Could not load all settings', 'error');
  }
  document.getElementById('settings-modal')?.showModal();
}

async function saveSettings() {
  const num = (id) => parseFloat(document.getElementById(id)?.value) || 0;
  const int = (id) => parseInt(document.getElementById(id)?.value, 10) || 0;
  const on = (id) => !!document.getElementById(id)?.checked;

  const payload = {
    'speed-limit-down-enabled': on('setting-dl-enabled'),
    'speed-limit-down': int('setting-dl-limit'),
    'speed-limit-up-enabled': on('setting-ul-enabled'),
    'speed-limit-up': int('setting-ul-limit'),
    'alt-speed-down': int('setting-alt-dl-limit'),
    'alt-speed-up': int('setting-alt-ul-limit'),
    'download-queue-size': int('setting-dl-queue'),
    'seed-queue-size': int('setting-seed-queue'),
    seedRatioLimited: on('setting-ratio-enabled'),
    seedRatioLimit: num('setting-ratio-limit'),
    'peer-limit-per-torrent': int('setting-peer-torrent'),
    'peer-limit-global': int('setting-peer-global'),
    'start-added-torrents-paused': on('setting-start-paused'),
    'dht-enabled': on('setting-dht'),
    'pex-enabled': on('setting-pex'),
  };

  await rpc('session-set', payload);
  document.getElementById('settings-modal')?.close();
  toast('Settings saved', 'success');
}

function setupSettings() {
  document.querySelector('.settings-nav')?.addEventListener('click', e => {
    const tab = e.target.closest('.settings-tab');
    if (!tab) return;
    setSettingsTab(tab.dataset.tab);
  });

  ['setting-dl-enabled', 'setting-ul-enabled', 'setting-ratio-enabled'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', syncSettingsFieldStates);
  });

  document.getElementById('settings-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('settings-save');
    if (btn) btn.disabled = true;
    try {
      await saveSettings();
    } catch {
      toast('Failed to save settings', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function openMenu() {
  const dlg = document.getElementById('menu-dialog');
  if (!dlg) return;
  document.querySelectorAll('.menu-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === currentFilter);
  });
  updateMenuStats();
  await refreshMenuSession();
  dlg.showModal();
}

// ── Filter & sort ─────────────────────────────────────────────
function showStatusBanner(text) {
  const el = document.getElementById('status-banner');
  const tx = document.getElementById('status-banner-text');
  if (tx) tx.textContent = text;
  if (el) el.hidden = false;
}

function hideStatusBanner() {
  const el = document.getElementById('status-banner');
  if (el) el.hidden = true;
}

function showView(mode) {
  const empty   = document.getElementById('empty-state');
  const offline = document.getElementById('offline-state');
  const list    = document.getElementById('file-list');
  const cols    = document.getElementById('list-columns');
  if (empty)   empty.hidden   = mode !== 'empty';
  if (offline) offline.hidden = mode !== 'offline';
  if (list)    list.style.display = mode === 'list' ? '' : 'none';
  if (cols)    cols.hidden = mode !== 'list';
}

function matchFilter(t) {
  if (currentFilter !== 'all') {
    const s = getStatus(t).cls;
    if (currentFilter === 'downloading' && !['downloading','queued','checking'].includes(s)) return false;
    if (currentFilter === 'seeding'     && s !== 'complete') return false;
    if (currentFilter === 'paused'      && s !== 'paused') return false;
    if (currentFilter === 'error'       && s !== 'error') return false;
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    if (!t.name.toLowerCase().includes(q)) return false;
  }
  return true;
}

function sortTorrents(list) {
  const sorted = [...list];
  const dir = sortDesc ? -1 : 1;
  sorted.sort((a, b) => {
    if (currentSort === 'name')  return dir * a.name.localeCompare(b.name);
    if (currentSort === 'size')  return dir * ((a.sizeWhenDone||0) - (b.sizeWhenDone||0));
    if (currentSort === 'date')  return dir * ((a.addedDate||0) - (b.addedDate||0));
    return 0;
  });
  return sorted;
}

// ── Row builder ───────────────────────────────────────────────
function buildRow(t, hasFiles, expanded) {
  const si    = getStatus(t);
  const pct   = Math.round((t.percentDone || 0) * 100);
  const done  = pct === 100 || t.status === 6;
  const isMov = si.cls === 'downloading';
  const isChk = si.cls === 'checking';
  const cat   = torrentCategory(t);
  const size  = fmtBytes(t.sizeWhenDone || t.totalSize || 0);
  const date  = fmtDate(t.addedDate);
  const err   = t.error && t.error !== 0 ? (t.errorString || 'Error') : '';

  const isActive  = [1,2,3,4,5].includes(t.status);
  const isStopped = t.status === 0;
  const isSeeding = t.status === 6;
  const showProgress = !done || isChk || (isStopped && pct > 0 && pct < 100);
  const fillCls = isMov ? 'shimmer' : isChk ? 'checking' : done ? 'complete' : '';

  const progressBlock = showProgress ? `
    <div class="file-progress-block">
      <div class="progress-track">
        <div class="progress-fill ${fillCls}" style="width:${Math.max(pct, 2)}%"></div>
      </div>
      <div class="progress-stats">
        <span class="progress-pct">${pct}%</span>
        <span class="progress-speed">${isMov
          ? `↓ ${fmtSpeed(t.rateDownload)} · ↑ ${fmtSpeed(t.rateUpload)}${t.eta > 0 ? ` · ETA ${fmtETA(t.eta)}` : ''}`
          : isChk ? 'Verifying…' : isStopped ? 'Paused' : ''}</span>
      </div>
    </div>` : '';

  const statusPill = `<span class="status-pill sp-${si.cls}">
    ${isMov || isChk ? '<span class="status-dot"></span>' : ''}${si.label}
  </span>`;

  const expandSlot = hasFiles
    ? `<div class="row-expand-slot">
        <button class="row-expand-btn" data-id="${t.id}" type="button" title="${expanded ? 'Hide files' : 'Show files'}" aria-expanded="${expanded ? 'true' : 'false'}">${ICON.chevron}</button>
      </div>`
    : '';

  const fileHint = hasFiles
    ? ` · <span class="file-count-hint">${t.files.length} file${t.files.length === 1 ? '' : 's'}</span>`
    : '';

  return `<div class="file-row${showProgress ? ' has-progress' : ''}${hasFiles ? '' : ' no-expand'}" data-id="${t.id}" data-status="${si.cls}" role="listitem">
    <label class="row-check">
      <input type="checkbox" class="row-checkbox row-select" data-id="${t.id}" />
      <span class="checkmark"></span>
    </label>
    ${expandSlot}
    <div class="file-type-icon cat-${cat}">${ICON[cat] || ICON.generic}</div>
    <div class="file-info">
      <div class="file-name" title="${escHtml(t.name)}">${escHtml(truncate(t.name))}</div>
      <div class="file-meta-line">${statusPill}${err ? ` · <span style="color:var(--danger)">${escHtml(err)}</span>` : ''}${fileHint}</div>
    </div>
    <div class="file-size-col">${size}</div>
    <div class="file-date-col">${date}</div>
    <div class="row-actions">
      ${isActive ? `<button class="row-btn btn-pause" data-id="${t.id}" title="Pause">${ICON.pause}</button>` : ''}
      ${isStopped ? `<button class="row-btn btn-resume" data-id="${t.id}" title="Resume">${ICON.play}</button>` : ''}
      ${isSeeding ? `<button class="row-btn btn-pause" data-id="${t.id}" title="Stop seeding">${ICON.pause}</button>` : ''}
      <button class="row-btn danger btn-delete" data-id="${t.id}" title="Delete permanently">${ICON.trash}</button>
      ${done ? `<button class="row-btn row-btn-dl btn-dl-http" data-id="${t.id}" title="Download">${ICON.download}</button>` : ''}
    </div>
    ${progressBlock}
  </div>`;
}

function buildRowGroup(t) {
  const hasFiles = torrentHasFileList(t);
  const expanded = expandedTorrents.has(t.id);
  return `<div class="file-row-group${expanded ? ' expanded' : ''}" data-group-id="${t.id}">
    ${buildRow(t, hasFiles, expanded)}
    ${hasFiles && expanded ? buildTorrentFilesPanel(t) : ''}
  </div>`;
}

function smartUpdateRow(groupEl, t) {
  const el = groupEl.querySelector('.file-row') || groupEl;
  const pct = Math.round((t.percentDone || 0) * 100);
  const newStatus = getStatus(t).cls;
  const hasFiles = torrentHasFileList(t);
  const expanded = expandedTorrents.has(t.id);
  const panel = groupEl.querySelector('.torrent-files-panel');
  const isDomExpanded = groupEl.classList.contains('expanded');

  if (newStatus !== el.dataset.status
    || expanded !== isDomExpanded
    || (hasFiles && expanded && !panel)
    || (!expanded && panel)) {
    const tmp = document.createElement('div');
    tmp.innerHTML = buildRowGroup(t);
    groupEl.replaceWith(tmp.firstElementChild);
    return;
  }

  if (hasFiles && expanded && panel) {
    const tmp = document.createElement('div');
    tmp.innerHTML = buildTorrentFilesPanel(t);
    panel.replaceWith(tmp.firstElementChild);
  }

  const fill = el.querySelector('.progress-fill');
  if (fill) fill.style.width = `${Math.max(pct, 2)}%`;
  const pctEl = el.querySelector('.progress-pct');
  if (pctEl) pctEl.textContent = `${pct}%`;
  const speedEl = el.querySelector('.progress-speed');
  if (speedEl && newStatus === 'downloading') {
    speedEl.textContent = `↓ ${fmtSpeed(t.rateDownload)} · ↑ ${fmtSpeed(t.rateUpload)}${t.eta > 0 ? ` · ETA ${fmtETA(t.eta)}` : ''}`;
  }
}

function renderList(list) {
  const container = document.getElementById('file-list');
  const filtered = sortTorrents(list.filter(matchFilter));

  hideStatusBanner();

  if (filtered.length === 0) {
    showView('empty');
    if (container) container.innerHTML = '';
    return;
  }
  showView('list');

  const rendered = new Set([...container.querySelectorAll('.file-row-group')].map(el => el.dataset.groupId));
  const want = new Set(filtered.map(t => String(t.id)));

  for (const id of rendered) {
    if (!want.has(id)) container.querySelector(`[data-group-id="${id}"]`)?.remove();
  }

  filtered.forEach(t => {
    const id = String(t.id);
    const existing = container.querySelector(`[data-group-id="${id}"]`);
    if (existing) smartUpdateRow(existing, t);
    else {
      const tmp = document.createElement('div');
      tmp.innerHTML = buildRowGroup(t);
      container.appendChild(tmp.firstElementChild);
    }
  });
}

function updateSidebar(list) {
  /* filter badges removed — keep hook for future use */
  void list;
}

async function updateStorage() {
  const usedEl  = document.getElementById('storage-used');
  const totalEl = document.getElementById('storage-total');
  const fillEl  = document.getElementById('storage-fill');

  try {
    const sData = await rpc('session-get', { fields: ['download-dir'] });
    const dir   = sData?.arguments?.['download-dir'] || '/downloads';
    const fData = await rpc('free-space', { path: dir });
    const args  = fData?.arguments || {};
    const free  = args['size-bytes'] ?? args.size_bytes ?? 0;
    const total = args.total_size ?? args.totalSize ?? 0;

    if (total <= 0) {
      if (usedEl)  usedEl.textContent  = free > 0 ? `${fmtBytes(free)} free` : '—';
      if (totalEl) totalEl.textContent = '—';
      if (fillEl)  fillEl.style.width = '0%';
      return;
    }

    const used  = Math.max(0, total - free);
    const pct   = Math.min(100, (used / total) * 100);

    if (usedEl)  usedEl.textContent  = fmtBytes(used);
    if (totalEl) totalEl.textContent = fmtBytes(total);
    if (fillEl) {
      fillEl.style.width = `${pct}%`;
      fillEl.classList.toggle('warn', pct >= 75 && pct < 90);
      fillEl.classList.toggle('full', pct >= 90);
    }
  } catch {
    if (usedEl)  usedEl.textContent  = '—';
    if (totalEl) totalEl.textContent = '—';
    if (fillEl)  fillEl.style.width = '0%';
  }
}

async function poll() {
  try {
    const data = await rpc('torrent-get', { fields: FIELDS });
    const list = data?.arguments?.torrents || [];

    isConnected = true;
    const currentIds = new Set();
    for (const t of list) { torrents[t.id] = t; currentIds.add(t.id); }
    for (const id of Object.keys(torrents)) {
      if (!currentIds.has(+id)) delete torrents[id];
    }

    renderList(list);
    updateSidebar(list);
    setConnected(true);
    await updateStorage();
    updateMenuStats(list);
    updateSpeedGraph(list);

    const nowDone = new Set(list.filter(t => t.percentDone >= 1 && t.status === 6).map(t => t.id));
    for (const id of nowDone) {
      if (!prevCompleted.has(id) && torrents[id]) {
        const name = truncate(torrents[id].name, 40);
        toast(`Download complete: ${name}`, 'success');
        maybeNotify(name);
      }
    }
    prevCompleted = nowDone;
    return true;
  } catch {
    isConnected = false;
    setConnected(false);
    hideStatusBanner();
    updateMenuStats(getTorrentList());
    updateSpeedGraph([]);
    showView('offline');
    return false;
  }
}

function maybeNotify(name) {
  if (Notification?.permission === 'granted') {
    new Notification(`${APP_NAME} — Download complete`, { body: name, icon: './images/favicon.svg' });
  }
}

function setConnected(ok) {
  const el = document.getElementById('connection-dot');
  if (!el) return;
  el.className = `conn-indicator ${ok ? 'connected' : 'disconnected'}`;
  el.title = ok ? 'Connected' : 'Disconnected — retrying…';
}

// ── Delete dialog (centered) ──────────────────────────────────
function showDeleteConfirm(id) {
  const t = torrents[id];
  if (!t) return;
  pendingDeleteId = id;
  document.getElementById('delete-message').textContent =
    `"${truncate(t.name, 55)}" will be removed along with all files on disk.`;
  document.getElementById('delete-dialog')?.showModal();
}

async function confirmDeletePermanent() {
  const id = pendingDeleteId;
  if (!id) return;
  const row = document.querySelector(`.file-row[data-id="${id}"]`);
  pendingDeleteId = null;
  document.getElementById('delete-dialog')?.close();

  if (row) row.classList.add('removing');
  await removeTorrent(id, true);
  setTimeout(() => row?.remove(), 200);
  toast('Deleted permanently', 'success');
  await poll();
}

// ── Download modal ────────────────────────────────────────────
function openDownloadModal(id) {
  const t = torrents[id];
  if (!t) return;

  const modal    = document.getElementById('download-modal');
  const isFolder = torrentIsFolder(t);
  const cat      = torrentCategory(t);

  const iconEl = document.getElementById('modal-icon');
  iconEl.innerHTML = ICON[cat] || ICON.generic;
  iconEl.className = `modal-file-icon cat-${cat}`;

  document.getElementById('modal-torrent-name').textContent = t.name;

  const totalSize = fmtBytes(t.sizeWhenDone || t.totalSize || 0);
  const fileCount = t.files ? t.files.length : 0;
  document.getElementById('modal-meta').textContent =
    isFolder ? `${fileCount} files · ${totalSize}` : totalSize;

  document.getElementById('modal-subtitle').textContent = isFolder
    ? 'Select individual files or download everything as a ZIP.'
    : 'Your file is ready — click Download or copy the link for IDM / aria2.';

  const zipBar  = document.getElementById('zip-bar');
  const divider = document.getElementById('modal-divider');

  if (isFolder) {
    zipBar.hidden = divider.hidden = false;
    const { url, filename } = buildDownloadTarget(t, null);
    const zipDlBtn = document.getElementById('btn-zip-download');
    zipDlBtn.href = url;
    zipDlBtn.download = filename;
    document.getElementById('btn-copy-zip-link').dataset.url = url;

    const totalBytes = (t.files || []).reduce((s, f) => s + (f.length || 0), 0);
    document.getElementById('zip-size').textContent = fmtBytes(totalBytes);

    const warnEl = document.getElementById('zip-warning');
    const gb = totalBytes / 1e9;
    if (gb > ZIP_WARN_GB) {
      warnEl.hidden = false;
      warnEl.innerHTML = `⚠️ ~${gb.toFixed(1)} GB ZIP — use IDM or aria2 for large files.
        <button class="btn-link" data-copy-url="${escHtml(url)}">Copy link for IDM</button>`;
    } else {
      warnEl.hidden = true;
    }
  } else {
    zipBar.hidden = divider.hidden = true;
  }

  const list = document.getElementById('modal-file-list');
  list.innerHTML = '';
  (t.files || []).forEach((file, idx) => {
    if (t.fileStats?.[idx]?.wanted === false) return;
    const { url, filename } = buildDownloadTarget(t, file);
    const ext = filename.split('.').pop().toLowerCase();
    const fcat = fileCategory(ext);
    const displayName = isFolder && file.name.includes('/')
      ? file.name.split('/').slice(1).join('/') : file.name;

    const li = document.createElement('li');
    li.className = 'file-row-item';
    li.innerHTML = `
      <div class="file-info">
        <div class="file-icon cat-${fcat}">${ICON[fcat] || ICON.generic}</div>
        <div class="file-name-group">
          <span class="file-name" title="${escHtml(file.name)}">${escHtml(truncate(displayName, 55))}</span>
          <span class="file-size">${fmtBytes(file.length)}</span>
        </div>
      </div>
      <div class="file-actions">
        <button class="copy-link-btn" data-url="${escHtml(url)}" type="button">${ICON.copy} Copy</button>
        <a class="btn-primary" href="${escHtml(url)}" download="${escHtml(filename)}">${ICON.download} Download</a>
      </div>`;
    list.appendChild(li);
  });

  modal.showModal();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), {
      value: text, style: 'position:fixed;opacity:0'
    });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Link copied', 'info');
}

function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'i';
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span class="toast-message">${escHtml(msg)}</span>`;
  c.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 320);
  }, 3800);
}

// ── Dialog helpers ────────────────────────────────────────────
function closeDialog(id) {
  document.getElementById(id)?.close();
}

function setupDialogCloses() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeDialog(btn.dataset.close));
  });
  document.querySelectorAll('.cs-dialog').forEach(dlg => {
    dlg.addEventListener('click', e => {
      if (e.target === dlg && !dlg.hasAttribute('data-no-backdrop-close')) dlg.close();
    });
  });
}

// ── Event setup ───────────────────────────────────────────────
function setupGrid() {
  document.getElementById('file-list')?.addEventListener('click', async e => {
    const expandBtn = e.target.closest('.row-expand-btn');
    if (expandBtn) {
      e.stopPropagation();
      toggleTorrentExpand(expandBtn.dataset.id);
      return;
    }

    const row = e.target.closest('.file-row');
    if (row && !e.target.closest('button, a, label, input, .row-actions, .row-check')) {
      const t = torrents[row.dataset.id];
      if (t && torrentHasFileList(t)) {
        toggleTorrentExpand(row.dataset.id);
        return;
      }
    }

    const fileDl = e.target.closest('.torrent-file-dl-btn');
    if (fileDl && !fileDl.disabled) {
      const t = torrents[fileDl.dataset.tid];
      if (t) downloadTorrentFileHttp(t, +fileDl.dataset.idx);
      return;
    }

    const bulkDl = e.target.closest('.torrent-files-dl-selected');
    if (bulkDl) {
      downloadSelectedTorrentFiles(+bulkDl.dataset.tid);
      return;
    }

    const editFiles = e.target.closest('.torrent-files-edit');
    if (editFiles) {
      const tid = +editFiles.dataset.tid;
      const t = torrents[tid];
      const needsMetadata = !t?.files?.length;
      if (needsMetadata) {
        try { await rpc('torrent-start', { ids: [tid] }); } catch {}
      }
      await openTorrentFilePicker(tid, { isNew: false, needsMetadata });
      return;
    }

    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('btn-pause'))       { btn.disabled = true; await pauseTorrent(id);  await poll(); }
    else if (btn.classList.contains('btn-resume')) { btn.disabled = true; await resumeTorrent(id); await poll(); }
    else if (btn.classList.contains('btn-delete')) { showDeleteConfirm(id); }
    else if (btn.classList.contains('btn-dl-http')) { openDownloadModal(id); }
  });

  document.getElementById('file-list')?.addEventListener('change', async e => {
    const cb = e.target.closest('.torrent-file-cb');
    if (!cb) return;
    e.stopPropagation();
    const tid = cb.dataset.tid;
    const idx = +cb.dataset.idx;
    cb.disabled = true;
    try {
      await setSingleFileWanted(tid, idx, cb.checked);
    } catch {
      cb.checked = !cb.checked;
      toast('Could not update file selection', 'error');
    } finally {
      cb.disabled = false;
    }
  });
}

function setupAddTorrent() {
  const input     = document.getElementById('magnet-input');
  const addBtn    = document.getElementById('btn-add-torrent');
  const fileInp   = document.getElementById('torrent-file-input');
  const pasteZone = document.getElementById('paste-zone');
  const dragOvl   = document.getElementById('drag-overlay');

  addBtn?.addEventListener('click', () => {
    const v = input.value.trim();
    if (v) addMagnet(v);
  });
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = input.value.trim(); if (v) addMagnet(v); }
  });

  document.getElementById('btn-wishlist-add')?.addEventListener('click', () => {
    const v = input.value.trim();
    if (addToWishlist(v)) input.value = '';
  });

  fileInp?.addEventListener('change', async () => {
    for (const f of fileInp.files) await addTorrentFile(f);
    fileInp.value = '';
  });

  if (AUTO_PASTE) {
    input?.addEventListener('focus', () => {
      void tryPasteFromClipboard(input);
    });

    document.addEventListener('paste', e => {
      const active = document.activeElement;
      if (active && active !== input && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      const text = e.clipboardData.getData('text');
      if (text && isAddableTorrentUrl(text)) {
        e.preventDefault();
        input.value = text.trim();
        addMagnet(text.trim());
      }
    });
  }

  let dragCount = 0;
  document.addEventListener('dragenter', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    if (++dragCount === 1) { pasteZone?.classList.add('drag-over'); dragOvl?.classList.add('visible'); }
  });
  document.addEventListener('dragleave', () => {
    if (--dragCount <= 0) { dragCount = 0; pasteZone?.classList.remove('drag-over'); dragOvl?.classList.remove('visible'); }
  });
  document.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    dragCount = 0;
    pasteZone?.classList.remove('drag-over');
    dragOvl?.classList.remove('visible');
    const files = [...e.dataTransfer.files].filter(f => f.name.endsWith('.torrent'));
    if (files.length) {
      for (const f of files) await addTorrentFile(f);
    } else {
      const txt = e.dataTransfer.getData('text');
      if (isAddableTorrentUrl(txt)) await addMagnet(txt.trim());
    }
  });
}

function setupFilters() {
  /* filter chips removed from UI — all torrents shown */
}

function setupRetry() {
  document.getElementById('btn-retry')?.addEventListener('click', async () => {
    showStatusBanner('Connecting…');
    showView('empty');
    await poll();
  });
}

function setupSort() {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sort = btn.dataset.sort;
      if (currentSort === sort) sortDesc = !sortDesc;
      else { currentSort = sort; sortDesc = sort === 'date'; }
      document.querySelectorAll('.sort-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sort === currentSort);
        b.classList.toggle('desc', b.dataset.sort === currentSort && sortDesc);
      });
      renderList(Object.values(torrents));
    });
  });
}

function setupSelectAll() {
  const selectAll = document.getElementById('select-all');
  selectAll?.addEventListener('change', () => {
    document.querySelectorAll('.row-select').forEach(cb => {
      cb.checked = selectAll.checked;
      cb.closest('.file-row')?.classList.toggle('selected', selectAll.checked);
    });
  });

  document.getElementById('file-list')?.addEventListener('change', e => {
    if (!e.target.classList.contains('row-select')) return;
    e.target.closest('.file-row')?.classList.toggle('selected', e.target.checked);
  });
}

function setupSearch() {
  const input = document.getElementById('file-search');
  let timer;
  input?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      searchQuery = input.value.trim();
      renderList(Object.values(torrents));
    }, 200);
  });
}

function setupWishlist() {
  const wrap = document.getElementById('wishlist-wrap');

  document.getElementById('btn-wishlist')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleWishlistDropdown();
  });

  document.getElementById('wishlist-close')?.addEventListener('click', e => {
    e.stopPropagation();
    closeWishlistDropdown();
  });

  document.getElementById('menu-wishlist')?.addEventListener('click', () => {
    closeDialog('menu-dialog');
    openWishlistDropdown();
  });

  wrap?.addEventListener('click', e => e.stopPropagation());

  document.addEventListener('click', e => {
    if (!isWishlistOpen()) return;
    if (wrap?.contains(e.target)) return;
    closeWishlistDropdown();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isWishlistOpen()) closeWishlistDropdown();
  });

  document.getElementById('wishlist-items')?.addEventListener('click', async e => {
    const addBtn = e.target.closest('.wishlist-add-one');
    if (addBtn) {
      addBtn.disabled = true;
      await addWishlistToSystem(addBtn.dataset.wid);
      addBtn.disabled = false;
      return;
    }
    const rm = e.target.closest('.wishlist-remove');
    if (rm) removeFromWishlist(rm.dataset.wid);
  });

  document.getElementById('btn-wishlist-add-all')?.addEventListener('click', () => {
    addWishlistToSystem();
  });
}

function setupTheme() {
  setTheme(getTheme());
  document.getElementById('btn-theme')?.addEventListener('click', toggleTheme);
  document.getElementById('menu-theme')?.addEventListener('click', () => {
    toggleTheme();
  });
}

function setupMenu() {
  document.getElementById('btn-menu')?.addEventListener('click', () => {
    void openMenu();
  });

  document.getElementById('menu-pause-all')?.addEventListener('click', async () => {
    const btn = document.getElementById('menu-pause-all');
    if (btn) btn.disabled = true;
    try { await pauseAllTorrents(); } finally { updateMenuStats(); }
  });

  document.getElementById('menu-resume-all')?.addEventListener('click', async () => {
    const btn = document.getElementById('menu-resume-all');
    if (btn) btn.disabled = true;
    try { await resumeAllTorrents(); } finally { updateMenuStats(); }
  });

  document.getElementById('menu-clear-completed')?.addEventListener('click', () => {
    showClearCompletedConfirm();
  });

  document.getElementById('menu-verify-all')?.addEventListener('click', async () => {
    const btn = document.getElementById('menu-verify-all');
    if (btn) btn.disabled = true;
    try { await verifyAllTorrents(); } finally { updateMenuStats(); }
  });

  document.getElementById('menu-alt-speed')?.addEventListener('change', async e => {
    const enabled = e.target.checked;
    try {
      await setAltSpeed(enabled);
    } catch {
      e.target.checked = !enabled;
      toast('Failed to update speed limits', 'error');
    }
  });

  document.getElementById('menu-filters')?.addEventListener('click', e => {
    const btn = e.target.closest('.menu-filter');
    if (!btn) return;
    setCurrentFilter(btn.dataset.filter);
  });

  document.getElementById('menu-settings')?.addEventListener('click', async () => {
    closeDialog('menu-dialog');
    await openSettings();
  });
}

function setupModals() {
  const dlModal = document.getElementById('download-modal');

  document.getElementById('modal-close')?.addEventListener('click', () => dlModal?.close());
  document.getElementById('modal-cancel-btn')?.addEventListener('click', () => dlModal?.close());

  dlModal?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-url]');
    if (btn && btn.classList.contains('copy-link-btn')) await copyText(btn.dataset.url);
    const cpBtn = e.target.closest('[data-copy-url]');
    if (cpBtn) await copyText(cpBtn.dataset.copyUrl);
  });

  document.getElementById('btn-copy-zip-link')?.addEventListener('click', async () => {
    const url = document.getElementById('btn-copy-zip-link')?.dataset.url;
    if (url) await copyText(url);
  });

  document.getElementById('btn-copy-all')?.addEventListener('click', async () => {
    const urls = [...document.querySelectorAll('#modal-file-list .copy-link-btn')]
      .map(b => b.dataset.url).join('\n');
    if (urls) await copyText(urls);
  });

  document.getElementById('delete-cancel')?.addEventListener('click', () => {
    pendingDeleteId = null;
    document.getElementById('delete-dialog')?.close();
  });
  document.getElementById('delete-confirm')?.addEventListener('click', () => confirmDeletePermanent());

  document.getElementById('clear-completed-cancel')?.addEventListener('click', () => {
    document.getElementById('clear-completed-dialog')?.close();
  });
  document.getElementById('clear-completed-confirm')?.addEventListener('click', () => {
    void confirmClearCompleted();
  });

  setupTorrentFilePicker();
  setupDialogCloses();
}

function setupTorrentFilePicker() {
  const dlg = document.getElementById('torrent-files-dialog');
  const list = document.getElementById('picker-file-list');
  const selectAll = document.getElementById('picker-select-all');

  document.getElementById('picker-close')?.addEventListener('click', () => cancelTorrentFilePicker());
  document.getElementById('picker-cancel')?.addEventListener('click', () => cancelTorrentFilePicker());
  document.getElementById('picker-start')?.addEventListener('click', () => confirmTorrentFilePicker());

  dlg?.addEventListener('cancel', e => {
    e.preventDefault();
    cancelTorrentFilePicker();
  });

  dlg?.addEventListener('click', e => {
    if (e.target === dlg) cancelTorrentFilePicker();
  });

  selectAll?.addEventListener('change', () => {
    if (!pendingPicker?.torrent) return;
    const files = pendingPicker.torrent.files || [];
    pendingPicker.selected = selectAll.checked
      ? new Set(files.map((_, i) => i))
      : new Set();
    renderPickerItems(pendingPicker.torrent, pendingPicker.selected);
    const startBtn = document.getElementById('picker-start');
    if (startBtn) startBtn.disabled = pendingPicker.selected.size === 0;
  });

  list?.addEventListener('change', e => {
    const cb = e.target.closest('.picker-file-cb');
    if (!cb || !pendingPicker) return;
    const idx = +cb.dataset.idx;
    if (cb.checked) pendingPicker.selected.add(idx);
    else pendingPicker.selected.delete(idx);
    renderPickerItems(pendingPicker.torrent, pendingPicker.selected);
    const startBtn = document.getElementById('picker-start');
    if (startBtn) startBtn.disabled = pendingPicker.selected.size === 0;
  });
}

function init() {
  document.title = APP_NAME;
  const brand = document.getElementById('brand-name');
  const footer = document.getElementById('app-name-footer');
  if (brand) brand.textContent = APP_NAME;
  if (footer) footer.textContent = APP_NAME;

  loadWishlist();
  setupTheme();
  setupAddTorrent();
  setupFilters();
  setupSort();
  setupSearch();
  setupSelectAll();
  setupGrid();
  setupWishlist();
  setupMenu();
  setupSettings();
  setupSpeedGraph();
  setupModals();
  setupRetry();

  showView('empty');
  document.getElementById('app')?.classList.add('ready');

  requestAnimationFrame(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  });

  connectToDaemon();
}

document.addEventListener('DOMContentLoaded', init);
