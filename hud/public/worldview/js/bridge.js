// ═══════════════════════════════════════════════════════════════════════════
// JARVIS BRIDGE — postMessage protocol so the parent HUD can drive Worldview.
//
// Commands accepted (parent → iframe):
//   { type: 'worldview:focus', lat, lon, name?, alt?, pitch? }
//   { type: 'worldview:layer', name, enable }
//   { type: 'worldview:layers', layers: { name: bool, ... } }
//   { type: 'worldview:mode', mode: 'normal'|'nvg'|'flir'|'crt' }
//   { type: 'worldview:pins', pins: [{ lat, lon, label, sub?, tag? }],
//        clear?: bool, fit?: bool }
//   { type: 'worldview:clear-pins' }
//   { type: 'worldview:state' }
//
// Events emitted (iframe → parent):
//   { type: 'worldview:ready' }
//   { type: 'worldview:state', layers, mode, pinCount }
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  // ─── Pin layer (Jarvis-controlled markers, e.g. "nearest 7-Eleven") ──────
  // Cesium DataSource so pins are isolated from Palantir's layer system.
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

  function clearPins() {
    const ds = getPinDS();
    if (ds) ds.entities.removeAll();
  }

  function addPins(pins, fit) {
    const ds = getPinDS();
    if (!ds || !Array.isArray(pins)) return 0;
    const positions = [];
    let count = 0;
    for (const p of pins) {
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const color = (TAG_COLORS[p.tag] || TAG_COLORS.cyan)();
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt || 0),
        point: {
          pixelSize: 11,
          color: color.withAlpha(0.5),
          outlineColor: color,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: p.label ? {
          text: p.label,
          font: '11px "Courier New", monospace',
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
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

  function pinCount() {
    const ds = getPinDS();
    return ds ? ds.entities.values.length : 0;
  }

  // ─── State + helpers ─────────────────────────────────────────────────────
  function post(msg) {
    try { window.parent.postMessage(msg, '*'); } catch (e) {}
  }

  function snapshotState() {
    const out = {
      type: 'worldview:state',
      layers: {},
      mode: (typeof currentMode !== 'undefined' ? currentMode : 'normal'),
      pinCount: pinCount(),
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

  // ─── Inbound messages ────────────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
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
      case 'worldview:state':
        post(snapshotState());
        break;
    }
  });

  // Announce ready when Cesium boot completes
  function announceReady() {
    if (typeof viewer !== 'undefined' && viewer) {
      post({ type: 'worldview:ready' });
      post(snapshotState());
    } else {
      setTimeout(announceReady, 500);
    }
  }
  announceReady();
})();
