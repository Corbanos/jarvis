// ═══════════════════════════════════════════════════════════════════════════
// JARVIS BRIDGE — postMessage protocol for the parent HUD.
//
// Inbound (parent → iframe):
//   { type: 'worldview:focus', lat, lon, name?, alt?, pitch? }
//   { type: 'worldview:layer', name, enable }
//   { type: 'worldview:layers', layers: { name: bool } }
//   { type: 'worldview:mode', mode: 'normal'|'nvg'|'flir'|'crt' }
//   { type: 'worldview:pins', pins: [{lat,lon,label,sub?,tag?}], clear?, fit? }
//   { type: 'worldview:clear-pins' }
//   { type: 'worldview:state' }
//
//   NEW — entity / layer queries:
//   { type: 'worldview:query', layer, filter?, near?:{lat,lon,radiusKm}, limit? }
//      Returns matching entities from a loaded layer. Filter is { key,
//      op, value } — op in 'eq', 'contains', 'starts', 'regex', 'gt', 'lt'.
//   { type: 'worldview:track', layer, match }
//      Highlight + camera-track an entity matching `match` (callsign /
//      icao24 / name / mmsi). Pulses the marker.
//   { type: 'worldview:untrack' }
//      Stop tracking, return camera to free roam.
//
// Outbound (iframe → parent):
//   { type: 'worldview:ready' }
//   { type: 'worldview:state', layers, mode, pinCount, trackedEntity? }
//   { type: 'worldview:query-result', requestId, layer, count, items: [...] }
//   { type: 'worldview:track-result', requestId, ok, entity? }
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  // ─── Pin layer ─────────────────────────────────────────────────────────
  let pinDataSource = null;
  function getPinDS() {
    if (!pinDataSource && typeof viewer !== 'undefined' && viewer) {
      pinDataSource = new Cesium.CustomDataSource('jarvis-pins');
      viewer.dataSources.add(pinDataSource);
    }
    return pinDataSource;
  }
  const TAG_COLORS = {
    cyan:  () => Cesium.Color.fromCssColorString('#00e5ff'),
    amber: () => Cesium.Color.fromCssColorString('#ffb300'),
    green: () => Cesium.Color.fromCssColorString('#00ff9d'),
    red:   () => Cesium.Color.fromCssColorString('#ff3b3b'),
  };
  function clearPins() { const ds = getPinDS(); if (ds) ds.entities.removeAll(); }
  function addPins(pins, fit) {
    const ds = getPinDS(); if (!ds || !Array.isArray(pins)) return 0;
    const positions = []; let count = 0;
    for (const p of pins) {
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const color = (TAG_COLORS[p.tag] || TAG_COLORS.cyan)();
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt || 0),
        point: {
          pixelSize: 11, color: color.withAlpha(0.5),
          outlineColor: color, outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: p.label ? {
          text: p.label, font: '11px "Courier New", monospace',
          fillColor: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('rgba(0,8,18,0.85)'),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        } : undefined,
        description: p.sub || '',
        properties: { jarvisPin: true, tag: p.tag || 'cyan' },
      });
      positions.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
      count++;
    }
    if (fit && positions.length && typeof viewer !== 'undefined') {
      viewer.camera.flyToBoundingSphere(
        Cesium.BoundingSphere.fromPoints(positions),
        { duration: 1.5, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-55), 0) }
      );
    }
    return count;
  }
  function pinCount() { const ds = getPinDS(); return ds ? ds.entities.values.length : 0; }

  // ─── State helpers ─────────────────────────────────────────────────────
  function post(msg) { try { window.parent.postMessage(msg, '*'); } catch (e) {} }

  function snapshotState() {
    const out = {
      type: 'worldview:state', layers: {},
      mode: (typeof currentMode !== 'undefined' ? currentMode : 'normal'),
      pinCount: pinCount(),
      trackedEntity: viewer && viewer.trackedEntity ? entitySummary(viewer.trackedEntity) : null,
    };
    if (typeof layers === 'object' && layers) {
      for (const k of Object.keys(layers)) out.layers[k] = !!layers[k].on;
    }
    return out;
  }

  function flyTo(lat, lon, name, alt, pitch) {
    if (typeof viewer === 'undefined' || !viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt || 1500000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(pitch ?? -55), roll: 0 },
      duration: 1.8,
    });
    if (typeof notify === 'function') notify((name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`).toUpperCase());
    if (typeof intelLog === 'function') intelLog('NAV', `Focus: ${name || lat + ',' + lon}`);
  }

  function setLayerEnabled(name, enable) {
    if (typeof layers !== 'object' || !layers || !layers[name]) return false;
    const isOn = !!layers[name].on;
    if (isOn !== !!enable) {
      try { toggleLayer(name); } catch (e) { console.warn('toggleLayer fail', name, e); return false; }
    }
    return true;
  }

  // ─── Entity summary: extract human-readable fields per layer ────────────
  function entitySummary(ent) {
    if (!ent || !ent.properties) return null;
    const propsRaw = ent.properties;
    const get = (k) => {
      try { return propsRaw[k] ? propsRaw[k].getValue ? propsRaw[k].getValue() : propsRaw[k] : undefined; }
      catch (e) { return undefined; }
    };
    let pos = null;
    try {
      const cart = ent.position && ent.position.getValue ? ent.position.getValue(Cesium.JulianDate.now()) : null;
      if (cart) {
        const c = Cesium.Cartographic.fromCartesian(cart);
        pos = { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude), alt: c.height };
      }
    } catch (e) {}
    return {
      id: ent.id, name: ent.name || '',
      type: get('type'), callsign: get('callsign'),
      icao24: get('icao24'), origin_country: get('origin_country'),
      altitude_m: get('altitude_m'), altitude_ft: get('altitude_ft'),
      ground_speed_ms: get('ground_speed_ms'), heading: get('heading'),
      squawk: get('squawk'), aircraft_type: get('aircraft_type'),
      base_of_origin: get('base_of_origin'),
      // satellites
      norad: get('norad'), sat_name: get('sat_name'),
      // ships
      mmsi: get('mmsi'), ship_name: get('ship_name'), ship_type: get('ship_type'),
      // seismic
      magnitude: get('magnitude'), depth_km: get('depth_km'), place: get('place'), time: get('time'),
      pos,
    };
  }

  // ─── Filter / match utilities ──────────────────────────────────────────
  function entityMatchesFilter(ent, filter) {
    if (!filter || !filter.key) return true;
    const sum = entitySummary(ent);
    const v = sum ? sum[filter.key] : undefined;
    if (v === undefined || v === null) return false;
    const sv = String(v);
    const fv = String(filter.value ?? '');
    switch (filter.op || 'contains') {
      case 'eq':       return sv.toLowerCase() === fv.toLowerCase();
      case 'starts':   return sv.toLowerCase().startsWith(fv.toLowerCase());
      case 'contains': return sv.toLowerCase().includes(fv.toLowerCase());
      case 'regex':    try { return new RegExp(fv, 'i').test(sv); } catch (e) { return false; }
      case 'gt':       return Number(sv) > Number(fv);
      case 'lt':       return Number(sv) < Number(fv);
      default: return false;
    }
  }

  function entityCartographic(ent) {
    try {
      const cart = ent.position && ent.position.getValue ? ent.position.getValue(Cesium.JulianDate.now()) : null;
      if (!cart) return null;
      const c = Cesium.Cartographic.fromCartesian(cart);
      return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude), alt: c.height };
    } catch (e) { return null; }
  }

  function haversineKm(a, b) {
    const R = 6371, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // ─── Query: search a layer's entities ──────────────────────────────────
  function queryLayer(layerName, filter, near, limit) {
    if (!layers || !layers[layerName] || !Array.isArray(layers[layerName].entities)) {
      return { count: 0, items: [], note: `Layer "${layerName}" not loaded.` };
    }
    let pool = layers[layerName].entities;
    let items = [];
    for (const e of pool) {
      if (!entityMatchesFilter(e, filter)) continue;
      const sum = entitySummary(e);
      if (!sum) continue;
      if (near && sum.pos) {
        const distKm = haversineKm(near, sum.pos);
        if (distKm > near.radiusKm) continue;
        sum.distance_km = distKm;
      }
      items.push(sum);
    }
    if (near) items.sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999));
    return { count: items.length, items: items.slice(0, limit || 20) };
  }

  // ─── Track: highlight + camera-follow a matching entity ────────────────
  function findMatchingEntity(layerName, match) {
    if (!layers || !layers[layerName] || !Array.isArray(layers[layerName].entities)) return null;
    const m = String(match || '').trim().toLowerCase();
    if (!m) return null;
    // Try strict callsign / icao24 / name match first, then fuzzy.
    for (const e of layers[layerName].entities) {
      const sum = entitySummary(e);
      if (!sum) continue;
      if ((sum.callsign && String(sum.callsign).toLowerCase().trim() === m) ||
          (sum.icao24 && String(sum.icao24).toLowerCase() === m) ||
          (sum.norad && String(sum.norad).toLowerCase() === m) ||
          (sum.mmsi && String(sum.mmsi).toLowerCase() === m) ||
          (e.name && String(e.name).toLowerCase().trim() === m)) {
        return e;
      }
    }
    // Fuzzy contains
    for (const e of layers[layerName].entities) {
      const sum = entitySummary(e);
      if (!sum) continue;
      const hay = [sum.callsign, sum.icao24, sum.name, e.name, sum.sat_name, sum.ship_name]
        .filter(Boolean).map(String).join(' ').toLowerCase();
      if (hay.includes(m)) return e;
    }
    return null;
  }

  function trackEntity(layerName, match) {
    if (typeof viewer === 'undefined' || !viewer) return { ok: false, error: 'viewer not ready' };
    const ent = findMatchingEntity(layerName, match);
    if (!ent) return { ok: false, error: `No entity matching "${match}" in ${layerName}` };
    // Pulse / highlight: temporarily up the marker size.
    try {
      if (ent.point) {
        ent.point.pixelSize = 14;
        ent.point.outlineWidth = 3;
        ent.point.color = Cesium.Color.fromCssColorString('#00ff9d');
      }
      if (ent.label) ent.label.show = true;
    } catch (e) {}
    viewer.trackedEntity = ent;
    return { ok: true, entity: entitySummary(ent) };
  }

  function untrack() {
    if (typeof viewer === 'undefined' || !viewer) return;
    viewer.trackedEntity = undefined;
  }

  // ─── Inbound queue (Cesium boot race) ──────────────────────────────────
  const earlyQueue = [];
  let cesiumReady = false;
  function isReady() { return cesiumReady || (typeof viewer !== 'undefined' && viewer && viewer.scene); }

  function processMsg(data) {
    switch (data.type) {
      case 'worldview:focus':
        if (typeof data.lat === 'number' && typeof data.lon === 'number') {
          flyTo(data.lat, data.lon, data.name, data.alt, data.pitch);
        }
        break;
      case 'worldview:layer':
        if (data.name) {
          setLayerEnabled(data.name, !!data.enable);
          post(snapshotState());
        }
        break;
      case 'worldview:layers':
        if (data.layers && typeof data.layers === 'object') {
          for (const k of Object.keys(data.layers)) setLayerEnabled(k, !!data.layers[k]);
          post(snapshotState());
        }
        break;
      case 'worldview:mode':
        if (typeof setMode === 'function' && data.mode) {
          try { setMode(data.mode); } catch (err) {}
          post(snapshotState());
        }
        break;
      case 'worldview:pins':
        if (data.clear) clearPins();
        addPins(data.pins || [], data.fit !== false);
        post(snapshotState());
        break;
      case 'worldview:clear-pins':
        clearPins();
        post(snapshotState());
        break;
      case 'worldview:query': {
        const result = queryLayer(data.layer, data.filter, data.near, data.limit);
        post({ type: 'worldview:query-result', requestId: data.requestId, layer: data.layer, ...result });
        break;
      }
      case 'worldview:track': {
        const r = trackEntity(data.layer, data.match);
        post({ type: 'worldview:track-result', requestId: data.requestId, ...r });
        break;
      }
      case 'worldview:untrack':
        untrack();
        post(snapshotState());
        break;
      case 'worldview:state':
        post(snapshotState());
        break;
    }
  }

  function flushQueue() { while (earlyQueue.length) processMsg(earlyQueue.shift()); }

  window.addEventListener('message', function (e) {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (!isReady()) { earlyQueue.push(data); return; }
    processMsg(data);
  });

  function announceReady() {
    if (typeof viewer !== 'undefined' && viewer) {
      cesiumReady = true; flushQueue();
      post({ type: 'worldview:ready' });
      post(snapshotState());
    } else { setTimeout(announceReady, 300); }
  }
  announceReady();
})();
