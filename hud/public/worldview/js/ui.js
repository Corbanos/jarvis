// ═══════════════════════════════════════════════════════════════════════════
// WORLDVIEW — UI: Search, Intel Feed, Measurement, Entity Panel, CCTV
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════
function notify(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'notify ' + type;
  el.textContent = '▶ ' + msg;
  document.getElementById('notify-stack').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.5s';
    setTimeout(() => el.remove(), 500);
  }, 3500);
}

// ═══════════════════════════════════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  const utc = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  document.getElementById('clock').textContent = utc;
}
setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════════════════════════════════════
// LOADING
// ═══════════════════════════════════════════════════════════════════════════
function setLoadProgress(pct, msg) {
  const bar = document.getElementById('loading-bar');
  const status = document.getElementById('loading-status');
  if (bar) bar.style.width = pct + '%';
  if (status) status.textContent = msg;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY SELECTION / DETAIL PANEL
// ═══════════════════════════════════════════════════════════════════════════
function selectEntity(entity) {
  selectedEntity = entity;
  const panel = document.getElementById('right-panel');
  panel.classList.remove('hidden');
  const props = entity.properties;
  if (!props) return;
  const type = props.type ? props.type.getValue() : 'ENTITY';
  document.getElementById('entity-type').textContent = type + ' // OSINT';
  document.getElementById('entity-name').textContent = entity.name || '---';

  const info = document.getElementById('entity-info');
  info.innerHTML = '';
  const skip = ['type'];
  const propKeys = props.propertyNames || [];
  propKeys.filter(k => !skip.includes(k)).forEach(key => {
    let val;
    try { val = props[key].getValue(); } catch(e) { return; }
    if (val === null || val === undefined) return;
    const row = document.createElement('div');
    row.className = 'info-row';
    row.innerHTML = `<div class="info-key">${key.toUpperCase().replace(/_/g,' ')}</div><div class="info-val">${val}</div>`;
    info.appendChild(row);
  });

  // Add coordinates
  if (entity.position) {
    try {
      const pos = entity.position.getValue ? entity.position.getValue(Cesium.JulianDate.now()) : entity.position;
      if (pos) {
        const carto = Cesium.Cartographic.fromCartesian(pos);
        const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(6);
        const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(6);
        const alt = Math.round(carto.height).toLocaleString();
        const locRow = document.createElement('div');
        locRow.className = 'info-row';
        locRow.innerHTML = `<div class="info-key">COORDINATES</div><div class="info-val">${lat}, ${lon}</div>`;
        info.insertBefore(locRow, info.firstChild);
        const altRow = document.createElement('div');
        altRow.className = 'info-row';
        altRow.innerHTML = `<div class="info-key">ALTITUDE</div><div class="info-val">${alt}m</div>`;
        info.insertBefore(altRow, info.children[1]);
      }
    } catch(e) {}
  }

  if (entity.label) entity.label.show = new Cesium.ConstantProperty(true);
  intelLog('SEL', `Entity selected: ${entity.name || 'Unknown'} [${type}]`);
}

function deselectEntity() {
  if (selectedEntity && selectedEntity.label) {
    selectedEntity.label.show = new Cesium.ConstantProperty(false);
  }
  selectedEntity = null;
  trackedEntity = null;
  if (viewer) viewer.trackedEntity = undefined;
  document.getElementById('right-panel').classList.add('hidden');
  document.getElementById('track-btn').textContent = '[ TRACK ENTITY ]';
}

function trackSelected() {
  if (!selectedEntity) return;
  if (trackedEntity === selectedEntity) {
    viewer.trackedEntity = undefined;
    trackedEntity = null;
    document.getElementById('track-btn').textContent = '[ TRACK ENTITY ]';
    notify('TRACKING DISABLED');
  } else {
    viewer.trackedEntity = selectedEntity;
    trackedEntity = selectedEntity;
    document.getElementById('track-btn').textContent = '[ STOP TRACKING ]';
    notify('TRACKING: ' + (selectedEntity.name || '?'));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LANDMARKS
// ═══════════════════════════════════════════════════════════════════════════
function buildLandmarkList() {
  const list = document.getElementById('landmark-list');
  list.innerHTML = '';
  LANDMARKS.forEach(lm => {
    const btn = document.createElement('button');
    btn.className = 'landmark-btn';
    btn.onclick = () => flyToLandmark(lm);
    btn.innerHTML = `<div class="landmark-key">${lm.key}</div>${lm.name} <span style="color:var(--green-dim);margin-left:auto;font-size:9px">${lm.city}</span>`;
    list.appendChild(btn);
  });
}

function flyToLandmark(lm) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lm.lon, lm.lat, lm.alt),
    orientation: { heading: Cesium.Math.toRadians(lm.heading||0), pitch: Cesium.Math.toRadians(lm.pitch||-30), roll: 0 },
    duration: 2,
  });
  notify(lm.name + ' — ' + lm.city);
  intelLog('NAV', `Flying to ${lm.name}, ${lm.city}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH — Nominatim (free, no key)
// ═══════════════════════════════════════════════════════════════════════════
let searchTimeout = null;
function initSearch() {
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  if (!input) return;

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; results.style.display = 'none'; return; }
    searchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=8`, {
          headers: { 'Accept-Language': 'en' },
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        results.innerHTML = '';
        if (data.length === 0) {
          results.innerHTML = '<div class="search-item" style="color:var(--green-dim)">NO RESULTS</div>';
          results.style.display = 'block';
          return;
        }
        data.forEach(r => {
          const div = document.createElement('div');
          div.className = 'search-item';
          div.textContent = r.display_name.substring(0, 60);
          div.onclick = () => {
            const lat = parseFloat(r.lat);
            const lon = parseFloat(r.lon);
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(lon, lat, 5000),
              orientation: { heading: 0, pitch: Cesium.Math.toRadians(-60), roll: 0 },
              duration: 2,
            });
            results.style.display = 'none';
            input.value = '';
            notify('NAVIGATING TO: ' + r.display_name.substring(0, 40));
            intelLog('SRCH', `Search: ${r.display_name.substring(0, 50)}`);
          };
          results.appendChild(div);
        });
        results.style.display = 'block';
      } catch(e) {}
    }, 400);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { results.style.display = 'none'; input.blur(); }
  });

  // Close results when clicking elsewhere
  document.addEventListener('click', e => {
    if (!e.target.closest('#search-box')) results.style.display = 'none';
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// INTEL FEED / LOG CONSOLE
// ═══════════════════════════════════════════════════════════════════════════
const intelFeedData = [];
function intelLog(tag, message) {
  const now = new Date();
  const ts = now.toISOString().substring(11, 19);
  const entry = { ts, tag, message };
  intelFeedData.unshift(entry);
  if (intelFeedData.length > 200) intelFeedData.pop();

  const feed = document.getElementById('intel-feed');
  if (!feed) return;
  const line = document.createElement('div');
  line.className = 'intel-line';
  const tagColors = {SAT:'#00ff41',FLT:'#00e5ff',MIL:'#ff6600',SEIS:'#ffff00',WX:'#66ccff',FIRE:'#ff4400',AIS:'#88aaff',NUC:'#ff00ff',BASE:'#ff3333',AQI:'#cc00cc',CCTV:'#ff3a3a',ISS:'#ffffff',SEL:'#ffb300',NAV:'#00ff41',SRCH:'#00e5ff',MEAS:'#ffb300',SYS:'#00ff41',TRF:'#ffff00'};
  const color = tagColors[tag] || '#00ff41';
  line.innerHTML = `<span style="color:var(--green-dim)">${ts}</span> <span style="color:${color}">[${tag}]</span> ${message}`;
  feed.insertBefore(line, feed.firstChild);
  // Keep DOM manageable
  while (feed.children.length > 100) feed.removeChild(feed.lastChild);
}

function toggleIntelFeed() {
  const panel = document.getElementById('intel-panel');
  panel.classList.toggle('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════
// DISTANCE MEASUREMENT TOOL
// ═══════════════════════════════════════════════════════════════════════════
let measureMode = false;
let measurePoints = [];
let measureEntities = [];

function toggleMeasure() {
  measureMode = !measureMode;
  const btn = document.getElementById('measure-btn');
  if (btn) btn.classList.toggle('active', measureMode);

  if (measureMode) {
    notify('MEASURE MODE — CLICK TWO POINTS ON GLOBE');
    clearMeasure();
    // Override click handler
    viewer.screenSpaceEventHandler.setInputAction(e => {
      if (!measureMode) return;
      const ray = viewer.camera.getPickRay(e.position);
      const pos = viewer.scene.globe.pick(ray, viewer.scene);
      if (!pos) return;

      const carto = Cesium.Cartographic.fromCartesian(pos);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);

      measurePoints.push({ lat, lon, cartesian: pos });

      // Add marker
      const marker = viewer.entities.add({
        position: pos,
        point: { pixelSize: 8, color: Cesium.Color.fromCssColorString('#ffb300'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        label: { text: `P${measurePoints.length}`, font: '10px Courier New', fillColor: Cesium.Color.fromCssColorString('#ffb300'), pixelOffset: new Cesium.Cartesian2(10, 0), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, style: Cesium.LabelStyle.FILL_AND_OUTLINE },
      });
      measureEntities.push(marker);

      if (measurePoints.length === 2) {
        // Calculate distance (Haversine)
        const p1 = measurePoints[0];
        const p2 = measurePoints[1];
        const R = 6371; // Earth radius km
        const dLat = (p2.lat - p1.lat) * Math.PI / 180;
        const dLon = (p2.lon - p1.lon) * Math.PI / 180;
        const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(p1.lat*Math.PI/180)*Math.cos(p2.lat*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distKm = R * c;
        const distMi = distKm * 0.621371;
        const distNm = distKm * 0.539957;

        // Draw line
        const line = viewer.entities.add({
          polyline: {
            positions: [p1.cartesian, p2.cartesian],
            width: 2,
            material: Cesium.Color.fromCssColorString('#ffb300').withAlpha(0.8),
          },
        });
        measureEntities.push(line);

        // Label at midpoint
        const midCart = Cesium.Cartesian3.midpoint(p1.cartesian, p2.cartesian, new Cesium.Cartesian3());
        const label = viewer.entities.add({
          position: midCart,
          label: { text: `${distKm.toFixed(1)} km | ${distMi.toFixed(1)} mi | ${distNm.toFixed(1)} nm`, font: '11px Courier New', fillColor: Cesium.Color.fromCssColorString('#ffb300'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -20), showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#030a06').withAlpha(0.8) },
        });
        measureEntities.push(label);

        notify(`DISTANCE: ${distKm.toFixed(1)} km (${distMi.toFixed(1)} mi)`);
        intelLog('MEAS', `Measured: ${distKm.toFixed(1)} km between (${p1.lat.toFixed(4)},${p1.lon.toFixed(4)}) and (${p2.lat.toFixed(4)},${p2.lon.toFixed(4)})`);

        measureMode = false;
        if (btn) btn.classList.remove('active');

        // Restore normal click handler after short delay
        setTimeout(() => {
          viewer.screenSpaceEventHandler.setInputAction(e => {
            const picked = viewer.scene.pick(e.position);
            if (picked && picked.id) selectEntity(picked.id);
            else deselectEntity();
          }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        }, 500);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  } else {
    clearMeasure();
    // Restore normal click
    viewer.screenSpaceEventHandler.setInputAction(e => {
      const picked = viewer.scene.pick(e.position);
      if (picked && picked.id) selectEntity(picked.id);
      else deselectEntity();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }
}

function clearMeasure() {
  measurePoints = [];
  measureEntities.forEach(e => { try { viewer.entities.remove(e); } catch(err){} });
  measureEntities = [];
}

// ═══════════════════════════════════════════════════════════════════════════
// DAY/NIGHT TERMINATOR — Computed from sun position
// ═══════════════════════════════════════════════════════════════════════════
let terminatorEntity = null;
let terminatorOn = false;

function toggleTerminator() {
  terminatorOn = !terminatorOn;
  const btn = document.getElementById('terminator-btn');
  if (btn) btn.classList.toggle('active', terminatorOn);

  if (terminatorOn) {
    updateTerminator();
    notify('DAY/NIGHT TERMINATOR ENABLED');
  } else {
    if (terminatorEntity) { try { viewer.entities.remove(terminatorEntity); } catch(e){} terminatorEntity = null; }
    notify('DAY/NIGHT TERMINATOR DISABLED');
  }
}

function updateTerminator() {
  if (!terminatorOn) return;
  if (terminatorEntity) { try { viewer.entities.remove(terminatorEntity); } catch(e){} }

  const now = new Date();
  // Approximate sub-solar point
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(),0,0)) / 86400000);
  const declination = -23.44 * Math.cos(2 * Math.PI / 365 * (dayOfYear + 10));
  const hourAngle = (now.getUTCHours() + now.getUTCMinutes()/60) / 24 * 360 - 180;

  // Generate terminator polygon (approximate great circle)
  const positions = [];
  for (let i = 0; i <= 360; i += 2) {
    const lonDeg = i - 180;
    const lonRad = lonDeg * Math.PI / 180;
    const decRad = declination * Math.PI / 180;
    const haRad = hourAngle * Math.PI / 180;

    // Terminator latitude for this longitude
    const latRad = Math.atan(-Math.cos(lonRad - haRad) / Math.tan(decRad));
    const latDeg = latRad * 180 / Math.PI;

    positions.push(lonDeg, latDeg, 0);
  }

  // Create as polyline on globe
  terminatorEntity = viewer.entities.add({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights(positions),
      width: 2,
      material: Cesium.Color.fromCssColorString('#ffb300').withAlpha(0.5),
      clampToGround: true,
    },
  });
}

// Update terminator every minute
setInterval(() => { if (terminatorOn) updateTerminator(); }, 60000);
