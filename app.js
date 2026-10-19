(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const WEATHER = [
    ['sunny', '☀️', 'Sunny'],
    ['partly', '⛅', 'Partly cloudy'],
    ['cloudy', '☁️', 'Cloudy'],
    ['rainy', '🌧️', 'Rainy'],
    ['windy', '🌬️', 'Windy'],
    ['foggy', '🌫️', 'Foggy'],
    ['stormy', '⛈️', 'Stormy'],
    ['snowy', '❄️', 'Snowy'],
  ];
  const COMMON_SPECIES = ['Largemouth Bass', 'Smallmouth Bass', 'Bluegill', 'Crappie', 'Pumpkinseed', 'Rainbow Trout',
    'Brown Trout', 'Brook Trout', 'Yellow Perch', 'Walleye', 'Northern Pike', 'Muskie', 'Channel Catfish', 'Carp',
    'Striped Bass', 'Salmon'];
  const COMMON_BAIT = ['Nightcrawler', 'Minnow', 'Spinner', 'Crankbait', 'Soft plastic worm', 'Jig', 'Spoon',
    'Topwater popper', 'Fly', 'PowerBait', 'Corn', 'Cricket'];
  const TAPES = ['#ffd0dc', '#c9ecfb', '#cff3df', '#fff0b0', '#e3d9fa'];
  const COORD_RE = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;

  // ---------- Storage: catches in IndexedDB (photos are big), small prefs in localStorage ----------
  const DB_NAME = 'fishy-diary';
  const STORE = 'catches';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const store = {
    async all() { return db ? (await tx('readonly', s => s.getAll())) || [] : []; },
    async put(c) { if (db) await tx('readwrite', s => s.put(c)); },
    async del(id) { if (db) await tx('readwrite', s => s.delete(id)); },
  };

  const prefs = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('fishy:' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('fishy:' + key, JSON.stringify(value)); } catch { /* storage blocked */ }
    },
  };

  // ---------- State ----------
  let catches = [];
  let units = prefs.get('units', 'imperial');
  let filterSpecies = prefs.get('filter', 'all');
  let sortBy = prefs.get('sort', 'newest');
  let editingId = null;
  let draftPhoto = null;   // { photo, thumb } data URLs
  let draftCoords = null;  // { lat, lng }
  let photoBusy = false;

  // ---------- Elements ----------
  const gallery = $('#gallery');
  const emptyState = $('#emptyState');
  const filterSel = $('#filterSpecies');
  const sortSel = $('#sortBy');
  const statsBody = $('#statsBody');
  const catchDialog = $('#catchDialog');
  const detailDialog = $('#detailDialog');
  const detailBody = $('#detailBody');
  const form = $('#catchForm');
  const photoInput = $('#photoInput');
  const photoPreview = $('#photoPreview');
  const exifNote = $('#exifNote');
  const coordsLine = $('#coordsLine');
  const locInput = $('#f-location');
  const whenInput = $('#f-when');
  const lenInput = $('#f-length');
  const wtInput = $('#f-weight');

  // ---------- Helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const round = (n, d) => parseFloat(n.toFixed(d));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const keyOf = species => String(species || '').trim().toLowerCase();
  const timeOf = c => +new Date(c.caughtAt || c.createdAt) || 0;
  const pad = n => String(n).padStart(2, '0');
  const toLocalInput = d =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmtCoords = ({ lat, lng }) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const mapUrl = ({ lat, lng }) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;

  function fmtDate(c, withTime = false) {
    const d = new Date(c.caughtAt || c.createdAt);
    if (isNaN(d)) return '';
    let out = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    if (withTime && c.caughtAt) out += ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return out;
  }

  // Everything is stored in cm / kg; these convert for display and input.
  const U = {
    len: cm => cm == null ? '' : units === 'imperial' ? `${round(cm / 2.54, 1)} in` : `${round(cm, 1)} cm`,
    wt: kg => kg == null ? '' : units === 'imperial' ? `${round(kg * 2.20462, 2)} lb` : `${round(kg, 2)} kg`,
    lenToCm: v => units === 'imperial' ? v * 2.54 : v,
    wtToKg: v => units === 'imperial' ? v / 2.20462 : v,
    lenFromCm: cm => round(units === 'imperial' ? cm / 2.54 : cm, 2),
    wtFromKg: kg => round(units === 'imperial' ? kg * 2.20462 : kg, 2),
    lenUnit: () => units === 'imperial' ? 'in' : 'cm',
    wtUnit: () => units === 'imperial' ? 'lb' : 'kg',
  };

  function sizeText(c) {
    const parts = [];
    if (c.lengthCm != null) parts.push('📏 ' + U.len(c.lengthCm));
    if (c.weightKg != null) parts.push('⚖️ ' + U.wt(c.weightKg));
    return parts.join(' · ') || 'size not logged';
  }

  function hashOf(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(h);
  }

  const fishSvg = cls => `<svg class="${cls}" viewBox="0 0 26 16" aria-hidden="true"><use href="#fish-art"/></svg>`;

  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- Biggest fish / personal bests ----------
  // "Biggest" = heaviest when weights are logged, otherwise longest.
  function compareSize(a, b, byWeight) {
    const primary = byWeight ? (a.weightKg ?? -1) - (b.weightKg ?? -1) : (a.lengthCm ?? -1) - (b.lengthCm ?? -1);
    if (primary) return primary;
    return byWeight ? (a.lengthCm ?? -1) - (b.lengthCm ?? -1) : (a.weightKg ?? -1) - (b.weightKg ?? -1);
  }

  function biggestOf(list) {
    if (!list.length) return null;
    const byWeight = list.some(c => c.weightKg != null);
    const best = list.reduce((a, b) => compareSize(b, a, byWeight) > 0 ? b : a);
    return best.weightKg == null && best.lengthCm == null ? null : best;
  }

  function groupBySpecies(list) {
    const groups = new Map();
    for (const c of list) {
      const k = keyOf(c.species);
      if (!groups.has(k)) groups.set(k, { name: c.species.trim(), list: [] });
      groups.get(k).list.push(c);
    }
    return groups;
  }

  function personalBests() {
    const bests = new Map();
    for (const [k, g] of groupBySpecies(catches)) {
      const b = biggestOf(g.list);
      if (b) bests.set(k, b);
    }
    return bests;
  }

  // ---------- Gallery ----------
  const SORTERS = {
    newest: (a, b) => timeOf(b) - timeOf(a),
    oldest: (a, b) => timeOf(a) - timeOf(b),
    longest: (a, b) => (b.lengthCm ?? -1) - (a.lengthCm ?? -1) || timeOf(b) - timeOf(a),
    heaviest: (a, b) => (b.weightKg ?? -1) - (a.weightKg ?? -1) || timeOf(b) - timeOf(a),
  };

  function renderFilter() {
    const groups = [...groupBySpecies(catches).entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
    if (filterSpecies !== 'all' && !groups.some(([k]) => k === filterSpecies)) filterSpecies = 'all';
    filterSel.innerHTML = `<option value="all">All species (${catches.length})</option>` +
      groups.map(([k, g]) => `<option value="${esc(k)}">${esc(g.name)} (${g.list.length})</option>`).join('');
    filterSel.value = filterSpecies;
  }

  function cardHTML(c, i, isPB) {
    const h = hashOf(c.id);
    const tilt = ((h % 7) - 3) * 0.8;
    const tapeTilt = ((h >> 3) % 9) - 4;
    const src = c.thumb || c.photo;
    return `
      <button class="card" type="button" data-open="${esc(c.id)}"
        style="--tilt:${tilt}deg; --tape:${TAPES[h % TAPES.length]}; --tape-tilt:${tapeTilt}deg; --i:${Math.min(i, 12)}"
        aria-label="${esc(c.species)}, ${esc(sizeText(c))}">
        <span class="tape" aria-hidden="true"></span>
        ${isPB ? '<span class="pb-sticker">🏆 PB</span>' : ''}
        <span class="photo">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : fishSvg('ph-fish')}</span>
        <span class="caption">
          <span class="species">${esc(c.species)}</span>
          <span class="sizes">${esc(sizeText(c))}</span>
          <span class="date">${esc(fmtDate(c))}</span>
        </span>
      </button>`;
  }

  function renderGallery() {
    const pbIds = new Set([...personalBests().values()].map(c => c.id));
    const list = catches
      .filter(c => filterSpecies === 'all' || keyOf(c.species) === filterSpecies)
      .sort(SORTERS[sortBy] || SORTERS.newest);

    gallery.innerHTML = list.map((c, i) => cardHTML(c, i, pbIds.has(c.id))).join('');
    $('#catchCount').textContent = list.length;

    emptyState.hidden = list.length > 0;
    if (!catches.length) {
      $('#emptyTitle').textContent = 'No catches yet!';
      $('#emptyText').innerHTML = 'Tap the big <b>+</b> button to log your first fish.';
    } else if (!list.length) {
      $('#emptyTitle').textContent = 'Nothing here';
      $('#emptyText').textContent = 'No catches match this filter.';
    }
  }

  // ---------- Stats ----------
  function renderStats() {
    if (!catches.length) {
      statsBody.innerHTML = `
        <div class="empty">
          ${fishSvg('empty-fish')}
          <h3>Stats will show up here</h3>
          <p>Log a few catches and I'll keep score for you!</p>
        </div>`;
      return;
    }

    const groups = [...groupBySpecies(catches).values()]
      .sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
    const topCount = groups[0].list.length;
    const topNames = groups.filter(g => g.list.length === topCount).map(g => g.name);

    const baitCounts = new Map();
    for (const c of catches) {
      const b = (c.bait || '').trim();
      if (!b) continue;
      const k = b.toLowerCase();
      const entry = baitCounts.get(k) || { name: b, n: 0 };
      entry.n++;
      baitCounts.set(k, entry);
    }
    const favBait = [...baitCounts.values()].sort((a, b) => b.n - a.n)[0];

    const biggest = biggestOf(catches);
    const bests = personalBests();
    const pbRows = groups
      .filter(g => bests.has(keyOf(g.name)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(g => ({ g, best: bests.get(keyOf(g.name)) }));

    const topLabel = topNames.length > 2 ? `${topNames.length}-way tie!` : topNames.join(' & ');

    statsBody.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="ico">🐟</div><div class="val">${catches.length}</div><div class="lbl">total ${catches.length === 1 ? 'catch' : 'catches'}</div></div>
        <div class="stat"><div class="ico">🌈</div><div class="val">${groups.length}</div><div class="lbl">${groups.length === 1 ? 'species' : 'different species'}</div></div>
        <div class="stat"><div class="ico">💖</div><div class="val sm">${esc(topLabel)}</div><div class="lbl">most caught · ${plural(topCount, 'catch', 'catches')}</div></div>
        <div class="stat"><div class="ico">🎣</div><div class="val sm">${favBait ? esc(favBait.name) : '—'}</div><div class="lbl">${favBait ? `favorite bait · ${favBait.n}×` : 'favorite bait'}</div></div>
      </div>

      ${biggest ? `
        <h3 class="stats-h">🏅 Biggest fish</h3>
        <button class="feature" type="button" data-open="${esc(biggest.id)}">
          <span class="thumb">${biggest.thumb || biggest.photo ? `<img src="${esc(biggest.thumb || biggest.photo)}" alt="">` : fishSvg('')}</span>
          <span>
            <span class="ribbon">All-time champ</span>
            <div class="name">${esc(biggest.species)}</div>
            <div class="size">${esc(sizeText(biggest))}</div>
            <div class="when">${esc(fmtDate(biggest))}${biggest.location ? ' · ' + esc(biggest.location) : ''}</div>
          </span>
        </button>` : ''}

      <h3 class="stats-h">🏆 Personal bests</h3>
      ${pbRows.length ? `<div class="pb-list">
        ${pbRows.map(({ g, best }) => `
          <button class="pb-item" type="button" data-open="${esc(best.id)}">
            <span class="rosette">${best.thumb || best.photo ? `<img src="${esc(best.thumb || best.photo)}" alt="">` : fishSvg('')}</span>
            <span class="pb-text">
              <strong>${esc(g.name)}</strong>
              <span class="size">${esc(sizeText(best))}</span>
              <small>caught ${g.list.length}× · PB on ${esc(fmtDate(best))}</small>
            </span>
          </button>`).join('')}
      </div>` : '<p class="lbl">Add a length or weight to your catches to earn personal best badges!</p>'}
    `;
  }

  function renderDatalists() {
    const uniq = (own, common) => {
      const seen = new Set();
      return [...own, ...common].filter(v => {
        const k = v.trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    $('#speciesList').innerHTML = uniq(catches.map(c => c.species), COMMON_SPECIES)
      .map(v => `<option value="${esc(v)}">`).join('');
    $('#baitList').innerHTML = uniq(catches.map(c => c.bait || ''), COMMON_BAIT)
      .map(v => `<option value="${esc(v)}">`).join('');
  }

  function renderAll() {
    renderFilter();
    renderGallery();
    renderStats();
    renderDatalists();
  }

  // ---------- Views ----------
  function switchView(name) {
    $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateUnitUI() {
    const btn = $('#unitToggle');
    btn.textContent = units === 'imperial' ? 'in · lb' : 'cm · kg';
    btn.setAttribute('aria-label', `Units: ${units}. Tap to switch to ${units === 'imperial' ? 'metric' : 'imperial'}`);
    $('[data-unit="len"]').textContent = U.lenUnit();
    $('[data-unit="wt"]').textContent = U.wtUnit();
  }

  // ---------- Photos & EXIF ----------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unsupported image')); };
      img.src = url;
    });
  }

  // Accepts an <img> or a <canvas>.
  function shrink(img, max, quality) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, max / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  const isHeic = file => /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');

  // heic2any is ~1MB, so only fetch it the first time someone picks a HEIC photo.
  let heicLib = null;
  function loadHeicLib() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    heicLib = heicLib || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
      s.onload = () => window.heic2any ? resolve(window.heic2any) : reject(new Error('heic2any missing'));
      s.onerror = () => { heicLib = null; reject(new Error('Could not load HEIC converter')); };
      document.head.appendChild(s);
    });
    return heicLib;
  }

  async function heicToJpeg(file) {
    const heic2any = await loadHeicLib();
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    return Array.isArray(out) ? out[0] : out;
  }

  // Full-size phone photos are several MB; keep a 1280px copy for viewing and a small thumb for the gallery.
  async function processPhoto(file) {
    let img;
    try {
      img = await loadImage(file);
    } catch (err) {
      // Safari can show HEIC natively; other browsers need it converted first.
      if (!isHeic(file)) throw err;
      $('#photoBusy').textContent = 'Converting HEIC photo… 💦';
      img = await loadImage(await heicToJpeg(file));
    }
    return { photo: shrink(img, 1280, 0.82), thumb: shrink(img, 480, 0.75) };
  }

  async function readExif(file) {
    if (!window.exifr) return null;
    try {
      const meta = (await window.exifr.parse(file)) || {};
      if (!Number.isFinite(meta.latitude)) {
        const gps = await window.exifr.gps(file).catch(() => null);
        if (gps) Object.assign(meta, gps);
      }
      return meta;
    } catch {
      return null;
    }
  }

  function exifDate(meta) {
    const raw = meta && (meta.DateTimeOriginal || meta.CreateDate || meta.DateTime || meta.ModifyDate);
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw) ? null : raw;
    const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})/.exec(String(raw));
    return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }

  function showExifNote(text, plain = false) {
    exifNote.textContent = text;
    exifNote.classList.toggle('is-plain', plain);
    exifNote.hidden = false;
  }

  function applyExif(meta) {
    if (!window.exifr) {
      showExifNote("📷 Couldn't load the photo reader (are you offline?) — fill in the details by hand.", true);
      return;
    }
    const found = [];
    const date = exifDate(meta);
    if (date) {
      whenInput.value = toLocalInput(date);
      found.push('date & time');
    }
    const lat = meta && meta.latitude, lng = meta && meta.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
      draftCoords = { lat, lng };
      if (!locInput.value.trim() || COORD_RE.test(locInput.value)) locInput.value = fmtCoords(draftCoords);
      found.push('location');
      updateCoordsLine();
    }
    if (found.length) showExifNote(`✨ Filled in the ${found.join(' and ')} from your photo!`);
    else showExifNote('📷 No date or GPS info in this photo — fill those in by hand.', true);
  }

  function updatePhotoPreview() {
    const has = !!(draftPhoto && draftPhoto.photo);
    photoPreview.hidden = !has;
    if (has) photoPreview.src = draftPhoto.photo; else photoPreview.removeAttribute('src');
    $('#photoPrompt').hidden = has;
    $('#photoActions').hidden = !has;
    $('#photoDrop').classList.toggle('has-photo', has);
  }

  function setPhotoBusy(busy) {
    photoBusy = busy;
    if (busy) $('#photoBusy').textContent = 'Reading photo… 💦';
    $('#photoBusy').hidden = !busy;
    $('#saveBtn').disabled = busy;
  }

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    photoInput.value = '';
    if (!file) return;
    setPhotoBusy(true);
    const [meta, processed] = await Promise.all([readExif(file), processPhoto(file).catch(() => null)]);
    setPhotoBusy(false);
    if (!processed) {
      showExifNote(isHeic(file)
        ? "🙈 Couldn't convert that HEIC photo (the converter needs internet). Try again online, or use a JPG."
        : "🙈 This browser couldn't open that photo. Try a JPG or PNG.", true);
      return;
    }
    draftPhoto = processed;
    updatePhotoPreview();
    applyExif(meta);
  });

  $('#changePhoto').addEventListener('click', () => photoInput.click());

  // ---------- Photo editor (crop / rotate / flip via Cropper.js) ----------
  const editorDialog = $('#editorDialog');
  const editorImg = $('#editorImg');
  let cropper = null;

  function openEditor() {
    if (!draftPhoto) return;
    if (!window.Cropper) {
      showExifNote("✂️ The photo editor couldn't load (are you offline?). Try again with internet.", true);
      return;
    }
    $$('input[name=ratio]', editorDialog).forEach(r => { r.checked = r.value === 'free'; });
    editorDialog.showModal();
    editorImg.onload = () => {
      if (cropper) cropper.destroy();
      cropper = new window.Cropper(editorImg, {
        viewMode: 2,
        dragMode: 'move',
        autoCropArea: 1,
        background: false,
        checkOrientation: false,
        toggleDragModeOnDblclick: false,
      });
    };
    editorImg.src = draftPhoto.photo;
  }

  editorDialog.addEventListener('close', () => {
    if (cropper) { cropper.destroy(); cropper = null; }
    editorImg.onload = null;
    editorImg.removeAttribute('src');
  });

  $('#editPhoto').addEventListener('click', openEditor);

  editorDialog.addEventListener('click', e => {
    const btn = e.target.closest('[data-tool]');
    if (!btn || !cropper) return;
    const { rotate, scaleX, scaleY } = cropper.getData();
    // Cropper flips along the image's own axes, so swap them when the photo is turned sideways.
    const sideways = Math.abs(rotate) % 180 === 90;
    switch (btn.dataset.tool) {
      case 'rotate-left': cropper.rotate(-90); break;
      case 'rotate-right': cropper.rotate(90); break;
      case 'flip-h': sideways ? cropper.scaleY(-scaleY) : cropper.scaleX(-scaleX); break;
      case 'flip-v': sideways ? cropper.scaleX(-scaleX) : cropper.scaleY(-scaleY); break;
      case 'reset':
        cropper.reset();
        cropper.setAspectRatio(NaN);
        $$('input[name=ratio]', editorDialog).forEach(r => { r.checked = r.value === 'free'; });
        break;
    }
  });

  $('.editor-ratios').addEventListener('change', e => {
    if (!cropper || e.target.name !== 'ratio') return;
    cropper.setAspectRatio(e.target.value === 'free' ? NaN : parseFloat(e.target.value));
  });

  $('#applyEdit').addEventListener('click', () => {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({
      maxWidth: 1280,
      maxHeight: 1280,
      fillColor: '#fff',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });
    if (!canvas || !canvas.width) return;
    draftPhoto = { photo: shrink(canvas, 1280, 0.82), thumb: shrink(canvas, 480, 0.75) };
    updatePhotoPreview();
    editorDialog.close();
  });
  $('#removePhoto').addEventListener('click', () => {
    draftPhoto = null;
    exifNote.hidden = true;
    updatePhotoPreview();
  });

  // ---------- Location ----------
  function updateCoordsLine(message) {
    if (message) {
      coordsLine.textContent = message;
      coordsLine.hidden = false;
      return;
    }
    if (!draftCoords) {
      coordsLine.hidden = true;
      return;
    }
    coordsLine.innerHTML = `<span>📍 ${esc(fmtCoords(draftCoords))}</span>
      <a href="${esc(mapUrl(draftCoords))}" target="_blank" rel="noopener">Open map</a>
      <button type="button" class="link-btn" id="clearCoords">Forget GPS</button>`;
    coordsLine.hidden = false;
  }

  coordsLine.addEventListener('click', e => {
    if (!e.target.closest('#clearCoords')) return;
    if (draftCoords && locInput.value.trim() === fmtCoords(draftCoords)) locInput.value = '';
    draftCoords = null;
    updateCoordsLine();
  });

  $('#hereBtn').addEventListener('click', () => {
    const btn = $('#hereBtn');
    if (!navigator.geolocation) {
      updateCoordsLine("Location isn't available in this browser.");
      return;
    }
    btn.disabled = true;
    btn.textContent = '📍 …';
    const done = () => { btn.disabled = false; btn.textContent = '📍 Here'; };
    navigator.geolocation.getCurrentPosition(pos => {
      draftCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!locInput.value.trim() || COORD_RE.test(locInput.value)) locInput.value = fmtCoords(draftCoords);
      updateCoordsLine();
      done();
    }, err => {
      updateCoordsLine(err.code === 1 ? 'Location permission was denied.' : "Couldn't find your location right now.");
      done();
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });

  // ---------- Weather chips (tap again to unselect) ----------
  const chipWrap = $('#weatherChips');
  chipWrap.innerHTML = WEATHER.map(([v, ico, label]) =>
    `<label class="chip"><input type="radio" name="weather" value="${v}"><span>${ico} ${label}</span></label>`).join('');
  const syncWeatherFlags = () => $$('input[name=weather]', chipWrap).forEach(r => { r.dataset.was = r.checked ? '1' : ''; });
  chipWrap.addEventListener('click', e => {
    const r = e.target.closest('input[type=radio]');
    if (!r) return;
    if (r.dataset.was) r.checked = false;
    syncWeatherFlags();
  });

  // ---------- Add / edit form ----------
  function openForm(c = null) {
    form.reset();
    editingId = c ? c.id : null;
    draftPhoto = c && c.photo ? { photo: c.photo, thumb: c.thumb || c.photo } : null;
    draftCoords = c && c.lat != null ? { lat: c.lat, lng: c.lng } : null;

    $('#formTitle').textContent = c ? 'Edit catch' : 'New catch!';
    $('#deleteBtn').hidden = !c;
    exifNote.hidden = true;
    setPhotoBusy(false);

    form.species.value = c ? c.species : '';
    lenInput.value = c && c.lengthCm != null ? U.lenFromCm(c.lengthCm) : '';
    wtInput.value = c && c.weightKg != null ? U.wtFromKg(c.weightKg) : '';
    whenInput.value = c ? (c.caughtAt || '') : toLocalInput(new Date());
    locInput.value = c ? (c.location || '') : '';
    form.bait.value = c ? (c.bait || '') : '';
    form.note.value = c ? (c.note || '') : '';
    $$('input[name=weather]', chipWrap).forEach(r => { r.checked = !!c && r.value === c.weather; });
    syncWeatherFlags();

    updateUnitUI();
    updatePhotoPreview();
    updateCoordsLine();
    catchDialog.showModal();
    catchDialog.scrollTop = 0;
  }

  const num = v => {
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (photoBusy) return;
    const species = form.species.value.trim();
    if (!species) { form.species.focus(); return; }

    const prev = catches.find(x => x.id === editingId);
    const len = num(lenInput.value);
    const wt = num(wtInput.value);
    const weather = $('input[name=weather]:checked', chipWrap);
    const c = {
      id: prev ? prev.id : uid(),
      createdAt: prev ? prev.createdAt : new Date().toISOString(),
      species,
      lengthCm: len == null ? null : U.lenToCm(len),
      weightKg: wt == null ? null : U.wtToKg(wt),
      caughtAt: whenInput.value || '',
      location: locInput.value.trim(),
      lat: draftCoords ? draftCoords.lat : null,
      lng: draftCoords ? draftCoords.lng : null,
      bait: form.bait.value.trim(),
      weather: weather ? weather.value : '',
      note: form.note.value.trim(),
      photo: draftPhoto ? draftPhoto.photo : null,
      thumb: draftPhoto ? draftPhoto.thumb : null,
    };

    const k = keyOf(species);
    const hadSpecies = catches.some(x => x.id !== c.id && keyOf(x.species) === k);

    try {
      await store.put(c);
    } catch (err) {
      console.error(err);
      toast("😢 Couldn't save — your browser storage may be full.", 4000);
      return;
    }

    const i = catches.findIndex(x => x.id === c.id);
    if (i >= 0) catches[i] = c; else catches.push(c);
    catchDialog.close();
    renderAll();

    const best = personalBests().get(k);
    if (!prev && !hadSpecies) toast(`🎉 Your first ${species} in the diary!`);
    else if (!prev && best && best.id === c.id) toast(`🏆 New personal best ${species}!`, 3200);
    else toast(prev ? 'Catch updated 🐟' : 'Nice catch! 🎣');
  });

  async function deleteCatch(id) {
    const c = catches.find(x => x.id === id);
    if (!c || !confirm(`Release this ${c.species} from your diary? This can't be undone.`)) return;
    try {
      await store.del(id);
    } catch (err) {
      console.error(err);
      toast("Couldn't delete that one 😿");
      return;
    }
    catches = catches.filter(x => x.id !== id);
    if (catchDialog.open) catchDialog.close();
    if (detailDialog.open) detailDialog.close();
    renderAll();
    toast('Catch released 💦');
  }

  $('#deleteBtn').addEventListener('click', () => editingId && deleteCatch(editingId));

  // ---------- Detail view ----------
  function openDetail(id) {
    const c = catches.find(x => x.id === id);
    if (!c) return;
    const best = personalBests().get(keyOf(c.species));
    const isPB = best && best.id === c.id;
    const w = WEATHER.find(x => x[0] === c.weather);
    const coords = c.lat != null ? { lat: c.lat, lng: c.lng } : null;
    const where = c.location || (coords ? fmtCoords(coords) : '');

    detailBody.innerHTML = `
      <div class="sheet-head">
        <h2>Catch details</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      <div class="detail-photo">
        ${c.photo ? `<img src="${esc(c.photo)}" alt="Photo of ${esc(c.species)}">` : `<div class="ph">${fishSvg('')}</div>`}
      </div>
      <div class="detail-title">
        <h3>${esc(c.species)}</h3>
        ${isPB ? '<span class="badge-pb">🏆 Personal best</span>' : ''}
      </div>
      <div class="facts">
        <div class="fact"><div class="k">📏 Length</div><div class="v">${c.lengthCm != null ? esc(U.len(c.lengthCm)) : '—'}</div></div>
        <div class="fact"><div class="k">⚖️ Weight</div><div class="v">${c.weightKg != null ? esc(U.wt(c.weightKg)) : '—'}</div></div>
        <div class="fact wide"><div class="k">📅 When</div><div class="v">${esc(fmtDate(c, true)) || '—'}</div></div>
        <div class="fact wide"><div class="k">📍 Where</div><div class="v">${esc(where) || '—'}
          ${coords ? ` · <a href="${esc(mapUrl(coords))}" target="_blank" rel="noopener">Open map</a>` : ''}</div></div>
        <div class="fact"><div class="k">🎣 Bait / lure</div><div class="v">${esc(c.bait) || '—'}</div></div>
        <div class="fact"><div class="k">${w ? w[1] : '🌤️'} Weather</div><div class="v">${w ? w[2] : '—'}</div></div>
      </div>
      ${c.note ? `<div class="note-paper">${esc(c.note)}</div>` : ''}
      <div class="sheet-foot">
        <button type="button" class="btn btn-danger" data-delete>Delete</button>
        <button type="button" class="btn btn-primary" data-edit>✏️ Edit</button>
      </div>`;
    detailBody.dataset.id = c.id;
    detailDialog.showModal();
    detailDialog.scrollTop = 0;
  }

  detailBody.addEventListener('click', e => {
    const id = detailBody.dataset.id;
    if (e.target.closest('[data-edit]')) {
      detailDialog.close();
      openForm(catches.find(x => x.id === id));
    } else if (e.target.closest('[data-delete]')) {
      deleteCatch(id);
    }
  });

  // ---------- Backup ----------
  function sanitize(raw) {
    const str = v => typeof v === 'string' ? v : '';
    const n = v => Number.isFinite(v) ? v : null;
    const img = v => typeof v === 'string' && v.startsWith('data:image/') ? v : null;
    return {
      id: String(raw.id),
      createdAt: str(raw.createdAt) || new Date().toISOString(),
      species: raw.species.trim(),
      lengthCm: n(raw.lengthCm),
      weightKg: n(raw.weightKg),
      caughtAt: str(raw.caughtAt),
      location: str(raw.location),
      lat: n(raw.lat),
      lng: n(raw.lng),
      bait: str(raw.bait),
      weather: WEATHER.some(w => w[0] === raw.weather) ? raw.weather : '',
      note: str(raw.note),
      photo: img(raw.photo),
      thumb: img(raw.thumb) || img(raw.photo),
    };
  }

  $('#exportBtn').addEventListener('click', () => {
    if (!catches.length) { toast('Nothing to back up yet 🐟'); return; }
    const data = { app: 'fishy-diary', version: 1, exportedAt: new Date().toISOString(), catches };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fishy-diary-${toLocalInput(new Date()).slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup saved 💾');
  });

  $('#importInput').addEventListener('change', async e => {
    const input = e.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data && data.catches;
      if (!Array.isArray(list)) throw new Error('Not a backup');
      let count = 0;
      for (const raw of list) {
        if (!raw || !raw.id || typeof raw.species !== 'string' || !raw.species.trim()) continue;
        const c = sanitize(raw);
        await store.put(c);
        const i = catches.findIndex(x => x.id === c.id);
        if (i >= 0) catches[i] = c; else catches.push(c);
        count++;
      }
      renderAll();
      toast(`Restored ${plural(count, 'catch', 'catches')} 🎉`);
    } catch (err) {
      console.error(err);
      toast("That doesn't look like a Fishy Diary backup 🤔", 3500);
    }
  });

  // ---------- Global events ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-open], [data-action="new"], [data-view], [data-close]');
    if (!el) return;
    if (el.dataset.open) openDetail(el.dataset.open);
    else if (el.dataset.action === 'new') openForm();
    else if (el.dataset.view) switchView(el.dataset.view);
    else if (el.hasAttribute('data-close')) el.closest('dialog').close();
  });

  for (const d of [catchDialog, detailDialog, $('#editorDialog')]) {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
  }

  filterSel.addEventListener('change', () => {
    filterSpecies = filterSel.value;
    prefs.set('filter', filterSpecies);
    renderGallery();
  });

  sortSel.addEventListener('change', () => {
    sortBy = sortSel.value;
    prefs.set('sort', sortBy);
    renderGallery();
  });

  $('#unitToggle').addEventListener('click', () => {
    units = units === 'imperial' ? 'metric' : 'imperial';
    prefs.set('units', units);
    updateUnitUI();
    renderGallery();
    renderStats();
    toast(units === 'imperial' ? 'Showing inches & pounds' : 'Showing centimeters & kilograms');
  });

  // ---------- Bubbles ----------
  function makeBubbles() {
    const layer = $('.bubbles');
    const count = window.innerWidth < 600 ? 8 : 14;
    for (let i = 0; i < count; i++) {
      const b = document.createElement('span');
      b.style.setProperty('--size', (6 + Math.random() * 20).toFixed(1) + 'px');
      b.style.setProperty('--left', (Math.random() * 100).toFixed(1) + '%');
      b.style.setProperty('--dur', (9 + Math.random() * 10).toFixed(1) + 's');
      b.style.setProperty('--delay', (-Math.random() * 19).toFixed(1) + 's');
      b.style.setProperty('--drift', (Math.random() * 40 - 20).toFixed(0) + 'px');
      layer.appendChild(b);
    }
  }

  // ---------- Start ----------
  async function init() {
    makeBubbles();
    sortSel.value = SORTERS[sortBy] ? sortBy : 'newest';
    sortBy = sortSel.value;
    updateUnitUI();
    try {
      db = await openDB();
      catches = await store.all();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (err) {
      console.error(err);
      toast("Heads up: this browser is blocking storage, so catches won't be saved 😿", 6000);
    }
    renderAll();
  }

  init();
})();
